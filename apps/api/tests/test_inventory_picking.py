from decimal import Decimal

from sqlalchemy import select

from app.models import AuditLog, InventoryBalance, InventoryReservation, InvoiceOrder, Order, OrderItem, OrderStatusEvent, ProductVariant


def _login(client, username: str, password: str = "demo123") -> dict:
    response = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['data']['access_token']}"}


def _new_order(client, auth):
    section = client.get("/api/v1/order-work-queue", params={"tab": "NEW"}, headers=auth).json()["data"][0]
    customer = section["customers"][0]
    order = client.get(
        f"/api/v1/order-work-queue/customers/{customer['customer_id']}",
        params={"warehouse_id": section["warehouse"]["id"], "tab": "NEW"}, headers=auth,
    ).json()["data"]["orders"][0]
    return order


def _claim(client, auth):
    order = _new_order(client, auth)
    response = client.post(f"/api/v1/orders/{order['id']}/claim", headers=auth)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _variant_for_order(db, order_id):
    order = db.get(Order, order_id)
    balance = db.scalar(select(InventoryBalance).where(InventoryBalance.warehouse_id == order.warehouse_id))
    return order, balance.variant, balance


def _pick_body(order, variant, quantity=2, price=56000):
    return {
        "order_id": str(order.id), "version": order.version, "staff_note": "Đã kiểm đủ hàng",
        "items": [{
            "product_variant_id": str(variant.id), "product_name": variant.display_name,
            "sales_code": variant.sales_code, "internal_code": variant.internal_code,
            "color": variant.color.canonical_name, "size": variant.size,
            "warehouse_id": str(order.warehouse_id), "quantity": quantity,
            "unit_price_amount": price, "sale_type": "MaBanHang", "note": "Dòng test",
        }],
    }


def test_two_users_claim_one_order_only_one_succeeds(client, owner):
    order = _new_order(client, owner)
    other = _login(client, "thupham")
    assert client.post(f"/api/v1/orders/{order['id']}/claim", headers=owner).status_code == 200
    response = client.post(f"/api/v1/orders/{order['id']}/claim", headers=other)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "ORDER_ALREADY_CLAIMED"


def test_pick_without_valid_lines_fails(client, owner, db):
    claimed = _claim(client, owner)
    order = db.get(Order, claimed["id"])
    _, variant, _ = _variant_for_order(db, order.id)
    body = _pick_body(order, variant, quantity=0)
    body["items"][0]["product_name"] = ""
    response = client.put(f"/api/v1/orders/{order.id}/pick", json=body, headers=owner)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "PICK_ITEMS_REQUIRED"


def test_pick_quantity_nonpositive_fails(client, owner, db):
    claimed = _claim(client, owner)
    order, variant, _ = _variant_for_order(db, claimed["id"])
    response = client.put(f"/api/v1/orders/{order.id}/pick", json=_pick_body(order, variant, -2), headers=owner)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "PICK_ITEMS_REQUIRED"


def test_pick_reserves_without_reducing_on_hand(client, owner, db):
    claimed = _claim(client, owner)
    order, variant, balance = _variant_for_order(db, claimed["id"])
    before_on_hand, before_reserved = balance.on_hand, balance.reserved
    response = client.put(f"/api/v1/orders/{order.id}/pick", json=_pick_body(order, variant, 3), headers=owner)
    assert response.status_code == 200, response.text
    db.expire_all()
    balance = db.get(InventoryBalance, balance.id)
    order = db.get(Order, order.id)
    assert balance.on_hand == before_on_hand
    assert balance.reserved == before_reserved + Decimal(3)
    assert response.json()["data"]["order"]["status"] == "PICKED"
    assert response.json()["data"]["order"]["billing_status"] == "READY"
    assert order.status == "PICKED"
    assert order.billing_status == "READY"
    assert order.claimed_by is not None
    assert db.scalar(select(InvoiceOrder.order_id).where(InvoiceOrder.order_id == order.id)) is None
    event = db.scalar(select(OrderStatusEvent).where(
        OrderStatusEvent.order_id == order.id,
        OrderStatusEvent.to_status == "PICKED",
    ))
    assert event is not None
    assert "chờ gửi hóa đơn" in event.reason
    audit = db.scalar(select(AuditLog).where(
        AuditLog.entity_id == order.id,
        AuditLog.action == "PICK_SAVE",
    ))
    assert audit is not None
    assert audit.before_data["billing_status"] == "DRAFT"
    assert audit.after_data["billing_status"] == "READY"
    assert audit.after_data["status"] == "PICKED"


def test_one_short_line_rolls_back_everything(client, owner, db):
    claimed = _claim(client, owner)
    order = db.get(Order, claimed["id"])
    balances = list(db.scalars(select(InventoryBalance).where(InventoryBalance.warehouse_id == order.warehouse_id).limit(2)))
    before = {balance.id: (balance.on_hand, balance.reserved) for balance in balances}
    body = _pick_body(order, balances[0].variant, 1)
    body["items"].append(_pick_body(order, balances[1].variant, float(balances[1].on_hand + 1))["items"][0])
    response = client.put(f"/api/v1/orders/{order.id}/pick", json=body, headers=owner)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "INSUFFICIENT_STOCK"
    db.expire_all()
    assert db.scalar(select(OrderItem.id).where(OrderItem.order_id == order.id)) is None
    for balance in balances:
        current = db.get(InventoryBalance, balance.id)
        assert (current.on_hand, current.reserved) == before[balance.id]


def test_second_save_replaces_old_reservation(client, owner, db):
    claimed = _claim(client, owner)
    order, variant, balance = _variant_for_order(db, claimed["id"])
    first = client.put(f"/api/v1/orders/{order.id}/pick", json=_pick_body(order, variant, 4), headers=owner)
    assert first.status_code == 200, first.text
    db.expire_all()
    order = db.get(Order, order.id)
    second = client.put(f"/api/v1/orders/{order.id}/pick", json=_pick_body(order, variant, 1), headers=owner)
    assert second.status_code == 200, second.text
    db.expire_all()
    balance = db.get(InventoryBalance, balance.id)
    reservation = db.scalar(select(InventoryReservation).where(InventoryReservation.order_id == order.id))
    active_items = list(db.scalars(select(OrderItem).where(OrderItem.order_id == order.id, OrderItem.active)))
    assert balance.reserved == Decimal(1)
    assert reservation.status == "ACTIVE" and reservation.version == 2
    assert len(active_items) == 1 and active_items[0].quantity == Decimal(1)


def test_pick_cannot_reopen_sent_billing(client, owner, db):
    claimed = _claim(client, owner)
    order, variant, _ = _variant_for_order(db, claimed["id"])
    first = client.put(f"/api/v1/orders/{order.id}/pick", json=_pick_body(order, variant), headers=owner)
    assert first.status_code == 200, first.text
    db.expire_all()
    order = db.get(Order, order.id)
    order.billing_status = "SENT"
    db.commit()
    response = client.put(f"/api/v1/orders/{order.id}/pick", json=_pick_body(order, variant), headers=owner)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "ORDER_BILLING_LOCKED"
    db.expire_all()
    assert db.get(Order, order.id).billing_status == "SENT"


def test_order_detail_contains_items_reservation_and_inventory(client, owner, db):
    claimed = _claim(client, owner)
    order, variant, _ = _variant_for_order(db, claimed["id"])
    saved = client.put(f"/api/v1/orders/{order.id}/pick", json=_pick_body(order, variant, 2), headers=owner)
    assert saved.status_code == 200
    detail = client.get(f"/api/v1/orders/{order.id}", headers=owner).json()["data"]
    assert len(detail["items"]) == 1
    assert detail["reservation"]["status"] == "ACTIVE"
    assert detail["inventory"][0]["on_hand"] >= detail["inventory"][0]["reserved"]


def test_inventory_search_is_accent_insensitive_and_supports_warehouse(client, owner):
    products = client.get("/api/v1/products", params={"q": "quan the thao"}, headers=owner)
    assert products.status_code == 200
    assert products.json()["data"][0]["product_code"] == "DEMO-SP-001"

    variants = client.get("/api/v1/product-variants", params={"q": "do do"}, headers=owner)
    assert variants.status_code == 200
    assert variants.json()["data"] and all(row["color"] == "Đỏ đô" for row in variants.json()["data"])

    balances = client.get("/api/v1/inventory/balances", params={"q": "tan xuan"}, headers=owner)
    assert balances.status_code == 200
    assert balances.json()["data"] and all(
        row["warehouse"]["code"] == "TAN_XUAN" for row in balances.json()["data"]
    )
