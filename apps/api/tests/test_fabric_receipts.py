import uuid

from sqlalchemy import func, select

from app.models import (
    DebtLedgerEntry,
    FabricReceipt,
    FabricReceiptLine,
    Partner,
    PartnerTransaction,
    Payment,
)


def _supplier(client, owner, name="Nhà vải test"):
    response = client.post(
        "/api/v1/materials/fabric/suppliers",
        headers=owner,
        json={"name": name, "phone": "0900000000"},
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


def _line(**overrides):
    return {
        "entry_type": "PURCHASE",
        "receipt_date": "2026-10-12",
        "fabric_name": "Thun lạnh",
        "unit": "KG",
        "roll_count": 10,
        "gross_quantity": 100,
        "deduction_enabled": True,
        "unit_price_amount": 50_000,
        "transport_amount": 50_000,
        **overrides,
    }


def test_fabric_supplier_list_and_create_are_partner_id_based(client, owner):
    supplier = _supplier(client, owner)
    response = client.get("/api/v1/materials/fabric/suppliers", headers=owner)
    assert response.status_code == 200
    assert [row["id"] for row in response.json()["data"]] == [supplier["id"]]

    duplicate = client.post(
        "/api/v1/materials/fabric/suppliers",
        headers=owner,
        json={"name": supplier["name"].upper()},
    )
    assert duplicate.status_code == 409


def test_fabric_receipt_calculates_deduction_returns_and_freight_server_side(client, owner, db):
    supplier = _supplier(client, owner)
    key = str(uuid.uuid4())
    payload = {
        "supplier_id": supplier["id"],
        "lines": [
            _line(),
            _line(
                entry_type="RETURN",
                fabric_name="Vải lỗi",
                roll_count=1,
                gross_quantity=5,
                deduction_enabled=True,
                unit_price_amount=50_000,
                transport_amount=0,
            ),
            _line(
                fabric_name="Vải mét",
                unit="METER",
                roll_count=2,
                gross_quantity=50,
                unit_price_amount=10_000,
                transport_amount=-20_000,
            ),
        ],
    }
    response = client.post(
        "/api/v1/materials/fabric/receipts",
        headers={**owner, "Idempotency-Key": key},
        json=payload,
    )
    assert response.status_code == 201, response.text
    receipt = response.json()["data"]
    assert receipt["total_amount"] == 4_900_000 - 250_000 + 480_000
    assert [line["wastage_quantity"] for line in receipt["lines"]] == [3, 0, 0]
    assert [line["net_quantity"] for line in receipt["lines"]] == [97, 5, 50]
    assert [line["amount"] for line in receipt["lines"]] == [4_900_000, -250_000, 480_000]

    closing = db.scalar(
        select(func.sum(DebtLedgerEntry.amount_delta)).where(
            DebtLedgerEntry.party_type == "PARTNER",
            DebtLedgerEntry.party_id == uuid.UUID(supplier["id"]),
        )
    )
    assert closing == receipt["total_amount"]
    transaction = db.scalar(
        select(PartnerTransaction).where(PartnerTransaction.reference_id == uuid.UUID(receipt["id"]))
    )
    assert transaction is not None
    assert transaction.direction == "DEBIT"
    assert transaction.amount == receipt["total_amount"]


def test_fabric_receipt_is_idempotent_and_rejects_excess_wastage(client, owner, db):
    supplier = _supplier(client, owner, "Nhà vải idempotent")
    key = str(uuid.uuid4())
    payload = {"supplier_id": supplier["id"], "lines": [_line()]}
    first = client.post(
        "/api/v1/materials/fabric/receipts",
        headers={**owner, "Idempotency-Key": key},
        json=payload,
    )
    retry = client.post(
        "/api/v1/materials/fabric/receipts",
        headers={**owner, "Idempotency-Key": key},
        json=payload,
    )
    assert first.status_code == retry.status_code == 201
    assert first.json()["data"]["id"] == retry.json()["data"]["id"]
    assert db.scalar(select(func.count(FabricReceipt.id))) == 1
    assert db.scalar(select(func.count(FabricReceiptLine.id))) == 1
    assert db.scalar(select(func.count(PartnerTransaction.id))) == 1

    invalid = client.post(
        "/api/v1/materials/fabric/receipts",
        headers={**owner, "Idempotency-Key": str(uuid.uuid4())},
        json={"supplier_id": supplier["id"], "lines": [_line(gross_quantity=1)]},
    )
    assert invalid.status_code == 422
    assert db.scalar(select(func.count(FabricReceipt.id))) == 1
    assert db.scalar(
        select(func.count(DebtLedgerEntry.id)).where(
            DebtLedgerEntry.party_id == uuid.UUID(supplier["id"])
        )
    ) == 1


def test_fabric_receipt_with_negative_transport_can_reduce_balance(client, owner, db):
    supplier = _supplier(client, owner, "Nhà vải điều chỉnh")
    response = client.post(
        "/api/v1/materials/fabric/receipts",
        headers={**owner, "Idempotency-Key": str(uuid.uuid4())},
        json={
            "supplier_id": supplier["id"],
            "lines": [
                _line(
                    unit="METER",
                    roll_count=0,
                    gross_quantity=10,
                    deduction_enabled=False,
                    unit_price_amount=50_000,
                    transport_amount=-600_000,
                )
            ],
        },
    )
    assert response.status_code == 201, response.text
    receipt = response.json()["data"]
    assert receipt["total_amount"] == -100_000
    transaction = db.scalar(
        select(PartnerTransaction).where(PartnerTransaction.reference_id == uuid.UUID(receipt["id"]))
    )
    assert transaction.direction == "CREDIT"
    assert transaction.amount == 100_000


def test_fabric_receipt_writes_require_materials_manage(client, picker):
    response = client.post(
        "/api/v1/materials/fabric/suppliers",
        headers=picker,
        json={"name": "Không được tạo"},
    )
    assert response.status_code == 403


def test_fabric_debt_summary_and_statement_are_supplier_scoped(client, owner, db):
    supplier = _supplier(client, owner, "Nhà vải công nợ")
    other = _supplier(client, owner, "Nhà vải khác")
    for partner, line in (
        (supplier, _line()),
        (
            other,
            _line(
                unit="METER",
                roll_count=0,
                gross_quantity=10,
                deduction_enabled=False,
                unit_price_amount=50_000,
                transport_amount=0,
            ),
        ),
    ):
        response = client.post(
            "/api/v1/materials/fabric/receipts",
            headers={**owner, "Idempotency-Key": str(uuid.uuid4())},
            json={"supplier_id": partner["id"], "lines": [line]},
        )
        assert response.status_code == 201, response.text

    summary = client.get("/api/v1/materials/fabric/debt-summary", headers=owner)
    assert summary.status_code == 200
    assert summary.json()["data"]["total_debt"] == 5_400_000
    assert summary.json()["data"]["supplier_count"] == 2

    statement = client.get(
        f"/api/v1/materials/fabric/suppliers/{supplier['id']}/statement",
        headers=owner,
    )
    assert statement.status_code == 200
    data = statement.json()["data"]
    assert data["supplier"]["id"] == supplier["id"]
    assert data["closing"] == 4_900_000
    assert len(data["receipts"]) == 1
    assert data["receipts"][0]["created_by_name"] == "Trang Hà"
    assert data["receipts"][0]["lines"][0]["fabric_name"] == "Thun lạnh"
    assert data["entries"][0]["transaction_no"]

    regular_partner = Partner(
        partner_code="NOT-FABRIC",
        name="Đối tác khác",
        partner_type="PRINTING",
        status="ACTIVE",
    )
    # Non-fabric partners are not exposed through fabric statements.
    db.add(regular_partner)
    db.commit()
    regular_partner_id = regular_partner.id
    invalid = client.get(
        f"/api/v1/materials/fabric/suppliers/{regular_partner_id}/statement",
        headers=owner,
    )
    assert invalid.status_code == 404


def test_fabric_payments_reduce_debt_atomically_and_are_idempotent(client, owner, db):
    supplier = _supplier(client, owner, "Nhà vải thanh toán")
    receipt = client.post(
        "/api/v1/materials/fabric/receipts",
        headers={**owner, "Idempotency-Key": str(uuid.uuid4())},
        json={"supplier_id": supplier["id"], "lines": [_line()]},
    )
    assert receipt.status_code == 201, receipt.text
    key = str(uuid.uuid4())
    payload = {
        "supplier_id": supplier["id"],
        "payments": [
            {"payment_date": "2026-10-13", "amount": 1_000_000, "method": "CASH", "note": "Đợt 1"},
            {"payment_date": "2026-10-14", "amount": 500_000, "method": "BANK_TRANSFER", "note": "Đợt 2"},
        ],
    }
    response = client.post(
        "/api/v1/materials/fabric/payments",
        headers={**owner, "Idempotency-Key": key},
        json=payload,
    )
    assert response.status_code == 201, response.text
    payments = response.json()["data"]
    assert len(payments) == 2
    assert db.scalar(
        select(func.sum(DebtLedgerEntry.amount_delta)).where(
            DebtLedgerEntry.party_type == "PARTNER",
            DebtLedgerEntry.party_id == uuid.UUID(supplier["id"]),
        )
    ) == 3_400_000
    assert db.scalar(
        select(func.count(Payment.id)).where(
            Payment.supplier_id == uuid.UUID(supplier["id"]),
            Payment.direction == "PAYMENT",
        )
    ) == 2
    assert db.scalar(
        select(func.count(PartnerTransaction.id)).where(
            PartnerTransaction.partner_id == uuid.UUID(supplier["id"]),
            PartnerTransaction.transaction_type == "FABRIC_PAYMENT",
        )
    ) == 2

    retry = client.post(
        "/api/v1/materials/fabric/payments",
        headers={**owner, "Idempotency-Key": key},
        json=payload,
    )
    assert retry.status_code == 201
    assert [row["id"] for row in retry.json()["data"]] == [row["id"] for row in payments]
    assert db.scalar(select(func.count(Payment.id))) == 2
    conflict_payload = {
        **payload,
        "payments": [
            {**payload["payments"][0], "amount": 1_000_001},
            payload["payments"][1],
        ],
    }
    conflict = client.post(
        "/api/v1/materials/fabric/payments",
        headers={**owner, "Idempotency-Key": key},
        json=conflict_payload,
    )
    assert conflict.status_code == 409
    assert db.scalar(select(func.count(Payment.id))) == 2

    statement = client.get(
        f"/api/v1/materials/fabric/suppliers/{supplier['id']}/statement",
        headers=owner,
    ).json()["data"]
    assert statement["closing"] == 3_400_000
    assert statement["credit"] == 1_500_000


def test_fabric_payment_requires_settle_permission(client, owner, picker):
    supplier = _supplier(client, owner, "Nhà vải chỉ xem")
    supplier_response = client.get("/api/v1/materials/fabric/suppliers", headers=picker)
    assert supplier_response.status_code == 200
    assert supplier["id"] in {row["id"] for row in supplier_response.json()["data"]}
    response = client.post(
        "/api/v1/materials/fabric/payments",
        headers={**picker, "Idempotency-Key": str(uuid.uuid4())},
        json={
            "supplier_id": supplier["id"],
            "payments": [
                {"payment_date": "2026-10-13", "amount": 1, "method": "CASH"},
            ],
        },
    )
    assert response.status_code == 403
