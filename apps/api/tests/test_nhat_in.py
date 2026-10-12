import uuid

from sqlalchemy import func, select

from app.models import (DebtLedgerEntry, MediaObject, NhatInMonthTransaction,
                        Partner, PartnerSettlement)

JPEG = b"\xff\xd8\xff" + b"\x00" * 64


def _upload_pdf(client, owner, name="doichieu.pdf"):
    r = client.post("/api/v1/media/upload/nhat-in", headers=owner,
                    files={"file": (name, b"%PDF-1.4 test", "application/pdf")})
    assert r.status_code == 201, r.text
    return r.json()["data"]["id"]


def _settle(client, owner, month="2026-10", amount=5000000, note=None, media_id=None):
    return client.post("/api/v1/materials/printing/nhat/monthly-settlements",
                       headers={**owner, "Idempotency-Key": uuid.uuid4().hex},
                       json={"period_month": month, "amount": amount, "note": note, "media_id": media_id})


def test_settle_month_success(client, owner, db):
    r = _settle(client, owner)
    assert r.status_code == 201, r.text
    data = r.json()["data"]
    assert data["period_month"] == "2026-10"
    assert data["total_amount"] == 5000000
    partner = db.scalar(select(Partner).where(Partner.partner_code == "NHAT_IN"))
    assert partner is not None
    assert partner.name == "NHẬT - IN"
    assert partner.partner_type == "PRINTING"
    entries = db.scalars(select(DebtLedgerEntry).where(
        DebtLedgerEntry.party_id == partner.id, DebtLedgerEntry.entry_type == "NHAT_IN_SETTLEMENT")).all()
    assert len(entries) == 1
    assert entries[0].amount_delta == 5000000


def test_settle_with_pdf(client, owner, db):
    media_id = _upload_pdf(client, owner)
    r = _settle(client, owner, note="File in tháng 10", media_id=media_id)
    assert r.status_code == 201, r.text
    data = r.json()["data"]
    assert data["media"]["id"] == media_id
    assert data["media"]["original_name"] == "doichieu.pdf"
    settlement = db.get(PartnerSettlement, uuid.UUID(data["id"]))
    assert settlement.media_id == uuid.UUID(media_id)
    # Không lưu base64 trong DB.
    media_row = db.get(MediaObject, uuid.UUID(media_id))
    assert media_row.object_key.startswith("private-media/NHAT_IN/")


def test_upload_nhat_in_rejects_non_pdf(client, owner):
    r = client.post("/api/v1/media/upload/nhat-in", headers=owner,
                    files={"file": ("not-a-pdf.pdf", JPEG, "application/pdf")})
    assert r.status_code == 415
    assert r.json()["error"]["code"] == "UNSUPPORTED_MEDIA"


def test_settle_rejects_non_pdf_media(client, owner):
    media = client.post("/api/v1/media/upload", headers=owner,
                        files={"file": ("image.jpg", JPEG, "image/jpeg")})
    assert media.status_code == 201
    r = _settle(client, owner, media_id=media.json()["data"]["id"])
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "MEDIA_TYPE_INVALID"


def test_settle_amount_must_be_positive(client, owner):
    r = _settle(client, owner, amount=0)
    assert r.status_code == 422


def test_settle_invalid_month(client, owner):
    r = _settle(client, owner, month="10/2026")
    assert r.status_code == 422


def test_settle_out_of_range_month(client, owner):
    r = _settle(client, owner, month="2026-13")
    assert r.status_code == 422


def test_multiple_settlements_in_same_month_are_appended(client, owner, db):
    first = _settle(client, owner, month="2026-10", amount=5000000)
    second = _settle(client, owner, month="2026-10", amount=3000000)
    assert first.status_code == second.status_code == 201
    assert first.json()["data"]["id"] != second.json()["data"]["id"]
    rows = client.get("/api/v1/materials/printing/nhat/monthly/2026-10/settlements",
                      headers=owner).json()["data"]
    assert len(rows) == 2
    assert sum(row["total_amount"] for row in rows) == 8000000
    summary = client.get("/api/v1/materials/printing/nhat/debt-summary",
                         headers=owner).json()["data"]
    assert next(month for month in summary["months"] if month["month"] == "2026-10")["buy"] == 8000000
    partner = db.scalar(select(Partner).where(Partner.partner_code == "NHAT_IN"))
    entries = db.scalars(select(DebtLedgerEntry).where(
        DebtLedgerEntry.party_id == partner.id, DebtLedgerEntry.entry_type == "NHAT_IN_SETTLEMENT")).all()
    assert len(entries) == 2


def test_settle_with_unknown_media(client, owner):
    r = _settle(client, owner, media_id=str(uuid.uuid4()))
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "MEDIA_NOT_FOUND"


def test_list_settlements(client, owner):
    _settle(client, owner, month="2026-10", amount=5000000)
    _settle(client, owner, month="2026-09", amount=3000000)
    r = client.get("/api/v1/materials/printing/nhat/monthly-settlements", headers=owner)
    assert r.status_code == 200
    data = r.json()["data"]
    assert len(data) == 2
    assert data[0]["period_month"] == "2026-10"


def test_monthly_settlements(client, owner):
    _settle(client, owner, month="2026-10", amount=5000000)
    r = client.get("/api/v1/materials/printing/nhat/monthly/2026-10/settlements", headers=owner)
    assert r.status_code == 200
    assert len(r.json()["data"]) == 1
    assert r.json()["data"][0]["total_amount"] == 5000000


def test_role_without_permission_403(client, owner):
    username = f"member_{uuid.uuid4().hex[:8]}"
    client.post("/api/v1/users", headers=owner, json={
        "username": username, "password": "safe-pass-123", "display_name": "Member", "phone": None, "role_codes": ["MEMBER"]})
    login = client.post("/api/v1/auth/login", json={"username": username, "password": "safe-pass-123"})
    auth = {"Authorization": f"Bearer {login.json()['data']['access_token']}"}
    assert client.post("/api/v1/materials/printing/nhat/monthly-settlements", headers={**auth, "Idempotency-Key": uuid.uuid4().hex},
                       json={"period_month": "2026-10", "amount": 1}).status_code == 403


def test_nhat_in_data_not_in_tung(client, owner, db):
    _settle(client, owner, month="2026-10", amount=5000000)
    partner = db.scalar(select(Partner).where(Partner.partner_code == "NHAT_IN"))
    # A Nhật transaction must not create or leak data into the Tùng partner.
    assert db.scalar(select(Partner).where(Partner.partner_code == "TUNG_IN")) is None
    entries = db.scalars(select(DebtLedgerEntry).where(DebtLedgerEntry.party_id == partner.id)).all()
    assert all(e.entry_type.startswith("NHAT_IN_") for e in entries)


def test_debt_summary_after_settlement(client, owner):
    _settle(client, owner, month="2026-10", amount=5000000)
    r = client.get("/api/v1/materials/printing/nhat/debt-summary", headers=owner)
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["total_remaining"] == 5000000
    months = {m["month"]: m for m in data["months"]}
    assert months["2026-10"]["buy"] == 5000000
    assert months["2026-10"]["group"] == "PENDING"


def test_advance_without_settlement_creates_prepaid(client, owner):
    r = client.post("/api/v1/materials/printing/nhat/advances", headers={**owner, "Idempotency-Key": uuid.uuid4().hex},
                    json={"month": "2026-06", "amount": 1000000, "date": "2026-06-01", "note": "Ứng trước"})
    assert r.status_code == 201, r.text
    summary = client.get("/api/v1/materials/printing/nhat/debt-summary", headers=owner).json()["data"]
    assert summary["unallocated_advance"] == 1000000
    months = {m["month"]: m for m in summary["months"]}
    assert months["2026-06"]["group"] == "ADVANCE"


def test_payment_reduces_remaining(client, owner):
    _settle(client, owner, month="2026-10", amount=5000000)
    r = client.post("/api/v1/materials/printing/nhat/payments", headers={**owner, "Idempotency-Key": uuid.uuid4().hex},
                    json={"month": "2026-10", "amount": 2000000, "date": "2026-10-15", "note": "Trả"})
    assert r.status_code == 201, r.text
    summary = client.get("/api/v1/materials/printing/nhat/debt-summary", headers=owner).json()["data"]
    months = {m["month"]: m for m in summary["months"]}
    assert months["2026-10"]["paid"] == 2000000
    assert months["2026-10"]["remaining"] == 3000000


def test_payment_cannot_exceed_remaining(client, owner):
    _settle(client, owner, month="2026-10", amount=5000000)
    r = client.post("/api/v1/materials/printing/nhat/payments", headers={**owner, "Idempotency-Key": uuid.uuid4().hex},
                    json={"month": "2026-10", "amount": 9999999, "date": "2026-10-15", "note": None})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "PAYMENT_EXCEEDS_REMAINING"


def test_payment_idempotency(client, owner, db):
    _settle(client, owner, month="2026-10", amount=5000000)
    key = uuid.uuid4().hex
    body = {"month": "2026-10", "amount": 1000000, "date": "2026-10-15", "note": None}
    first = client.post("/api/v1/materials/printing/nhat/payments", headers={**owner, "Idempotency-Key": key}, json=body)
    second = client.post("/api/v1/materials/printing/nhat/payments", headers={**owner, "Idempotency-Key": key}, json=body)
    assert first.status_code == 201 and second.status_code == 201
    assert first.json()["data"]["id"] == second.json()["data"]["id"]
    assert db.scalar(select(func.count()).select_from(NhatInMonthTransaction)) == 1


def test_monthly_payments(client, owner):
    _settle(client, owner, month="2026-10", amount=5000000)
    client.post("/api/v1/materials/printing/nhat/advances", headers={**owner, "Idempotency-Key": uuid.uuid4().hex},
                json={"month": "2026-10", "amount": 1000000, "date": "2026-10-01", "note": "Ứng"})
    client.post("/api/v1/materials/printing/nhat/payments", headers={**owner, "Idempotency-Key": uuid.uuid4().hex},
                json={"month": "2026-10", "amount": 2000000, "date": "2026-10-15", "note": "Trả"})
    r = client.get("/api/v1/materials/printing/nhat/monthly/2026-10/payments", headers=owner)
    assert r.status_code == 200
    data = r.json()["data"]
    assert len(data) == 2
    types = {row["transaction_type"] for row in data}
    assert types == {"ADVANCE", "PAYMENT"}


def test_ledger_running_balance(client, owner):
    _settle(client, owner, month="2026-10", amount=5000000)
    client.post("/api/v1/materials/printing/nhat/payments", headers={**owner, "Idempotency-Key": uuid.uuid4().hex},
                json={"month": "2026-10", "amount": 2000000, "date": "2026-10-15", "note": "Trả"})
    r = client.get("/api/v1/materials/printing/nhat/ledger", headers=owner)
    assert r.status_code == 200
    ledger = r.json()["data"]
    assert len(ledger) >= 2
    assert ledger[0]["balance"] == 3000000


def test_full_settle_moves_to_settled_group(client, owner):
    _settle(client, owner, month="2026-10", amount=5000000)
    client.post("/api/v1/materials/printing/nhat/payments", headers={**owner, "Idempotency-Key": uuid.uuid4().hex},
                json={"month": "2026-10", "amount": 5000000, "date": "2026-10-15", "note": "Trả đủ"})
    summary = client.get("/api/v1/materials/printing/nhat/debt-summary", headers=owner).json()["data"]
    months = {m["month"]: m for m in summary["months"]}
    assert months["2026-10"]["remaining"] == 0
    assert months["2026-10"]["group"] == "SETTLED"
