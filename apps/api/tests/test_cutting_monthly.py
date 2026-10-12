import uuid

from sqlalchemy import select

from app.models import Customer, InventoryBalance, Warehouse


def _upload(client, owner, name="rap.jpg"):
    r = client.post("/api/v1/media/upload", headers=owner, files={"file": (name, b"\xff\xd8\xff" + b"\x00" * 64, "image/jpeg")})
    assert r.status_code == 201, r.text
    return r.json()["data"]["id"]


def _make_batch(client, owner, db, *, team_id, pattern, month="2026-10", mode="HOUSE"):
    warehouse = db.scalar(select(Warehouse).where(Warehouse.code == "TAN_XUAN"))
    customer = db.scalar(select(Customer).order_by(Customer.id))
    media = _upload(client, owner)
    workshop = client.post("/api/v1/workshops", headers=owner, json={
        "workshop_code": f"NM-{uuid.uuid4().hex[:6]}", "name": f"Xưởng {uuid.uuid4().hex[:6]}",
        "phone": None, "address": None, "notes": None}).json()["data"]
    body = {
        "mode": mode, "cut_date": f"{month}-09", "workshop_id": workshop["id"], "cutting_team_id": team_id,
        "pattern_code": pattern, "product_id": None, "product_name": f"SP {pattern}", "layer_expression": "10",
        "expected_delivery_date": None, "customer_id": str(customer.id) if mode == "CUSTOMER_ORDER" else None,
        "workshop_unit_price_amount": 1000, "planned_warehouse_id": str(warehouse.id), "fabric_type_id": None,
        "notes": None, "media_ids": [media],
        "size_plans": [{"color": "CAM", "size": "M", "layers": 10, "ratio": 1, "planned_quantity": 10}],
    }
    r = client.post("/api/v1/production/batches", headers={**owner, "Idempotency-Key": uuid.uuid4().hex}, json=body)
    assert r.status_code == 201, r.text
    return r.json()["data"]


def test_cutting_monthly_report_groups_by_team(client, owner, db):
    team = client.post("/api/v1/cutting-teams", headers=owner, json={
        "team_code": f"CAT-{uuid.uuid4().hex[:6]}", "name": f"TÍ HEO {uuid.uuid4().hex[:4]}",
        "phone": None, "default_unit_price_amount": 500, "notes": None}).json()["data"]
    _make_batch(client, owner, db, team_id=team["id"], pattern="RAP-C1", month="2026-10")
    _make_batch(client, owner, db, team_id=team["id"], pattern="RAP-C2", month="2026-10")
    r = client.get("/api/v1/cutting/monthly-report", headers=owner, params={"month": "2026-10"})
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["pending_count"] == 2
    assert data["total_batches"] == 2
    assert data["total_quantity"] == 20
    assert len(data["teams"]) == 1
    assert data["teams"][0]["team_name"] == team["name"]
    assert data["teams"][0]["batch_count"] == 2
    # Tháng khác trả rỗng.
    empty = client.get("/api/v1/cutting/monthly-report", headers=owner, params={"month": "2026-11"})
    assert empty.json()["data"]["pending_count"] == 0


def test_cutting_monthly_settlement_creates_reports_and_debt(client, owner, db):
    team = client.post("/api/v1/cutting-teams", headers=owner, json={
        "team_code": f"CAT-{uuid.uuid4().hex[:6]}", "name": f"THỦY {uuid.uuid4().hex[:4]}",
        "phone": None, "default_unit_price_amount": 1000, "notes": None}).json()["data"]
    _make_batch(client, owner, db, team_id=team["id"], pattern="RAP-CS1", month="2026-10")
    _make_batch(client, owner, db, team_id=team["id"], pattern="RAP-CS2", month="2026-10")
    r = client.post("/api/v1/cutting/monthly-settlements", headers=owner, json={"month": "2026-10"})
    assert r.status_code == 201, r.text
    data = r.json()["data"]
    assert data["settled"] == 2
    assert data["total_amount"] == 20000  # 2 mâm × 10 cái × 1000
    # Sau khi chốt, báo cáo tháng không còn mâm pending.
    report = client.get("/api/v1/cutting/monthly-report", headers=owner, params={"month": "2026-10"})
    assert report.json()["data"]["pending_count"] == 0
    # Chốt lại lần nữa không tạo trùng.
    r2 = client.post("/api/v1/cutting/monthly-settlements", headers=owner, json={"month": "2026-10"})
    assert r2.status_code == 201
    assert r2.json()["data"]["settled"] == 0


def test_cutting_payment_and_monthly_detail(client, owner, db):
    team = client.post("/api/v1/cutting-teams", headers=owner, json={
        "team_code": f"CAT-{uuid.uuid4().hex[:6]}", "name": f"A7 {uuid.uuid4().hex[:4]}",
        "phone": None, "default_unit_price_amount": 500, "notes": None}).json()["data"]
    _make_batch(client, owner, db, team_id=team["id"], pattern="RAP-CP1", month="2026-10")
    client.post("/api/v1/cutting/monthly-settlements", headers=owner, json={"month": "2026-10"})
    # Ứng tiền thợ cắt.
    pay = client.post("/api/v1/cutting-payments", headers={**owner, "Idempotency-Key": uuid.uuid4().hex}, json={
        "cutting_team_id": team["id"], "amount": 3000, "method": "CASH", "allocations": [],
        "note": "Ứng tiền công", "paid_at": "2026-10-11T12:00:00"})
    assert pay.status_code == 201, pay.text
    # Chi tiết thanh toán tháng 10 có dòng ứng.
    payments = client.get("/api/v1/cutting/monthly-payments", headers=owner, params={"month": "2026-10"})
    rows = payments.json()["data"]
    assert any(r["team_name"] == team["name"] and r["amount"] == 3000 for r in rows)
    # Công nợ theo tháng: chốt 5000, đã trả 3000, còn 2000.
    monthly = client.get("/api/v1/cutting/monthly-debt", headers=owner).json()["data"]
    month10 = next(m for m in monthly["months"] if m["month"] == "2026-10")
    assert month10["settled"] == 5000
    assert month10["paid"] == 3000
    assert month10["remaining"] == 2000
