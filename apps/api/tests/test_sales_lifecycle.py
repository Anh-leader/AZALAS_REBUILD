import uuid
from decimal import Decimal

from sqlalchemy import func, select

from app.models import (
    Customer, DebtLedgerEntry, InventoryBalance, InventoryReservation,
    InventoryTransaction, Invoice, InvoiceOrder, Order, Product, User, Warehouse,
)


def _create_picked(client, auth, db, *, customer_id=None, quantity=2, price=50000):
    customer = db.get(Customer, customer_id) if customer_id else db.scalar(select(Customer).order_by(Customer.id))
    warehouse = db.scalar(select(Warehouse).where(Warehouse.code == "TAN_XUAN"))
    balance = db.scalar(select(InventoryBalance).where(InventoryBalance.warehouse_id == warehouse.id).order_by(InventoryBalance.id))
    created = client.post("/api/v1/orders", headers={**auth, "Idempotency-Key": uuid.uuid4().hex}, json={
        "customer_id": str(customer.id), "warehouse_mode": "TAN_XUAN",
        "created_date": "2026-10-09", "delivery_date": None,
        "is_urgent": False, "customer_note": "Sales lifecycle test", "media_ids": [],
    })
    assert created.status_code == 201, created.text
    order_id = created.json()["data"][0]["id"]
    claimed = client.post(f"/api/v1/orders/{order_id}/claim", headers=auth)
    assert claimed.status_code == 200, claimed.text
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
    return db.get(Order, uuid.UUID(order_id)), db.get(InventoryBalance, balance.id)


JPEG = b"\xff\xd8\xff" + b"\x00" * 64


def _capture_media(client, auth):
    r = client.post("/api/v1/media/upload", headers=auth, files={"file": ("invoice.jpg", JPEG, "image/jpeg")})
    assert r.status_code == 201, r.text
    return r.json()["data"]["id"]


def _close(client, auth, customer_id, order_ids, *, payments=None, surcharge=0, key=None, captured=True):
    if captured is True:
        captured = _capture_media(client, auth)
    return client.post("/api/v1/invoices/close", headers={**auth, "Idempotency-Key": key or uuid.uuid4().hex}, json={
        "customer_id": str(customer_id), "order_ids": [str(x) for x in order_ids],
        "surcharge_amount": surcharge, "return_ids": [], "payments": payments or [],
        "note": "Chốt test", "expected_debt_amount": None,
        "captured_media_id": captured,
    })


def test_close_multiple_orders_exports_reserved_and_keeps_processing_status(client, owner, db):
    first, balance = _create_picked(client, owner, db, quantity=2)
    second, _ = _create_picked(client, owner, db, customer_id=first.customer_id, quantity=3)
    db.expire_all(); balance = db.get(InventoryBalance, balance.id)
    before_on_hand, before_reserved = balance.on_hand, balance.reserved
    response = _close(client, owner, first.customer_id, [first.id, second.id])
    assert response.status_code == 201, response.text
    db.expire_all(); balance = db.get(InventoryBalance, balance.id)
    assert balance.on_hand == before_on_hand - Decimal(5)
    assert balance.reserved == before_reserved - Decimal(5)
    assert db.get(Order, first.id).status == "PICKED"
    assert db.get(Order, first.id).billing_status == "SENT"
    assert db.scalar(select(func.count()).select_from(InvoiceOrder)) == 2


def test_close_rejects_orders_of_different_customers(client, owner, db):
    customers = list(db.scalars(select(Customer).order_by(Customer.id).limit(2)))
    first, _ = _create_picked(client, owner, db, customer_id=customers[0].id)
    second, _ = _create_picked(client, owner, db, customer_id=customers[1].id)
    response = _close(client, owner, first.customer_id, [first.id, second.id])
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "CUSTOMER_MISMATCH"


def test_close_idempotency_does_not_export_twice(client, owner, db):
    order, balance = _create_picked(client, owner, db, quantity=2)
    key = uuid.uuid4().hex
    first = _close(client, owner, order.customer_id, [order.id], key=key)
    assert first.status_code == 201, first.text
    db.expire_all(); once = db.get(InventoryBalance, balance.id).on_hand
    second = _close(client, owner, order.customer_id, [order.id], key=key)
    assert second.status_code == 201, second.text
    db.expire_all()
    assert db.get(InventoryBalance, balance.id).on_hand == once
    assert db.scalar(select(func.count()).select_from(Invoice)) == 1


def test_stock_shortage_at_close_rolls_back_invoice(client, owner, db):
    order, balance = _create_picked(client, owner, db, quantity=2)
    balance.on_hand = 0; balance.reserved = 0; balance.available = 0; db.commit()
    response = _close(client, owner, order.customer_id, [order.id])
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "INSUFFICIENT_STOCK_AT_CLOSE"
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(Invoice)) == 0
    assert db.get(Order, order.id).billing_status == "DRAFT"
    assert db.scalar(select(func.count()).select_from(InventoryTransaction).where(
        InventoryTransaction.transaction_type == "INVOICE_EXPORT")) == 0


def test_payment_allocation_limit_and_overpayment_credit(client, owner, db):
    order, _ = _create_picked(client, owner, db, quantity=1, price=100000)
    closed = _close(client, owner, order.customer_id, [order.id])
    invoice_id = closed.json()["data"]["id"]
    invalid = client.post("/api/v1/payments", headers={**owner, "Idempotency-Key": uuid.uuid4().hex}, json={
        "customer_id": str(order.customer_id), "amount": 50000, "method": "CASH",
        "allocations": [{"target_type": "INVOICE", "target_id": invoice_id, "allocated_amount": 50001}],
    })
    assert invalid.status_code == 422
    over = client.post("/api/v1/payments", headers={**owner, "Idempotency-Key": uuid.uuid4().hex}, json={
        "customer_id": str(order.customer_id), "amount": 150000, "method": "BANK_TRANSFER",
        "allocations": [{"target_type": "INVOICE", "target_id": invoice_id, "allocated_amount": 100000}],
    })
    assert over.status_code == 201, over.text
    assert over.json()["data"]["unallocated_amount"] == 50000


def test_debt_after_equals_ledger_sum_and_staff_cannot_adjust(client, owner, picker, db):
    order, _ = _create_picked(client, owner, db, quantity=1, price=90000)
    closed = _close(client, owner, order.customer_id, [order.id], payments=[{"amount": 30000, "method": "CASH"}])
    assert closed.status_code == 201, closed.text
    ledger = client.get(f"/api/v1/debt/customers/{order.customer_id}", headers=owner)
    assert ledger.status_code == 200
    ledger_sum = db.scalar(select(func.sum(DebtLedgerEntry.amount_delta)).where(
        DebtLedgerEntry.party_id == order.customer_id))
    assert ledger.json()["data"]["closing"] == ledger_sum
    forbidden = client.post(f"/api/v1/customers/{order.customer_id}/debt-adjustments",
                            headers={**picker, "Idempotency-Key": uuid.uuid4().hex},
                            json={"amount_delta": 1000, "reason": "Không đủ quyền"})
    assert forbidden.status_code == 403


def test_return_approve_once_and_restock(client, owner, db):
    customer = db.scalar(select(Customer).order_by(Customer.id))
    balance = db.scalar(select(InventoryBalance).order_by(InventoryBalance.id))
    created = client.post("/api/v1/returns", headers=owner, json={
        "customer_id": str(customer.id), "warehouse_id": str(balance.warehouse_id), "note": "Hàng lỗi",
        "items": [{"product_variant_id": str(balance.variant_id), "description": "Áo trả",
                   "quantity": 2, "unit_credit_amount": 25000, "condition": "GOOD", "restock": True}],
    })
    assert created.status_code == 201, created.text
    row = created.json()["data"]
    before = balance.on_hand
    key = uuid.uuid4().hex
    approved = client.post(f"/api/v1/returns/{row['id']}/approve",
                           headers={**owner, "Idempotency-Key": key},
                           json={"version": row["version"], "restock": True, "credit": True})
    assert approved.status_code == 200, approved.text
    retried = client.post(f"/api/v1/returns/{row['id']}/approve",
                          headers={**owner, "Idempotency-Key": key},
                          json={"version": row["version"], "restock": True, "credit": True})
    assert retried.status_code == 200
    db.expire_all()
    assert db.get(InventoryBalance, balance.id).on_hand == before + Decimal(2)
    assert db.scalar(select(func.count()).select_from(InventoryTransaction).where(
        InventoryTransaction.reference_id == uuid.UUID(row["id"]))) == 1


def test_invoice_void_appends_reversals_without_deleting_ledger(client, owner, db):
    order, balance = _create_picked(client, owner, db, quantity=2, price=40000)
    before = balance.on_hand
    closed = _close(client, owner, order.customer_id, [order.id], payments=[{"amount": 20000, "method": "CASH"}])
    assert closed.status_code == 201, closed.text
    invoice = closed.json()["data"]
    original_debt_count = db.scalar(select(func.count()).select_from(DebtLedgerEntry))
    voided = client.post(f"/api/v1/invoices/{invoice['id']}/void",
                         headers={**owner, "Idempotency-Key": uuid.uuid4().hex},
                         json={"version": invoice["version"], "reason": "Khách hủy"})
    assert voided.status_code == 200, voided.text
    db.expire_all()
    assert db.get(InventoryBalance, balance.id).on_hand == before
    assert db.scalar(select(func.count()).select_from(DebtLedgerEntry)) > original_debt_count
    assert db.scalar(select(func.count()).select_from(DebtLedgerEntry).where(
        DebtLedgerEntry.reversal_of_id.is_not(None))) >= 1
    assert db.get(Order, order.id).status == "PICKED"
    assert db.get(Order, order.id).billing_status == "VOID"


def test_shipping_state_machine_does_not_touch_billing(client, owner, db):
    order, _ = _create_picked(client, owner, db)
    shipped = client.post(f"/api/v1/orders/{order.id}/shipping-events", headers=owner,
                          json={"event": "START_SHIPPING", "version": order.version})
    assert shipped.status_code == 200, shipped.text
    data = shipped.json()["data"]
    assert data["status"] == "SHIPPING" and data["billing_status"] == "DRAFT"
    invalid = client.post(f"/api/v1/orders/{order.id}/shipping-events", headers=owner,
                          json={"event": "START_SHIPPING", "version": data["version"]})
    assert invalid.status_code == 409


def test_invoice_snapshot_does_not_change_with_master_data(client, owner, db):
    order, _ = _create_picked(client, owner, db, quantity=1, price=77777)
    closed = _close(client, owner, order.customer_id, [order.id])
    assert closed.status_code == 201, closed.text
    invoice_id = uuid.UUID(closed.json()["data"]["id"])
    snapshot = db.get(Invoice, invoice_id).snapshot
    customer = db.get(Customer, order.customer_id)
    product = db.scalar(select(Product).order_by(Product.id))
    customer.name = "Tên đã đổi sau chốt"; product.name = "Sản phẩm đã đổi sau chốt"; db.commit()
    db.expire_all()
    assert db.get(Invoice, invoice_id).snapshot == snapshot
