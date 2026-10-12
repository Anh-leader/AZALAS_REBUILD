import uuid

from sqlalchemy import func, select

from app.models import (
    Customer, DebtLedgerEntry, InventoryBalance, Invoice, InvoiceOrder,
    InvoiceCapture, MediaObject, Order, OrderItem, Payment, Warehouse,
)

JPEG = b"\xff\xd8\xff" + b"\x00" * 128


def _upload(client, auth, name="invoice.jpg"):
    r = client.post("/api/v1/media/upload", headers=auth, files={"file": (name, JPEG, "image/jpeg")})
    assert r.status_code == 201, r.text
    return r.json()["data"]["id"]


def _create_picked(client, auth, db, *, customer_id=None, quantity=2, price=50000):
    customer = db.get(Customer, customer_id) if customer_id else db.scalar(select(Customer).order_by(Customer.id))
    warehouse = db.scalar(select(Warehouse).where(Warehouse.code == "TAN_XUAN"))
    balance = db.scalar(select(InventoryBalance).where(InventoryBalance.warehouse_id == warehouse.id).order_by(InventoryBalance.id))
    created = client.post("/api/v1/orders", headers={**auth, "Idempotency-Key": uuid.uuid4().hex}, json={
        "customer_id": str(customer.id), "warehouse_mode": "TAN_XUAN",
        "created_date": "2026-10-10", "delivery_date": None, "is_urgent": False,
        "customer_note": None, "media_ids": [],
    })
    assert created.status_code == 201, created.text
    order_id = created.json()["data"][0]["id"]
    assert client.post(f"/api/v1/orders/{order_id}/claim", headers=auth).status_code == 200
    db.expire_all()
    order = db.get(Order, uuid.UUID(order_id))
    variant = balance.variant
    picked = client.put(f"/api/v1/orders/{order_id}/pick", headers=auth, json={
        "order_id": order_id, "version": order.version, "staff_note": "Đủ hàng",
        "items": [{"product_variant_id": str(variant.id), "product_name": variant.display_name,
                   "sales_code": variant.sales_code, "internal_code": variant.internal_code,
                   "color": variant.color.canonical_name, "size": variant.size,
                   "warehouse_id": str(warehouse.id), "quantity": quantity,
                   "unit_price_amount": price, "sale_type": "MaBanHang", "note": None}],
    })
    assert picked.status_code == 200, picked.text
    db.expire_all()
    return db.get(Order, uuid.UUID(order_id))


def _close(client, auth, customer_id, order_ids, *, captured, key=None):
    return client.post("/api/v1/invoices/close", headers={**auth, "Idempotency-Key": key or uuid.uuid4().hex}, json={
        "customer_id": str(customer_id), "order_ids": [str(x) for x in order_ids],
        "surcharge_amount": 0, "return_ids": [], "payments": [],
        "note": "Chốt test", "expected_debt_amount": None, "captured_media_id": captured,
    })


# 1. Order PICKED xuất hiện trong Chưa gửi đơn.
def test_picked_order_appears_in_pending_work_queue(client, owner, db):
    order = _create_picked(client, owner, db)
    assert order.status == "PICKED"
    assert order.billing_status == "READY"
    assert db.scalar(select(Invoice.id).where(Invoice.customer_id == order.customer_id)) is None
    r = client.get("/api/v1/invoices/work-queue", headers=owner, params={"status": "PENDING"})
    assert r.status_code == 200
    order_ids = [o["id"] for g in r.json()["data"]["groups"] for o in g["orders"]]
    assert str(order.id) in order_ids


def test_invoice_group_marks_order_without_items_and_valid_order_remains_previewable(client, owner, db):
    incomplete = _create_picked(client, owner, db)
    valid = _create_picked(client, owner, db, customer_id=incomplete.customer_id)
    db.query(OrderItem).filter(OrderItem.order_id == incomplete.id, OrderItem.active.is_(True)).update(
        {OrderItem.active: False}, synchronize_session=False,
    )
    db.commit()

    queue = client.get("/api/v1/invoices/work-queue", headers=owner, params={"status": "PENDING"})
    assert queue.status_code == 200, queue.text
    group = next(group for group in queue.json()["data"]["groups"] if group["customer_id"] == str(valid.customer_id))
    readiness = {row["id"]: row["has_active_items"] for row in group["orders"]}
    assert readiness[str(incomplete.id)] is False
    assert readiness[str(valid.id)] is True

    preview = client.post("/api/v1/invoices/preview", headers=owner, json={
        "customer_id": str(valid.customer_id), "order_ids": [str(valid.id)],
        "surcharge_amount": 0, "return_ids": [],
    })
    assert preview.status_code == 200, preview.text
    assert [row["id"] for row in preview.json()["data"]["orders"]] == [str(valid.id)]

    invalid_preview = client.post("/api/v1/invoices/preview", headers=owner, json={
        "customer_id": str(valid.customer_id), "order_ids": [str(incomplete.id)],
        "surcharge_amount": 0, "return_ids": [],
    })
    assert invalid_preview.status_code == 409
    assert invalid_preview.json()["error"]["code"] == "ORDER_ITEMS_REQUIRED"

    media_id = _upload(client, owner)
    captured = client.post("/api/v1/invoices/capture-image", headers=owner, json={
        "customer_id": str(valid.customer_id), "order_ids": [str(valid.id)], "media_id": media_id,
    })
    assert captured.status_code == 201, captured.text
    closed = _close(client, owner, valid.customer_id, [valid.id], captured=media_id)
    assert closed.status_code == 201, closed.text
    assert closed.json()["data"]["order_ids"] == [str(valid.id)]
    db.expire_all()
    assert db.get(Order, incomplete.id).billing_status == "READY"
    assert db.scalar(select(InvoiceOrder.order_id).where(InvoiceOrder.order_id == incomplete.id)) is None


def test_pending_queue_excludes_unpicked_sent_cancelled_and_deleted_orders(client, owner, db):
    pending_order = _create_picked(client, owner, db)
    customer = db.get(Customer, pending_order.customer_id)

    def create_order():
        response = client.post("/api/v1/orders", headers={**owner, "Idempotency-Key": uuid.uuid4().hex}, json={
            "customer_id": str(customer.id), "warehouse_mode": "TAN_XUAN",
            "created_date": "2026-10-10", "delivery_date": None, "is_urgent": False,
            "customer_note": None, "media_ids": [],
        })
        assert response.status_code == 201, response.text
        return db.get(Order, uuid.UUID(response.json()["data"][0]["id"]))

    unpicked = create_order()
    cancelled = create_order()
    cancelled.status = "CANCELLED"
    sent = create_order()
    sent.status = "PICKED"
    sent.billing_status = "SENT"
    deleted = create_order()
    deleted.status = "PICKED"
    deleted.billing_status = "DELETED"
    db.commit()

    response = client.get("/api/v1/invoices/work-queue", headers=owner, params={"status": "PENDING"})
    assert response.status_code == 200, response.text
    queued_ids = {order["id"] for group in response.json()["data"]["groups"] for order in group["orders"]}
    assert str(pending_order.id) in queued_ids
    assert str(unpicked.id) not in queued_ids
    assert str(cancelled.id) not in queued_ids
    assert str(sent.id) not in queued_ids
    assert str(deleted.id) not in queued_ids


# 2. Preview trả đúng detail.
def test_preview_returns_detail(client, owner, db):
    order = _create_picked(client, owner, db)
    r = client.post("/api/v1/invoices/preview", headers=owner, json={
        "customer_id": str(order.customer_id), "order_ids": [str(order.id)],
        "surcharge_amount": 0, "return_ids": [],
    })
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["orders"][0]["id"] == str(order.id)
    assert data["subtotal_amount"] > 0


# 3. Chưa có captured image -> confirm close 409 INVOICE_CAPTURE_REQUIRED.
def test_close_without_capture_is_rejected(client, owner, db):
    order = _create_picked(client, owner, db)
    r = _close(client, owner, order.customer_id, [order.id], captured=None)
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "INVOICE_CAPTURE_REQUIRED"


# 4. Capture image -> capture record lưu media.
def test_capture_image_creates_media_link(client, owner, db):
    order = _create_picked(client, owner, db)
    media_id = _upload(client, owner)
    r = client.post("/api/v1/invoices/capture-image", headers=owner, json={
        "customer_id": str(order.customer_id), "order_ids": [str(order.id)], "media_id": media_id,
    })
    assert r.status_code == 201, r.text
    assert r.json()["data"]["media_id"] == media_id
    assert db.scalar(select(InvoiceCapture.id).where(InvoiceCapture.media_id == uuid.UUID(media_id))) is not None
    restored = client.get("/api/v1/invoices/capture-image", headers=owner, params={
        "customer_id": str(order.customer_id), "order_ids": str(order.id),
    })
    assert restored.status_code == 200, restored.text
    assert restored.json()["data"]["media_id"] == media_id


# 5 + 6. Capture xong -> confirm close thành công, invoice SENT.
def test_capture_then_close_succeeds_and_invoice_is_sent(client, owner, db):
    order = _create_picked(client, owner, db)
    media_id = _upload(client, owner)
    r = _close(client, owner, order.customer_id, [order.id], captured=media_id)
    assert r.status_code == 201, r.text
    invoice = r.json()["data"]
    assert invoice["status"] == "SENT"
    assert invoice["captured_invoice_media_id"] == media_id
    assert invoice["captured_image"]["id"] == media_id


# 7. Retry cùng idempotency key không tạo nợ/payment trùng.
def test_close_idempotency_no_duplicate_debt(client, owner, db):
    order = _create_picked(client, owner, db)
    media_id = _upload(client, owner)
    key = uuid.uuid4().hex
    before_debt = db.scalar(select(func.count()).select_from(DebtLedgerEntry))
    first = _close(client, owner, order.customer_id, [order.id], captured=media_id, key=key)
    assert first.status_code == 201
    second = _close(client, owner, order.customer_id, [order.id], captured=media_id, key=key)
    assert second.status_code == 201
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(DebtLedgerEntry)) == before_debt + 1
    assert db.scalar(select(func.count()).select_from(Invoice)) == 1
    assert db.scalar(select(func.count()).select_from(Payment)) == 0


# 7b. Sau khi chốt (có InvoiceOrder), order không còn trong Chưa gửi đơn.
def test_invoiced_order_removed_from_pending(client, owner, db):
    order = _create_picked(client, owner, db)
    media_id = _upload(client, owner)
    assert _close(client, owner, order.customer_id, [order.id], captured=media_id).status_code == 201
    r = client.get("/api/v1/invoices/work-queue", headers=owner, params={"status": "PENDING"})
    order_ids = [o["id"] for g in r.json()["data"]["groups"] for o in g["orders"]]
    assert str(order.id) not in order_ids


# 8. Delete pending -> DELETED, không xóa vật lý.
def test_delete_pending_soft_deletes(client, owner, db):
    order = _create_picked(client, owner, db)
    r = client.post("/api/v1/invoices/orders/delete", headers=owner, json={"order_ids": [str(order.id)]})
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(Order, order.id) is not None
    assert db.get(Order, order.id).billing_status == "DELETED"


# 9. Deleted order không còn trong Chưa gửi đơn.
def test_deleted_order_not_in_pending(client, owner, db):
    order = _create_picked(client, owner, db)
    client.post("/api/v1/invoices/orders/delete", headers=owner, json={"order_ids": [str(order.id)]})
    r = client.get("/api/v1/invoices/work-queue", headers=owner, params={"status": "PENDING"})
    order_ids = [o["id"] for g in r.json()["data"]["groups"] for o in g["orders"]]
    assert str(order.id) not in order_ids
    rd = client.get("/api/v1/invoices/work-queue", headers=owner, params={"status": "DELETED"})
    deleted_ids = [o["id"] for g in rd.json()["data"]["groups"] for o in g["orders"]]
    assert str(order.id) in deleted_ids


# 10. Restore -> quay lại Chưa gửi đơn.
def test_restore_returns_to_pending(client, owner, db):
    order = _create_picked(client, owner, db)
    client.post("/api/v1/invoices/orders/delete", headers=owner, json={"order_ids": [str(order.id)]})
    r = client.post("/api/v1/invoices/orders/restore", headers=owner, json={"order_ids": [str(order.id)]})
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(Order, order.id).billing_status == "READY"


# 11. Search theo mã đơn.
def test_search_by_order_no(client, owner, db):
    order = _create_picked(client, owner, db)
    r = client.get("/api/v1/invoices/work-queue", headers=owner, params={"status": "PENDING", "q": order.order_no})
    order_ids = [o["id"] for g in r.json()["data"]["groups"] for o in g["orders"]]
    assert str(order.id) in order_ids
    r2 = client.get("/api/v1/invoices/work-queue", headers=owner, params={"status": "PENDING", "q": "ZZZ-NOT-EXIST"})
    assert r2.json()["data"]["total"] == 0


# 12. Search theo tên khách.
def test_search_by_customer_name(client, owner, db):
    order = _create_picked(client, owner, db)
    name = db.get(Customer, order.customer_id).name
    r = client.get("/api/v1/invoices/work-queue", headers=owner, params={"status": "PENDING", "q": name})
    names = [g["customer_name"] for g in r.json()["data"]["groups"]]
    assert name in names


# 13. Role trái quyền bị 403.
def test_forbidden_role_on_delete(client, owner, db):
    order = _create_picked(client, owner, db)
    username = f"hr_{uuid.uuid4().hex[:8]}"
    cu = client.post("/api/v1/users", headers=owner, json={
        "username": username, "password": "safe-pass-123", "display_name": "Nhân sự",
        "phone": None, "role_codes": ["NHAN_SU"],
    })
    assert cu.status_code == 201
    login = client.post("/api/v1/auth/login", json={"username": username, "password": "safe-pass-123"})
    auth = {"Authorization": f"Bearer {login.json()['data']['access_token']}"}
    assert client.post("/api/v1/invoices/orders/delete", headers=auth,
                       json={"order_ids": [str(order.id)]}).status_code == 403
    media_id = _upload(client, owner)
    assert _close(client, auth, order.customer_id, [order.id], captured=media_id).status_code == 403


# 14. Reload từ DB vẫn giữ status + captured media.
def test_reload_keeps_status_and_captured_media(client, owner, db):
    order = _create_picked(client, owner, db)
    media_id = _upload(client, owner)
    r = _close(client, owner, order.customer_id, [order.id], captured=media_id)
    assert r.status_code == 201
    invoice_id = r.json()["data"]["id"]
    db.expire_all()
    inv = db.get(Invoice, uuid.UUID(invoice_id))
    assert inv.status == "SENT"
    assert str(inv.captured_invoice_media_id) == media_id
    assert db.get(MediaObject, uuid.UUID(media_id)) is not None
