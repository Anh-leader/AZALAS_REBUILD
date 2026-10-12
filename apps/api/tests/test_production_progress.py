import uuid

from sqlalchemy import select

from app.models import AuditLog, Customer, InventoryBalance, Order, ProductionBatch, Warehouse


def _upload(client, owner, name="rap.jpg"):
    r = client.post("/api/v1/media/upload", headers=owner, files={"file": (name, b"\xff\xd8\xff" + b"\x00" * 64, "image/jpeg")})
    assert r.status_code == 201, r.text
    return r.json()["data"]["id"]


def _masters(client, owner):
    workshop = client.post("/api/v1/workshops", headers=owner, json={
        "workshop_code": f"NM-{uuid.uuid4().hex[:6]}", "name": f"Xưởng {uuid.uuid4().hex[:6]}",
        "phone": None, "address": None, "notes": None}).json()["data"]
    team = client.post("/api/v1/cutting-teams", headers=owner, json={
        "team_code": f"CAT-{uuid.uuid4().hex[:6]}", "name": f"Thợ {uuid.uuid4().hex[:6]}",
        "phone": None, "default_unit_price_amount": 0, "notes": None}).json()["data"]
    return workshop, team


def _make(client, owner, db, *, workshop, team, pattern, mode="HOUSE", layer="10", name="SP tiến độ", price=1000):
    warehouse = db.scalar(select(Warehouse).where(Warehouse.code == "TAN_XUAN"))
    customer = db.scalar(select(Customer).order_by(Customer.id))
    balance = db.scalar(select(InventoryBalance).where(InventoryBalance.warehouse_id == warehouse.id).order_by(InventoryBalance.id))
    media = _upload(client, owner)
    size_plans = [{"color": "CAM", "size": "M", "layers": 10, "ratio": 1, "planned_quantity": 10}]
    if balance:
        size_plans[0] = {"color_id": str(balance.variant.color_id), "size": balance.variant.size, "layers": 10,
                         "ratio": 1, "planned_quantity": 10, "product_variant_id": str(balance.variant_id),
                         "planned_warehouse_id": str(warehouse.id)}
    body = {
        "mode": mode, "cut_date": "2026-10-09", "workshop_id": workshop["id"], "cutting_team_id": team["id"],
        "pattern_code": pattern, "product_id": str(balance.variant.product_id) if balance else None, "product_name": name, "layer_expression": layer,
        "expected_delivery_date": "2026-10-20" if mode == "CUSTOMER_ORDER" else None,
        "customer_id": str(customer.id) if mode == "CUSTOMER_ORDER" else None,
        "workshop_unit_price_amount": price, "planned_warehouse_id": str(warehouse.id), "fabric_type_id": None,
        "notes": None, "media_ids": [media], "size_plans": size_plans,
    }
    r = client.post("/api/v1/production/batches", headers={**owner, "Idempotency-Key": uuid.uuid4().hex}, json=body)
    assert r.status_code == 201, r.text
    return r.json()["data"]


def test_summary_groups_by_workshop(client, owner, db):
    workshop, team = _masters(client, owner)
    _make(client, owner, db, workshop=workshop, team=team, pattern="RAP-A", mode="HOUSE", layer="20", name="Hàng nhà")
    _make(client, owner, db, workshop=workshop, team=team, pattern="RAP-B", mode="CUSTOMER_ORDER", layer="30", name="Khách đặt")
    r = client.get("/api/v1/production/batches/summary", headers=owner)
    assert r.status_code == 200
    rows = {row["workshop_id"]: row for row in r.json()["data"]}
    assert workshop["id"] in rows
    assert rows[workshop["id"]]["house"] == 20
    assert rows[workshop["id"]]["customer"] == 30
    assert rows[workshop["id"]]["total"] == 50


def test_search_by_workshop_and_pattern(client, owner, db):
    workshop, team = _masters(client, owner)
    _make(client, owner, db, workshop=workshop, team=team, pattern="859DUI", name="Quần độc")
    r = client.get("/api/v1/production/batches", headers=owner, params={"q": "859DUI"})
    assert r.status_code == 200
    assert len(r.json()["data"]) >= 1
    r2 = client.get("/api/v1/production/batches", headers=owner, params={"q": workshop["name"]})
    assert r2.status_code == 200
    assert len(r2.json()["data"]) >= 1
    r3 = client.get("/api/v1/production/batches", headers=owner, params={"q": "KHONG-TON-TAI-XXX"})
    assert r3.json()["data"] == []


def test_payment_status_filter(client, owner, db):
    workshop, team = _masters(client, owner)
    _make(client, owner, db, workshop=workshop, team=team, pattern="RAP-UNPAID", layer="5")
    unpaid = client.get("/api/v1/production/batches", headers=owner, params={"payment_status": "unpaid"})
    paid = client.get("/api/v1/production/batches", headers=owner, params={"payment_status": "paid"})
    assert unpaid.status_code == 200 and paid.status_code == 200
    assert all(row["payment_status"] == "unpaid" for row in unpaid.json()["data"])
    assert all(row["payment_status"] == "paid" for row in paid.json()["data"])
    assert any(row["pattern_code"] == "RAP-UNPAID" for row in unpaid.json()["data"])


def _receipt(client, owner, batch, *, received_now, notes=None):
    plan = batch["size_plans"][0]
    r = client.post(f"/api/v1/production/batches/{batch['id']}/receipts",
        headers={**owner, "Idempotency-Key": uuid.uuid4().hex}, json={
            "receipt_date": "2026-10-10", "warehouse_id": batch["planned_warehouse_id"], "color_id": None,
            "notes": notes, "lines": [{"batch_size_plan_id": plan["id"], "received_now": received_now, "import_to_stock": False}]})
    assert r.status_code == 201, r.text
    return r.json()["data"]


def test_receipt_history_has_receiver_and_notes(client, owner, db):
    workshop, team = _masters(client, owner)
    batch = _make(client, owner, db, workshop=workshop, team=team, pattern="RAP-HIST", layer="10")
    _receipt(client, owner, batch, received_now=4, notes="Đợt 1")
    r = client.get(f"/api/v1/production/batches/{batch['id']}/receipts", headers=owner)
    assert r.status_code == 200
    rows = r.json()["data"]
    assert len(rows) == 1
    assert rows[0]["notes"] == "Đợt 1"
    assert rows[0]["received_by"] is not None
    assert rows[0]["actual_quantity"] == 4


def test_receipt_negative_adjustment_not_negative(client, owner, db):
    workshop, team = _masters(client, owner)
    batch = _make(client, owner, db, workshop=workshop, team=team, pattern="RAP-ADJ", layer="10")
    _receipt(client, owner, batch, received_now=5)
    # Điều chỉnh giảm 2 -> còn 3.
    r = client.post(f"/api/v1/production/batches/{batch['id']}/receipts",
        headers={**owner, "Idempotency-Key": uuid.uuid4().hex}, json={
            "receipt_date": "2026-10-11", "warehouse_id": batch["planned_warehouse_id"], "color_id": None,
            "notes": "Kiểm đếm trừ 2", "lines": [{"batch_size_plan_id": batch["size_plans"][0]["id"], "received_now": -2, "import_to_stock": False}]})
    assert r.status_code == 201, r.text
    db.expire_all()
    current = db.get(ProductionBatch, uuid.UUID(batch["id"]))
    assert current.delivered_quantity == 3 and current.remaining_quantity == 7


def test_receipt_reject_when_delivered_would_be_negative(client, owner, db):
    workshop, team = _masters(client, owner)
    batch = _make(client, owner, db, workshop=workshop, team=team, pattern="RAP-NEG", layer="10")
    _receipt(client, owner, batch, received_now=1)
    r = client.post(f"/api/v1/production/batches/{batch['id']}/receipts",
        headers={**owner, "Idempotency-Key": uuid.uuid4().hex}, json={
            "receipt_date": "2026-10-11", "warehouse_id": batch["planned_warehouse_id"], "color_id": None,
            "lines": [{"batch_size_plan_id": batch["size_plans"][0]["id"], "received_now": -5, "import_to_stock": False}]})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "RECEIPT_WOULD_BE_NEGATIVE"


def test_edit_batch_recalculates_and_audits(client, owner, db):
    workshop, team = _masters(client, owner)
    batch = _make(client, owner, db, workshop=workshop, team=team, pattern="RAP-EDIT", layer="10", name="Tên cũ")
    _receipt(client, owner, batch, received_now=3)
    detail = client.get(f"/api/v1/production/batches/{batch['id']}", headers=owner).json()["data"]
    r = client.patch(f"/api/v1/production/batches/{batch['id']}", headers=owner, json={
        "version": detail["version"], "product_name": "Tên mới", "layer_expression": "20", "notes": "Đã sửa"})
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["product_name"] == "Tên mới"
    assert data["planned_quantity"] == 20
    assert data["delivered_quantity"] == 3
    assert data["remaining_quantity"] == 17
    assert data["notes"] == "Đã sửa"
    audits = db.scalars(select(AuditLog).where(AuditLog.entity_type == "PRODUCTION_BATCH", AuditLog.entity_id == uuid.UUID(batch["id"]))).all()
    assert any(a.action == "UPDATE" for a in audits)


def test_edit_batch_reject_when_delivered_exceeds_new_plan(client, owner, db):
    workshop, team = _masters(client, owner)
    batch = _make(client, owner, db, workshop=workshop, team=team, pattern="RAP-OVER", layer="10")
    _receipt(client, owner, batch, received_now=9)
    detail = client.get(f"/api/v1/production/batches/{batch['id']}", headers=owner).json()["data"]
    r = client.patch(f"/api/v1/production/batches/{batch['id']}", headers=owner, json={
        "version": detail["version"], "layer_expression": "5"})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "DELIVERED_EXCEEDS_PLAN"


def _force_close(client, auth, batch, reason="Lý do test"):
    return client.post(f"/api/v1/production/batches/{batch['id']}/force-close", headers=auth, json={"reason": reason})


def test_force_close_owner_succeeds_and_audits(client, owner, db):
    workshop, team = _masters(client, owner)
    batch = _make(client, owner, db, workshop=workshop, team=team, pattern="RAP-FORCE", layer="10")
    r = _force_close(client, owner, batch)
    assert r.status_code == 200, r.text
    assert r.json()["data"]["production_status"] == "FORCE_CLOSED"
    audits = db.scalars(select(AuditLog).where(AuditLog.entity_type == "PRODUCTION_BATCH", AuditLog.entity_id == uuid.UUID(batch["id"]))).all()
    assert any(a.action == "FORCE_CLOSE" for a in audits)


def test_force_close_member_forbidden(client, owner, db):
    username = f"member_{uuid.uuid4().hex[:8]}"
    client.post("/api/v1/users", headers=owner, json={
        "username": username, "password": "safe-pass-123", "display_name": "Member", "phone": None, "role_codes": ["MEMBER"]})
    login = client.post("/api/v1/auth/login", json={"username": username, "password": "safe-pass-123"})
    member = {"Authorization": f"Bearer {login.json()['data']['access_token']}"}
    workshop, team = _masters(client, owner)
    batch = _make(client, owner, db, workshop=workshop, team=team, pattern="RAP-FORCE-403", layer="10")
    r = _force_close(client, member, batch)
    assert r.status_code == 403


def test_import_to_inventory_tracks_quantity(client, owner, db):
    workshop, team = _masters(client, owner)
    batch = _make(client, owner, db, workshop=workshop, team=team, pattern="RAP-IMP", layer="10")
    _receipt(client, owner, batch, received_now=6)
    r = client.post(f"/api/v1/production/batches/{batch['id']}/import-to-inventory",
        headers={**owner, "Idempotency-Key": uuid.uuid4().hex}, json={"quantity": 4, "notes": "Nhập kho đợt 1"})
    assert r.status_code == 201, r.text
    assert r.json()["data"]["imported_quantity"] == 4
    db.expire_all()
    assert db.get(ProductionBatch, uuid.UUID(batch["id"])).imported_quantity == 4


def test_import_to_inventory_cannot_exceed_received(client, owner, db):
    workshop, team = _masters(client, owner)
    batch = _make(client, owner, db, workshop=workshop, team=team, pattern="RAP-IMP-OVER", layer="10")
    _receipt(client, owner, batch, received_now=3)
    r = client.post(f"/api/v1/production/batches/{batch['id']}/import-to-inventory",
        headers={**owner, "Idempotency-Key": uuid.uuid4().hex}, json={"quantity": 5, "notes": None})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "IMPORT_EXCEEDS_RECEIVED"


def test_customer_orders_list_and_search(client, owner, db):
    workshop, team = _masters(client, owner)
    house = _make(client, owner, db, workshop=workshop, team=team, pattern="RAP-HOUSE", mode="HOUSE", layer="10")
    customer = db.scalar(select(Customer).order_by(Customer.id))
    _make(client, owner, db, workshop=workshop, team=team, pattern="859DUI", mode="CUSTOMER_ORDER", layer="20", name="Quần khách")
    r = client.get("/api/v1/production/batches", headers=owner, params={"batch_type": "CUSTOMER_ORDER"})
    assert r.status_code == 200
    rows = r.json()["data"]
    assert all(row["batch_type"] == "CUSTOMER_ORDER" for row in rows)
    assert any(row["pattern_code"] == "859DUI" for row in rows)
    assert all(row["id"] != house["id"] for row in rows)
    # Search theo tên khách.
    by_customer = client.get("/api/v1/production/batches", headers=owner, params={"batch_type": "CUSTOMER_ORDER", "q": customer.name})
    assert any(row["id"] != house["id"] for row in by_customer.json()["data"])
    # Card data có customer + order + images + progress.
    card = next(row for row in rows if row["pattern_code"] == "859DUI")
    assert card["customer_name"] == customer.name
    assert card["synced_order_no"] is not None
    assert len(card["images"]) >= 1
    assert card["planned_quantity"] == 20
    assert card["delivered_quantity"] == 0


def _customer_batch(client, owner, db, *, workshop, team, pattern="RAP-CO"):
    return _make(client, owner, db, workshop=workshop, team=team, pattern=pattern, mode="CUSTOMER_ORDER", layer="10")


def test_start_picking_links_order(client, owner, db):
    workshop, team = _masters(client, owner)
    batch = _customer_batch(client, owner, db, workshop=workshop, team=team)
    r = client.post(f"/api/v1/production/customer-orders/{batch['id']}/start-picking", headers=owner)
    assert r.status_code == 200, r.text
    assert r.json()["data"]["status"] == "PICKING"
    # Bấm lần 2 không tạo trùng order.
    r2 = client.post(f"/api/v1/production/customer-orders/{batch['id']}/start-picking", headers=owner)
    assert r2.status_code == 200
    db.expire_all()
    current = db.get(ProductionBatch, uuid.UUID(batch["id"]))
    assert current.synced_order_id is not None
    order = db.get(Order, current.synced_order_id)
    assert order.status == "PICKING"
    assert order.order_type == "CUSTOMER_ORDER"


def test_mark_debt_order_updates_status(client, owner, db):
    workshop, team = _masters(client, owner)
    batch = _customer_batch(client, owner, db, workshop=workshop, team=team)
    r = client.post(f"/api/v1/production/customer-orders/{batch['id']}/mark-debt-order", headers=owner)
    assert r.status_code == 200, r.text
    db.expire_all()
    order = db.get(Order, db.get(ProductionBatch, uuid.UUID(batch["id"])).synced_order_id)
    assert order.status == "DEBT_ORDER"


def test_delete_customer_order_soft_delete(client, owner, db):
    workshop, team = _masters(client, owner)
    batch = _customer_batch(client, owner, db, workshop=workshop, team=team)
    r = client.post(f"/api/v1/production/customer-orders/{batch['id']}/delete", headers=owner)
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["deleted"] is True and data["had_business"] is False
    db.expire_all()
    current = db.get(ProductionBatch, uuid.UUID(batch["id"]))
    assert current.production_status == "CANCELLED"
    # Không còn xuất hiện trong danh sách active.
    listing = client.get("/api/v1/production/batches", headers=owner, params={"batch_type": "CUSTOMER_ORDER"})
    assert all(row["id"] != batch["id"] for row in listing.json()["data"])
    # Vẫn còn trong DB để trace.
    assert db.get(ProductionBatch, uuid.UUID(batch["id"])) is not None


def test_delete_customer_order_with_business_cancels(client, owner, db):
    workshop, team = _masters(client, owner)
    batch = _customer_batch(client, owner, db, workshop=workshop, team=team)
    _receipt(client, owner, batch, received_now=3)
    r = client.post(f"/api/v1/production/customer-orders/{batch['id']}/delete", headers=owner)
    assert r.status_code == 200, r.text
    assert r.json()["data"]["had_business"] is True
    db.expire_all()
    current = db.get(ProductionBatch, uuid.UUID(batch["id"]))
    assert current.production_status == "CANCELLED"
    assert current.delivered_quantity == 3  # không mất dữ liệu


def test_delete_customer_order_member_forbidden(client, owner, db):
    username = f"member_{uuid.uuid4().hex[:8]}"
    client.post("/api/v1/users", headers=owner, json={
        "username": username, "password": "safe-pass-123", "display_name": "Member", "phone": None, "role_codes": ["MEMBER"]})
    login = client.post("/api/v1/auth/login", json={"username": username, "password": "safe-pass-123"})
    member = {"Authorization": f"Bearer {login.json()['data']['access_token']}"}
    workshop, team = _masters(client, owner)
    batch = _customer_batch(client, owner, db, workshop=workshop, team=team)
    r = client.post(f"/api/v1/production/customer-orders/{batch['id']}/delete", headers=member)
    assert r.status_code == 403
