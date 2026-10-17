import uuid

from sqlalchemy import func, select

from app.models import (
    Customer, DebtLedgerEntry, InventoryBalance, Invoice, InvoiceDraft,
    InvoiceOrder, Order, OrderItem, Warehouse,
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


def _draft(client, auth, customer_id, order_ids):
    r = client.post("/api/v1/invoices/drafts", headers=auth, json={
        "customer_id": str(customer_id), "order_ids": [str(x) for x in order_ids],
    })
    assert r.status_code == 201, r.text
    return r.json()["data"]


def _capture(client, auth, draft_id):
    media_id = _upload(client, auth)
    r = client.post(f"/api/v1/invoices/drafts/{draft_id}/capture", headers=auth, json={"media_id": media_id})
    assert r.status_code == 201, r.text
    return r.json()["data"]


def _finalize(client, auth, draft_id, key=None):
    return client.post(f"/api/v1/invoices/drafts/{draft_id}/finalize",
                       headers={**auth, "Idempotency-Key": key or uuid.uuid4().hex})


def test_pending_orders_only_returns_that_customer(client, owner, db):
    customers = list(db.scalars(select(Customer).order_by(Customer.id)).unique())
    a, b = customers[0].id, customers[1].id
    created_a = _create_picked(client, owner, db, customer_id=a)
    _create_picked(client, owner, db, customer_id=b)

    r = client.get(f"/api/v1/invoices/customers/{a}/pending-orders", headers=owner)
    assert r.status_code == 200, r.text
    orders = r.json()["data"]["orders"]
    # Mọi đơn trả về phải thuộc customer A (kể cả đơn seed có sẵn), không có đơn của B.
    assert str(created_a.id) in [row["id"] for row in orders]
    assert all(row["customer_id"] == str(a) for row in orders)


def test_draft_contains_only_selected_orders_and_others_remain_pending(client, owner, db):
    customer = db.scalar(select(Customer).order_by(Customer.id))
    created = [_create_picked(client, owner, db, customer_id=customer.id) for _ in range(4)]
    selected = created[:2]
    unselected = created[2:]

    draft = _draft(client, owner, customer.id, [o.id for o in selected])
    assert set(draft["order_ids"]) == {str(o.id) for o in selected}
    assert len(draft["orders"]) == 2

    db.expire_all()
    for order in unselected:
        fresh = db.get(Order, order.id)
        assert fresh.billing_status == "READY"
        assert db.scalar(select(InvoiceOrder.id).where(InvoiceOrder.order_id == order.id)) is None


def test_edit_quantity_recomputes_totals(client, owner, db):
    customer = db.scalar(select(Customer).order_by(Customer.id))
    order = _create_picked(client, owner, db, customer_id=customer.id, quantity=2, price=50000)
    draft = _draft(client, owner, customer.id, [order.id])
    item = draft["orders"][0]["items"][0]

    r = client.patch(f"/api/v1/invoices/drafts/{draft['id']}", headers=owner, json={
        "items": [{"order_id": item["order_id"], "item_id": item["id"], "quantity": 3}],
    })
    assert r.status_code == 200, r.text
    updated = r.json()["data"]
    assert updated["orders"][0]["items"][0]["line_total_amount"] == 150000
    assert updated["subtotal_amount"] == 150000


def test_edit_price_recomputes_totals(client, owner, db):
    customer = db.scalar(select(Customer).order_by(Customer.id))
    order = _create_picked(client, owner, db, customer_id=customer.id, quantity=2, price=50000)
    draft = _draft(client, owner, customer.id, [order.id])
    item = draft["orders"][0]["items"][0]

    r = client.patch(f"/api/v1/invoices/drafts/{draft['id']}", headers=owner, json={
        "items": [{"order_id": item["order_id"], "item_id": item["id"], "unit_price_amount": 60000}],
    })
    assert r.status_code == 200, r.text
    assert r.json()["data"]["subtotal_amount"] == 120000


def test_edit_old_debt_recomputes_invoice_totals(client, owner, db):
    customer = db.scalar(select(Customer).order_by(Customer.id))
    order = _create_picked(client, owner, db, customer_id=customer.id, quantity=2, price=50000)
    draft = _draft(client, owner, customer.id, [order.id])

    r = client.patch(f"/api/v1/invoices/drafts/{draft['id']}", headers=owner, json={"old_debt_override": 777000})
    assert r.status_code == 200, r.text
    updated = r.json()["data"]
    assert updated["debt_before_amount"] == 777000
    assert updated["debt_after_before_payment"] == 777000 + 100000


def test_edit_non_integral_line_total_rejected(client, owner, db):
    customer = db.scalar(select(Customer).order_by(Customer.id))
    order = _create_picked(client, owner, db, customer_id=customer.id, quantity=2, price=50000)
    draft = _draft(client, owner, customer.id, [order.id])
    item = draft["orders"][0]["items"][0]

    r = client.patch(f"/api/v1/invoices/drafts/{draft['id']}", headers=owner, json={
        "items": [{"order_id": item["order_id"], "item_id": item["id"], "quantity": 1.5, "unit_price_amount": 11111}],
    })
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "MONEY_FRACTION"


def test_finalize_before_capture_rejected(client, owner, db):
    customer = db.scalar(select(Customer).order_by(Customer.id))
    order = _create_picked(client, owner, db, customer_id=customer.id)
    draft = _draft(client, owner, customer.id, [order.id])

    r = _finalize(client, owner, draft["id"])
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "INVOICE_CAPTURE_REQUIRED"
    db.expire_all()
    assert db.get(Order, order.id).billing_status == "READY"


def test_capture_then_finalize_success(client, owner, db):
    customer = db.scalar(select(Customer).order_by(Customer.id))
    order = _create_picked(client, owner, db, customer_id=customer.id)
    draft = _draft(client, owner, customer.id, [order.id])

    captured = _capture(client, owner, draft["id"])
    assert captured["capture_status"] == "READY"

    r = _finalize(client, owner, draft["id"])
    assert r.status_code == 201, r.text
    invoice = r.json()["data"]
    assert set(invoice["order_ids"]) == {str(order.id)}
    db.expire_all()
    assert db.get(Order, order.id).billing_status == "SENT"


def test_edit_after_capture_marks_capture_stale(client, owner, db):
    customer = db.scalar(select(Customer).order_by(Customer.id))
    order = _create_picked(client, owner, db, customer_id=customer.id, quantity=2, price=50000)
    draft = _draft(client, owner, customer.id, [order.id])
    _capture(client, owner, draft["id"])
    item = draft["orders"][0]["items"][0]

    r = client.patch(f"/api/v1/invoices/drafts/{draft['id']}", headers=owner, json={
        "items": [{"order_id": item["order_id"], "item_id": item["id"], "quantity": 3}],
    })
    assert r.status_code == 200, r.text
    assert r.json()["data"]["capture_status"] == "STALE"

    finalize = _finalize(client, owner, draft["id"])
    assert finalize.status_code == 409
    assert finalize.json()["error"]["code"] == "INVOICE_CAPTURE_REQUIRED"


def test_recapture_then_finalize_success(client, owner, db):
    customer = db.scalar(select(Customer).order_by(Customer.id))
    order = _create_picked(client, owner, db, customer_id=customer.id, quantity=2, price=50000)
    draft = _draft(client, owner, customer.id, [order.id])
    _capture(client, owner, draft["id"])
    item = draft["orders"][0]["items"][0]
    client.patch(f"/api/v1/invoices/drafts/{draft['id']}", headers=owner, json={
        "items": [{"order_id": item["order_id"], "item_id": item["id"], "quantity": 3}],
    })
    recaptured = _capture(client, owner, draft["id"])
    assert recaptured["capture_status"] == "READY"

    r = _finalize(client, owner, draft["id"])
    assert r.status_code == 201, r.text
    db.expire_all()
    assert db.get(Order, order.id).billing_status == "SENT"


def test_finalize_updates_only_selected_orders(client, owner, db):
    customer = db.scalar(select(Customer).order_by(Customer.id))
    created = [_create_picked(client, owner, db, customer_id=customer.id) for _ in range(4)]
    selected = created[:2]
    unselected = created[2:]
    draft = _draft(client, owner, customer.id, [o.id for o in selected])
    _capture(client, owner, draft["id"])

    r = _finalize(client, owner, draft["id"])
    assert r.status_code == 201, r.text
    db.expire_all()
    for order in selected:
        assert db.get(Order, order.id).billing_status == "SENT"
    for order in unselected:
        assert db.get(Order, order.id).billing_status == "READY"
        assert db.scalar(select(InvoiceOrder.id).where(InvoiceOrder.order_id == order.id)) is None


def test_debt_ledger_correct_after_finalize(client, owner, db):
    customer = db.scalar(select(Customer).order_by(Customer.id))
    order = _create_picked(client, owner, db, customer_id=customer.id, quantity=2, price=50000)
    draft = _draft(client, owner, customer.id, [order.id])
    _capture(client, owner, draft["id"])
    before = db.scalar(select(func.coalesce(func.sum(DebtLedgerEntry.amount_delta), 0)).where(
        DebtLedgerEntry.party_type == "CUSTOMER", DebtLedgerEntry.party_id == customer.id
    )) or 0

    r = _finalize(client, owner, draft["id"])
    assert r.status_code == 201, r.text
    db.expire_all()
    after = db.scalar(select(func.coalesce(func.sum(DebtLedgerEntry.amount_delta), 0)).where(
        DebtLedgerEntry.party_type == "CUSTOMER", DebtLedgerEntry.party_id == customer.id
    )) or 0
    assert after == before + 100000


def test_no_double_finalize(client, owner, db):
    customer = db.scalar(select(Customer).order_by(Customer.id))
    order = _create_picked(client, owner, db, customer_id=customer.id)
    draft = _draft(client, owner, customer.id, [order.id])
    _capture(client, owner, draft["id"])

    first = _finalize(client, owner, draft["id"], key="same-key")
    assert first.status_code == 201, first.text
    second = _finalize(client, owner, draft["id"], key="same-key")
    assert second.status_code == 201, second.text
    assert second.json()["data"]["id"] == first.json()["data"]["id"]
    db.expire_all()
    count = db.scalar(select(func.count(Invoice.id)).where(Invoice.customer_id == customer.id))
    assert count == 1


def test_finalize_with_ineligible_order_rejects_without_partial_state(client, owner, db):
    customer = db.scalar(select(Customer).order_by(Customer.id))
    good = _create_picked(client, owner, db, customer_id=customer.id)
    bad = _create_picked(client, owner, db, customer_id=customer.id)
    draft = _draft(client, owner, customer.id, [good.id, bad.id])
    _capture(client, owner, draft["id"])

    db.query(Order).filter(Order.id == bad.id).update({"billing_status": "DELETED"}, synchronize_session=False)
    db.commit()

    r = _finalize(client, owner, draft["id"])
    assert r.status_code == 409
    db.expire_all()
    assert db.get(Order, good.id).billing_status == "READY"
    assert db.scalar(select(Invoice.id).where(Invoice.customer_id == customer.id)) is None


def test_user_without_invoice_permission_forbidden(client, picker, db):
    customer = db.scalar(select(Customer).order_by(Customer.id))
    order = _create_picked(client, picker, db, customer_id=customer.id)

    r = client.post("/api/v1/invoices/drafts", headers=picker, json={
        "customer_id": str(customer.id), "order_ids": [str(order.id)],
    })
    assert r.status_code == 403


def test_edit_draft_without_finalize_does_not_change_debt(client, owner, db):
    customer = db.scalar(select(Customer).order_by(Customer.id))
    order = _create_picked(client, owner, db, customer_id=customer.id, quantity=2, price=50000)
    draft = _draft(client, owner, customer.id, [order.id])

    before = db.scalar(select(func.coalesce(func.sum(DebtLedgerEntry.amount_delta), 0)).where(
        DebtLedgerEntry.party_type == "CUSTOMER", DebtLedgerEntry.party_id == customer.id
    )) or 0

    r = client.patch(f"/api/v1/invoices/drafts/{draft['id']}", headers=owner, json={"old_debt_override": 999000})
    assert r.status_code == 200, r.text

    db.expire_all()
    after = db.scalar(select(func.coalesce(func.sum(DebtLedgerEntry.amount_delta), 0)).where(
        DebtLedgerEntry.party_type == "CUSTOMER", DebtLedgerEntry.party_id == customer.id
    )) or 0
    assert after == before


def test_finalize_old_debt_override_creates_adjustment_ledger_entry(client, owner, db):
    customer = db.scalar(select(Customer).order_by(Customer.id))
    order = _create_picked(client, owner, db, customer_id=customer.id, quantity=2, price=50000)
    draft = _draft(client, owner, customer.id, [order.id])

    actual_debt = int(db.scalar(select(func.coalesce(func.sum(DebtLedgerEntry.amount_delta), 0)).where(
        DebtLedgerEntry.party_type == "CUSTOMER", DebtLedgerEntry.party_id == customer.id
    )) or 0)
    override = actual_debt + 20000
    client.patch(f"/api/v1/invoices/drafts/{draft['id']}", headers=owner, json={"old_debt_override": override})
    _capture(client, owner, draft["id"])

    r = _finalize(client, owner, draft["id"])
    assert r.status_code == 201, r.text

    adjustment = db.scalar(select(DebtLedgerEntry).where(
        DebtLedgerEntry.party_id == customer.id,
        DebtLedgerEntry.entry_type == "ADJUSTMENT",
    ))
    assert adjustment is not None
    assert adjustment.amount_delta == 20000


def test_finalize_with_payment_updates_debt_net(client, owner, db):
    customer = db.scalar(select(Customer).order_by(Customer.id))
    order = _create_picked(client, owner, db, customer_id=customer.id, quantity=2, price=50000)
    draft = _draft(client, owner, customer.id, [order.id])
    client.patch(f"/api/v1/invoices/drafts/{draft['id']}", headers=owner, json={
        "payments": [{"method": "CASH", "amount": 30000, "note": None}],
    })
    _capture(client, owner, draft["id"])

    before = db.scalar(select(func.coalesce(func.sum(DebtLedgerEntry.amount_delta), 0)).where(
        DebtLedgerEntry.party_type == "CUSTOMER", DebtLedgerEntry.party_id == customer.id
    )) or 0

    r = _finalize(client, owner, draft["id"])
    assert r.status_code == 201, r.text

    db.expire_all()
    after = db.scalar(select(func.coalesce(func.sum(DebtLedgerEntry.amount_delta), 0)).where(
        DebtLedgerEntry.party_type == "CUSTOMER", DebtLedgerEntry.party_id == customer.id
    )) or 0
    # subtotal 100000 + payment -30000 = net +70000
    assert after == before + 70000


def test_finalize_invoice_updates_daily_changed_customer_stat(client, owner, db):
    from datetime import datetime
    from zoneinfo import ZoneInfo

    customer = db.scalar(select(Customer).order_by(Customer.id))
    order = _create_picked(client, owner, db, customer_id=customer.id, quantity=2, price=50000)
    draft = _draft(client, owner, customer.id, [order.id])
    _capture(client, owner, draft["id"])

    r = _finalize(client, owner, draft["id"])
    assert r.status_code == 201, r.text

    response = client.get("/api/v1/customers/debt-changes/today", headers=owner)
    assert response.status_code == 200, response.text
    changes = {row["customer_id"]: row for row in response.json()["data"]}
    assert str(customer.id) in changes, response.text
    assert changes[str(customer.id)]["increased_amount"] == 100000


def test_invalid_unselected_order_does_not_block_valid_selected_order(client, owner, db):
    """Khách có 1 đơn không chi tiết (không tick) + 1 đơn hợp lệ (tick) -> tạo draft OK."""
    customer = db.scalar(select(Customer).order_by(Customer.id))
    invalid = _create_picked(client, owner, db, customer_id=customer.id)
    valid = _create_picked(client, owner, db, customer_id=customer.id)
    db.query(OrderItem).filter(OrderItem.order_id == invalid.id, OrderItem.active.is_(True)).update(
        {OrderItem.active: False}, synchronize_session=False,
    )
    db.commit()

    r = client.post("/api/v1/invoices/drafts", headers=owner, json={
        "customer_id": str(customer.id), "order_ids": [str(valid.id)],
    })
    assert r.status_code == 201, r.text
    data = r.json()["data"]
    assert data["order_ids"] == [str(valid.id)]
    assert len(data["orders"]) == 1

    db.expire_all()
    assert db.get(Order, invalid.id).billing_status == "READY"
    assert db.scalar(select(InvoiceOrder.id).where(InvoiceOrder.order_id == invalid.id)) is None


def test_selected_invalid_order_rejected_with_specific_code(client, owner, db):
    customer = db.scalar(select(Customer).order_by(Customer.id))
    invalid = _create_picked(client, owner, db, customer_id=customer.id)
    db.query(OrderItem).filter(OrderItem.order_id == invalid.id, OrderItem.active.is_(True)).update(
        {OrderItem.active: False}, synchronize_session=False,
    )
    db.commit()

    r = client.post("/api/v1/invoices/drafts", headers=owner, json={
        "customer_id": str(customer.id), "order_ids": [str(invalid.id)],
    })
    assert r.status_code == 409
    body = r.json()["error"]
    assert body["code"] == "ORDER_ITEMS_REQUIRED"
    assert str(invalid.id) in body["message"] or invalid.order_no in body["message"]
