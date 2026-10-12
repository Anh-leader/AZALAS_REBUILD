import uuid

from sqlalchemy import func, select

from app.models import (DebtLedgerEntry, Material, MaterialPriceHistory, MaterialReceipt,
                        Partner, ZipperMonthTransaction)


def _catalog_item(client, owner, name="Dây kéo 5", price=1200, day="2026-10-11"):
    r = client.post("/api/v1/materials/zippers/catalog", headers=owner, json={
        "name": name, "unit_price_amount": price, "effective_date": day})
    assert r.status_code == 201, r.text
    return r.json()["data"]


def _receipt(client, owner, lines, day="2026-10-11"):
    r = client.post("/api/v1/materials/zippers/receipts", headers={**owner, "Idempotency-Key": uuid.uuid4().hex},
                   json={"receipt_date": day, "lines": lines})
    return r


def test_load_empty_catalog(client, owner):
    r = client.get("/api/v1/materials/zippers/catalog", headers=owner)
    assert r.status_code == 200
    assert isinstance(r.json()["data"], list)


def test_add_zipper_type(client, owner, db):
    item = _catalog_item(client, owner, name="Dây kéo 5")
    assert item["name"] == "Dây kéo 5"
    assert item["unit_price_amount"] == 1200
    material = db.get(Material, uuid.UUID(item["id"]))
    assert material.category == "ZIPPER"
    histories = db.scalars(select(MaterialPriceHistory).where(MaterialPriceHistory.material_id == material.id)).all()
    assert len(histories) == 1
    assert histories[0].unit_price_amount == 1200
    assert histories[0].previous_unit_price_amount is None


def test_update_price_creates_history(client, owner, db):
    item = _catalog_item(client, owner, name="Dây kéo 5", price=1200)
    updated = _catalog_item(client, owner, name="Dây kéo 5", price=1500, day="2026-10-12")
    assert updated["id"] == item["id"]
    assert updated["unit_price_amount"] == 1500
    material = db.get(Material, uuid.UUID(item["id"]))
    histories = db.scalars(select(MaterialPriceHistory)
                           .where(MaterialPriceHistory.material_id == material.id)
                           .order_by(MaterialPriceHistory.effective_date)).all()
    assert len(histories) == 2
    assert histories[-1].previous_unit_price_amount == 1200
    assert histories[-1].unit_price_amount == 1500
    # Không tạo trùng tên do khác hoa/thường hoặc dư khoảng trắng.
    dup = _catalog_item(client, owner, name="  dây kéo 5  ", price=9999)
    assert dup["id"] == item["id"]


def test_price_must_be_positive(client, owner):
    r = client.post("/api/v1/materials/zippers/catalog", headers=owner, json={
        "name": "Dây kéo x", "unit_price_amount": 0, "effective_date": "2026-10-11"})
    assert r.status_code == 422


def test_create_receipt_one_line(client, owner, db):
    item = _catalog_item(client, owner)
    r = _receipt(client, owner, [{"material_id": item["id"], "quantity": 100, "unit_price_amount": 1200}])
    assert r.status_code == 201, r.text
    data = r.json()["data"]
    assert data["total_amount"] == 120000
    assert data["category"] == "ZIPPER"
    assert len(data["lines"]) == 1
    assert data["lines"][0]["amount"] == 120000


def test_create_receipt_multiple_lines_total(client, owner):
    a = _catalog_item(client, owner, name="Dây kéo A", price=1000)
    b = _catalog_item(client, owner, name="Dây kéo B", price=2000)
    r = _receipt(client, owner, [
        {"material_id": a["id"], "quantity": 10, "unit_price_amount": 1000},
        {"material_id": b["id"], "quantity": 5, "unit_price_amount": 2000},
    ])
    assert r.status_code == 201, r.text
    assert r.json()["data"]["total_amount"] == 10 * 1000 + 5 * 2000
    assert len(r.json()["data"]["lines"]) == 2


def test_receipt_quantity_must_be_positive(client, owner):
    item = _catalog_item(client, owner)
    r = _receipt(client, owner, [{"material_id": item["id"], "quantity": 0, "unit_price_amount": 1200}])
    assert r.status_code == 422


def test_receipt_updates_debt_ledger(client, owner, db):
    item = _catalog_item(client, owner)
    r = _receipt(client, owner, [{"material_id": item["id"], "quantity": 100, "unit_price_amount": 1200}])
    assert r.status_code == 201
    receipt_id = uuid.UUID(r.json()["data"]["id"])
    entries = db.scalars(select(DebtLedgerEntry).where(DebtLedgerEntry.reference_type == "MATERIAL_RECEIPT",
                                                       DebtLedgerEntry.reference_id == receipt_id)).all()
    assert len(entries) == 1
    assert entries[0].amount_delta == 120000


def test_receipt_idempotency(client, owner, db):
    item = _catalog_item(client, owner)
    key = uuid.uuid4().hex
    body = {"receipt_date": "2026-10-11", "lines": [{"material_id": item["id"], "quantity": 100, "unit_price_amount": 1200}]}
    first = client.post("/api/v1/materials/zippers/receipts", headers={**owner, "Idempotency-Key": key}, json=body)
    second = client.post("/api/v1/materials/zippers/receipts", headers={**owner, "Idempotency-Key": key}, json=body)
    assert first.status_code == 201 and second.status_code == 201
    assert first.json()["data"]["id"] == second.json()["data"]["id"]
    assert db.scalar(select(func.count()).select_from(MaterialReceipt)) == 1


def test_price_history_endpoint(client, owner):
    item = _catalog_item(client, owner)
    r = client.get(f"/api/v1/materials/zippers/{item['id']}/price-history", headers=owner)
    assert r.status_code == 200
    assert len(r.json()["data"]) == 1
    assert r.json()["data"][0]["unit_price_amount"] == 1200


def test_role_without_permission_403(client, owner):
    username = f"member_{uuid.uuid4().hex[:8]}"
    client.post("/api/v1/users", headers=owner, json={
        "username": username, "password": "safe-pass-123", "display_name": "Member", "phone": None, "role_codes": ["MEMBER"]})
    login = client.post("/api/v1/auth/login", json={"username": username, "password": "safe-pass-123"})
    auth = {"Authorization": f"Bearer {login.json()['data']['access_token']}"}
    assert client.post("/api/v1/materials/zippers/catalog", headers=auth,
                       json={"name": "X", "unit_price_amount": 1, "effective_date": "2026-10-11"}).status_code == 403


def _receipt_for_month(client, owner, name, month_day="2026-06-15", price=1000, quantity=100):
    item = _catalog_item(client, owner, name=name, price=price)
    r = _receipt(client, owner, [{"material_id": item["id"], "quantity": quantity, "unit_price_amount": price}], day=month_day)
    assert r.status_code == 201, r.text
    return r.json()["data"]


def test_debt_summary_after_receipt(client, owner, db):
    _receipt_for_month(client, owner, "DK tháng 6", month_day="2026-06-15", price=1000, quantity=100)
    r = client.get("/api/v1/materials/zippers/debt-summary", headers=owner)
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["total_remaining"] == 100000
    months = {m["month"]: m for m in data["months"]}
    assert months["2026-06"]["buy"] == 100000
    assert months["2026-06"]["remaining"] == 100000
    assert months["2026-06"]["group"] == "PENDING"


def test_monthly_receipts(client, owner):
    _receipt_for_month(client, owner, "DK tháng 6", month_day="2026-06-15")
    r = client.get("/api/v1/materials/zippers/monthly/2026-06/receipts", headers=owner)
    assert r.status_code == 200
    assert len(r.json()["data"]) == 1
    assert r.json()["data"][0]["total_amount"] == 100000


def test_advance_creates_prepaid(client, owner, db):
    r = client.post("/api/v1/materials/zippers/advances", headers={**owner, "Idempotency-Key": uuid.uuid4().hex},
                    json={"month": "2026-06", "amount": 50000, "date": "2026-06-01", "note": "Ứng trước"})
    assert r.status_code == 201, r.text
    summary = client.get("/api/v1/materials/zippers/debt-summary", headers=owner).json()["data"]
    assert summary["unallocated_advance"] == 50000
    months = {m["month"]: m for m in summary["months"]}
    assert months["2026-06"]["group"] == "ADVANCE"
    assert months["2026-06"]["advance"] == 50000


def test_payment_reduces_remaining(client, owner):
    _receipt_for_month(client, owner, "DK tháng 6", month_day="2026-06-15", price=1000, quantity=100)
    r = client.post("/api/v1/materials/zippers/payments", headers={**owner, "Idempotency-Key": uuid.uuid4().hex},
                    json={"month": "2026-06", "amount": 40000, "date": "2026-06-20", "note": "Trả 40k"})
    assert r.status_code == 201, r.text
    summary = client.get("/api/v1/materials/zippers/debt-summary", headers=owner).json()["data"]
    months = {m["month"]: m for m in summary["months"]}
    assert months["2026-06"]["buy"] == 100000
    assert months["2026-06"]["paid"] == 40000
    assert months["2026-06"]["remaining"] == 60000
    assert summary["total_remaining"] == 60000


def test_payment_cannot_exceed_remaining(client, owner):
    _receipt_for_month(client, owner, "DK tháng 6", month_day="2026-06-15", price=1000, quantity=100)
    r = client.post("/api/v1/materials/zippers/payments", headers={**owner, "Idempotency-Key": uuid.uuid4().hex},
                    json={"month": "2026-06", "amount": 200000, "date": "2026-06-20", "note": None})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "PAYMENT_EXCEEDS_REMAINING"


def test_payment_idempotency(client, owner, db):
    _receipt_for_month(client, owner, "DK tháng 6", month_day="2026-06-15", price=1000, quantity=100)
    key = uuid.uuid4().hex
    body = {"month": "2026-06", "amount": 30000, "date": "2026-06-20", "note": None}
    first = client.post("/api/v1/materials/zippers/payments", headers={**owner, "Idempotency-Key": key}, json=body)
    second = client.post("/api/v1/materials/zippers/payments", headers={**owner, "Idempotency-Key": key}, json=body)
    assert first.status_code == 201 and second.status_code == 201
    assert first.json()["data"]["id"] == second.json()["data"]["id"]
    assert db.scalar(select(func.count()).select_from(ZipperMonthTransaction)) == 1


def test_monthly_payments(client, owner):
    _receipt_for_month(client, owner, "DK tháng 6", month_day="2026-06-15", price=1000, quantity=100)
    client.post("/api/v1/materials/zippers/payments", headers={**owner, "Idempotency-Key": uuid.uuid4().hex},
                json={"month": "2026-06", "amount": 30000, "date": "2026-06-20", "note": "Trả"})
    r = client.get("/api/v1/materials/zippers/monthly/2026-06/payments", headers=owner)
    assert r.status_code == 200
    assert len(r.json()["data"]) == 1
    assert r.json()["data"][0]["amount"] == 30000
    assert r.json()["data"][0]["transaction_type"] == "PAYMENT"


def test_ledger_running_balance(client, owner):
    _receipt_for_month(client, owner, "DK tháng 6", month_day="2026-06-15", price=1000, quantity=100)
    client.post("/api/v1/materials/zippers/payments", headers={**owner, "Idempotency-Key": uuid.uuid4().hex},
                json={"month": "2026-06", "amount": 30000, "date": "2026-06-20", "note": "Trả"})
    r = client.get("/api/v1/materials/zippers/ledger", headers=owner)
    assert r.status_code == 200
    ledger = r.json()["data"]
    assert len(ledger) >= 2
    # Mới nhất ở đầu (sau khi reverse), số dư cuối = 70.000.
    assert ledger[0]["balance"] == 70000


def test_full_settle_moves_to_settled_group(client, owner):
    _receipt_for_month(client, owner, "DK tháng 6", month_day="2026-06-15", price=1000, quantity=100)
    client.post("/api/v1/materials/zippers/payments", headers={**owner, "Idempotency-Key": uuid.uuid4().hex},
                json={"month": "2026-06", "amount": 100000, "date": "2026-06-20", "note": "Trả đủ"})
    summary = client.get("/api/v1/materials/zippers/debt-summary", headers=owner).json()["data"]
    months = {m["month"]: m for m in summary["months"]}
    assert months["2026-06"]["remaining"] == 0
    assert months["2026-06"]["group"] == "SETTLED"


def test_debt_summary_empty(client, owner):
    r = client.get("/api/v1/materials/zippers/debt-summary", headers=owner)
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["total_remaining"] == 0
    assert data["months"] == []

