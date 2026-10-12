import io
import uuid

from sqlalchemy import func, select

from app.models import DebtLedgerEntry, MaterialReceipt, PartnerSettlement, PartnerTransaction, Payment


def _partner(client, owner, suffix="VAI"):
    response = client.post("/api/v1/partners", headers=owner, json={
        "partner_code": f"NCC-{suffix}-{uuid.uuid4().hex[:6]}", "name": f"Nhà cung cấp {suffix} {uuid.uuid4().hex[:4]}",
        "partner_type": "FABRIC_SUPPLIER", "phone": None, "address": None, "notes": None,
    })
    assert response.status_code == 201, response.text
    return response.json()["data"]


def _material(client, owner):
    response = client.post("/api/v1/materials", headers=owner, json={
        "material_code": f"VT-{uuid.uuid4().hex[:8]}", "name": "Vải test", "category": "FABRIC", "unit": "KG",
        "variants": [{"color_id": None, "size": None, "display_name": "Vải test / đen"}], "notes": None,
    })
    assert response.status_code == 201, response.text
    return response.json()["data"]


def test_material_receipt_calculates_total_server_side_and_posts_partner_debt(client, owner, db):
    partner, material = _partner(client, owner), _material(client, owner)
    key = uuid.uuid4().hex
    payload = {"receipt_date": "2026-10-09", "partner_id": partner["id"], "category": "FABRIC",
               "freight_amount": 15_000, "paid_amount": 100_000, "payment_method": "BANK_TRANSFER",
               "lines": [{"material_variant_id": material["variants"][0]["id"], "quantity": 2.5,
                          "weight": 2.5, "unit_price_amount": 80_000, "notes": None}], "notes": "Nhập vải"}
    response = client.post("/api/v1/material-receipts", headers={**owner, "Idempotency-Key": key}, json=payload)
    assert response.status_code == 201, response.text
    receipt = response.json()["data"]
    assert receipt["subtotal_amount"] == 200_000
    assert receipt["total_amount"] == 215_000
    assert receipt["paid_amount"] == 100_000
    assert receipt["balance_amount"] == 115_000
    statement = client.get(f"/api/v1/partners/{partner['id']}/debt-ledger", headers=owner).json()["data"]
    assert statement["debit"] == 215_000
    assert statement["credit"] == 100_000
    assert statement["closing"] == 115_000


def test_material_receipt_retry_is_idempotent(client, owner, db):
    partner, material = _partner(client, owner, "ZIP"), _material(client, owner); key = uuid.uuid4().hex
    payload = {"receipt_date": "2026-10-09", "partner_id": partner["id"], "category": "ZIPPER",
               "freight_amount": 0, "paid_amount": 0,
               "lines": [{"material_variant_id": material["variants"][0]["id"], "quantity": 10,
                          "unit_price_amount": 5_000}]}
    first = client.post("/api/v1/material-receipts", headers={**owner, "Idempotency-Key": key}, json=payload)
    second = client.post("/api/v1/material-receipts", headers={**owner, "Idempotency-Key": key}, json=payload)
    assert first.status_code == second.status_code == 201
    assert first.json()["data"]["id"] == second.json()["data"]["id"]
    assert db.scalar(select(func.count(MaterialReceipt.id))) == 1
    assert db.scalar(select(func.count(DebtLedgerEntry.id)).where(DebtLedgerEntry.party_type == "PARTNER")) == 1


def test_partner_payment_keeps_overpayment_unallocated_and_ledger_explainable(client, owner, db):
    partner = _partner(client, owner, "IN")
    transaction = client.post("/api/v1/partner-transactions", headers={**owner, "Idempotency-Key": uuid.uuid4().hex}, json={
        "partner_id": partner["id"], "transaction_type": "PRINTING_FEE", "direction": "DEBIT",
        "amount": 120_000, "occurred_at": "2026-10-09T08:00:00Z", "description": "Tiền in tháng 10",
    }).json()["data"]
    payment = client.post("/api/v1/partner-payments", headers={**owner, "Idempotency-Key": uuid.uuid4().hex}, json={
        "partner_id": partner["id"], "amount": 150_000, "method": "BANK_TRANSFER", "allocations": [], "note": "Chuyển dư",
    })
    assert payment.status_code == 201, payment.text
    assert payment.json()["data"]["unallocated_amount"] == 150_000
    statement = client.get(f"/api/v1/partners/{partner['id']}/debt-ledger", headers=owner).json()["data"]
    assert statement["closing"] == -30_000
    assert statement["closing"] == sum(row.amount_delta for row in db.scalars(select(DebtLedgerEntry).where(
        DebtLedgerEntry.party_type == "PARTNER", DebtLedgerEntry.party_id == uuid.UUID(partner["id"]))))
    assert transaction["settlement_id"] is None


def test_partner_settlement_groups_transactions_without_double_posting_debt(client, owner, db):
    partner = _partner(client, owner, "THEU"); transaction_ids = []
    for amount in (70_000, 30_000):
        response = client.post("/api/v1/partner-transactions", headers={**owner, "Idempotency-Key": uuid.uuid4().hex}, json={
            "partner_id": partner["id"], "transaction_type": "EMBROIDERY_FEE", "direction": "DEBIT",
            "amount": amount, "occurred_at": "2026-10-09T08:00:00Z", "description": "Tiền thêu"})
        transaction_ids.append(response.json()["data"]["id"])
    before = client.get(f"/api/v1/partners/{partner['id']}/debt-ledger", headers=owner).json()["data"]["closing"]
    key = uuid.uuid4().hex
    payload = {"partner_id": partner["id"], "period_month": "2026-10-01", "settlement_type": "EMBROIDERY",
               "transaction_ids": transaction_ids, "notes": None}
    first = client.post("/api/v1/partner-settlements", headers={**owner, "Idempotency-Key": key}, json=payload)
    retry = client.post("/api/v1/partner-settlements", headers={**owner, "Idempotency-Key": key}, json=payload)
    assert first.status_code == retry.status_code == 201
    assert first.json()["data"]["total_amount"] == 100_000
    assert first.json()["data"]["id"] == retry.json()["data"]["id"]
    assert client.get(f"/api/v1/partners/{partner['id']}/debt-ledger", headers=owner).json()["data"]["closing"] == before
    assert db.scalar(select(func.count(PartnerSettlement.id))) == 1
    assert db.scalar(select(func.count(PartnerTransaction.id)).where(PartnerTransaction.settlement_id.is_not(None))) == 2


def test_partner_file_links_private_media_metadata_not_url(client, owner):
    partner = _partner(client, owner, "FILE")
    upload = client.post("/api/v1/media/upload", headers=owner,
                         files={"file": ("hoa-don.pdf", io.BytesIO(b"%PDF-1.7\n" + b"x" * 32), "application/pdf")})
    assert upload.status_code == 201, upload.text
    media_id = upload.json()["data"]["id"]
    response = client.post(f"/api/v1/partners/{partner['id']}/files", headers=owner,
                           json={"media_id": media_id, "transaction_id": None, "purpose": "INVOICE"})
    assert response.status_code == 201, response.text
    assert response.json()["data"]["media_id"] == media_id
    assert "url" not in response.json()["data"]
