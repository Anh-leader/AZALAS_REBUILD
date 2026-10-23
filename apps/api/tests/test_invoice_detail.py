import uuid

from sqlalchemy import event, func, select

from app.core.db import engine
from app.models import (
    AuditLog, Customer, InventoryBalance, Invoice, InvoiceOrder, MediaObject,
    Order, OrderItem, Warehouse,
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


def _close(client, auth, customer_id, order_ids, *, captured, payments=None):
    return client.post("/api/v1/invoices/close", headers={**auth, "Idempotency-Key": uuid.uuid4().hex}, json={
        "customer_id": str(customer_id), "order_ids": [str(x) for x in order_ids],
        "surcharge_amount": 0, "return_ids": [], "payments": payments or [],
        "note": "Chốt test", "expected_debt_amount": None, "captured_media_id": captured,
    })


def test_sent_invoice_detail_returns_full_data(client, owner, db):
    order = _create_picked(client, owner, db)
    media_id = _upload(client, owner)
    closed = _close(client, owner, order.customer_id, [order.id], captured=media_id)
    assert closed.status_code == 201, closed.text
    invoice_id = closed.json()["data"]["id"]

    db.expire_all()
    before = db.get(Invoice, uuid.UUID(invoice_id))
    before_version = before.version
    before_status = before.status
    order_before = db.get(Order, order.id)

    r = client.get(f"/api/v1/invoices/{invoice_id}", headers=owner)
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["invoice_no"] == before.invoice_no
    assert data["status"] == "SENT"
    assert data["customer"]["id"] == str(order.customer_id)
    assert data["customer"]["name"] == db.get(Customer, order.customer_id).name
    assert data["warehouse"]["code"] == "TAN_XUAN"
    assert [o["order_no"] for o in data["orders"]] == [order.order_no]
    assert len(data["items"]) == 1
    assert data["items"][0]["name"]
    assert data["items"][0]["quantity"] == 2
    assert data["subtotal_amount"] == 100000
    assert data["total_amount"] == 100000
    assert data["payments"] == []
    assert data["captured_invoice_media_id"] == media_id
    assert data["captured_image"]["id"] == media_id

    # Read-only: mở detail không thay đổi DB.
    db.expire_all()
    assert db.get(Invoice, uuid.UUID(invoice_id)).version == before_version
    assert db.get(Invoice, uuid.UUID(invoice_id)).status == before_status
    assert db.get(Order, order.id).billing_status == order_before.billing_status


def test_paid_invoice_detail_returns_payment_history(client, owner, db):
    order = _create_picked(client, owner, db, quantity=2, price=50000)
    media_id = _upload(client, owner)
    closed = _close(client, owner, order.customer_id, [order.id], captured=media_id,
                    payments=[{"amount": 100000, "method": "CASH", "note": "Trả đủ"}])
    assert closed.status_code == 201, closed.text
    invoice_id = closed.json()["data"]["id"]

    r = client.get(f"/api/v1/invoices/{invoice_id}", headers=owner)
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["status"] == "PAID"
    assert data["paid_amount"] == 100000
    assert data["balance_amount"] == 0
    assert len(data["payments"]) == 1
    assert data["payments"][0]["amount"] == 100000
    assert data["payments"][0]["method"] == "CASH"
    assert data["payments"][0]["note"] == "Trả đủ"


def test_partially_paid_invoice_detail(client, owner, db):
    order = _create_picked(client, owner, db, quantity=2, price=50000)
    media_id = _upload(client, owner)
    closed = _close(client, owner, order.customer_id, [order.id], captured=media_id,
                    payments=[{"amount": 30000, "method": "BANK_TRANSFER", "note": None}])
    assert closed.status_code == 201, closed.text
    invoice_id = closed.json()["data"]["id"]

    r = client.get(f"/api/v1/invoices/{invoice_id}", headers=owner)
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["status"] == "PARTIALLY_PAID"
    assert data["paid_amount"] == 30000
    assert data["balance_amount"] == 70000
    assert len(data["payments"]) == 1
    assert data["payments"][0]["method"] == "BANK_TRANSFER"


def test_invoice_detail_without_image_does_not_crash(client, owner, db):
    order = _create_picked(client, owner, db)
    media_id = _upload(client, owner)
    closed = _close(client, owner, order.customer_id, [order.id], captured=media_id)
    assert closed.status_code == 201, closed.text
    invoice_id = closed.json()["data"]["id"]

    # Xóa ảnh capture để mô phỏng hóa đơn chưa có ảnh (captured_media_id bị SET NULL).
    db.execute(Invoice.__table__.update().where(Invoice.id == uuid.UUID(invoice_id))
               .values(captured_invoice_media_id=None))
    db.commit()

    r = client.get(f"/api/v1/invoices/{invoice_id}", headers=owner)
    assert r.status_code == 200, r.text
    assert r.json()["data"]["captured_image"] is None
    assert r.json()["data"]["captured_invoice_media_id"] is None


def test_deleted_order_detail_reads_audit_logs(client, owner, db):
    order = _create_picked(client, owner, db)
    deleted = client.post("/api/v1/invoices/orders/delete", headers=owner, json={"order_ids": [str(order.id)]})
    assert deleted.status_code == 200, deleted.text
    db.expire_all()

    r = client.get(f"/api/v1/orders/{order.id}/deleted-detail", headers=owner)
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["order_no"] == order.order_no
    assert data["customer"]["id"] == str(order.customer_id)
    assert data["warehouse"]["code"] == "TAN_XUAN"
    assert data["billing_status"] == "DELETED"
    assert data["previous_status"] == "PICKED"
    assert data["deleted_by"] is not None
    assert data["deleted_by"]["display_name"]
    assert data["deleted_at"] is not None
    assert len(data["items"]) == 1

    # Verify metadata thực sự lấy từ audit_logs.
    audit = db.scalar(select(AuditLog).where(
        AuditLog.entity_type == "ORDER", AuditLog.entity_id == order.id,
        AuditLog.action == "DELETE_PENDING",
    ))
    assert audit is not None
    assert audit.after_data == {"billing_status": "DELETED"}

    # Read-only: mở detail không restore order.
    db.expire_all()
    assert db.get(Order, order.id).billing_status == "DELETED"


def test_deleted_order_detail_missing_returns_404(client, owner, db):
    r = client.get(f"/api/v1/orders/{uuid.uuid4()}/deleted-detail", headers=owner)
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "ORDER_NOT_FOUND"


def test_work_queue_sent_uses_bounded_queries(client, owner, db):
    """SENT list phải dùng batch query, không N+1 theo từng hóa đơn."""
    customer = db.scalar(select(Customer).order_by(Customer.id))
    for i in range(10):
        db.add(Invoice(
            invoice_no=f"INV-BATCH-{i}", customer_id=customer.id, status="SENT",
            subtotal_amount=100000, surcharge_amount=0, return_credit_amount=0,
            paid_amount=0, balance_amount=100000, debt_before_amount=0, debt_after_amount=100000,
            snapshot={"customer": {"name": customer.name}}, idempotency_key=f"batch-{i}",
        ))
    db.commit()

    count = {"n": 0}

    def on_exec(conn, cursor, statement, parameters, context, executemany):
        count["n"] += 1

    event.listen(engine, "before_cursor_execute", on_exec)
    try:
        r = client.get("/api/v1/invoices/work-queue", headers=owner, params={"status": "SENT"})
    finally:
        event.remove(engine, "before_cursor_execute", on_exec)

    assert r.status_code == 200, r.text
    assert r.json()["data"]["total"] >= 10
    # Batched path: ~6 queries + 1 auth query, bất kể số hóa đơn.
    # Old N+1 path (~3 queries/invoice) với 10 invoices sẽ vượt ngưỡng này.
    assert count["n"] < 20, f"work-queue SENT chạy quá nhiều query: {count['n']}"

