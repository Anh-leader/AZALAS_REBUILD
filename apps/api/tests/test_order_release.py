from sqlalchemy import select

from app.models import AuditLog, InventoryBalance, Order, OrderStatusEvent


def _login(client, username: str, password: str = "demo123") -> dict:
    response = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['data']['access_token']}"}


def _new_order(client, auth):
    section = client.get("/api/v1/order-work-queue", params={"tab": "NEW"}, headers=auth).json()["data"][0]
    customer = section["customers"][0]
    return client.get(
        f"/api/v1/order-work-queue/customers/{customer['customer_id']}",
        params={"warehouse_id": section["warehouse"]["id"], "tab": "NEW"}, headers=auth,
    ).json()["data"]["orders"][0]


def _claim(client, auth):
    order = _new_order(client, auth)
    response = client.post(f"/api/v1/orders/{order['id']}/claim", headers=auth)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def test_release_claim_clears_assignee(client, picker, db):
    claimed = _claim(client, picker)
    response = client.post(f"/api/v1/orders/{claimed['id']}/release-claim",
                           json={"reason": "Kho/xưởng không có hàng"}, headers=picker)
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["claimed_by"] is None
    assert data["claimed_by_name"] is None
    assert data["status"] == "NEW"
    db.expire_all()
    order = db.get(Order, claimed["id"])
    assert order.claimed_by is None
    assert order.claimed_at is None
    assert order.status == "NEW"


def test_other_user_cannot_release(client, picker, db):
    claimed = _claim(client, picker)
    other = _login(client, "thunho")
    response = client.post(f"/api/v1/orders/{claimed['id']}/release-claim",
                           json={"reason": "Chuyển người xử lý"}, headers=other)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "ORDER_NOT_ASSIGNEE"


def test_release_unclaimed_order_fails(client, picker):
    order = _new_order(client, picker)
    response = client.post(f"/api/v1/orders/{order['id']}/release-claim",
                           json={"reason": "Sai kho"}, headers=picker)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "ORDER_NOT_CLAIMED"


def test_release_saved_order_fails(client, picker, db):
    claimed = _claim(client, picker)
    order = db.get(Order, claimed["id"])
    balance = db.scalar(select(InventoryBalance).where(InventoryBalance.warehouse_id == order.warehouse_id))
    variant = balance.variant
    body = {
        "order_id": str(order.id), "version": order.version, "staff_note": "",
        "items": [{
            "product_variant_id": str(variant.id), "product_name": variant.display_name,
            "sales_code": variant.sales_code, "internal_code": variant.internal_code,
            "color": variant.color.canonical_name, "size": variant.size,
            "warehouse_id": str(order.warehouse_id), "quantity": 2,
            "unit_price_amount": 56000, "sale_type": "MaBanHang", "note": "",
        }],
    }
    saved = client.put(f"/api/v1/orders/{order.id}/pick", json=body, headers=picker)
    assert saved.status_code == 200, saved.text
    response = client.post(f"/api/v1/orders/{order.id}/release-claim",
                           json={"reason": "Sai kho"}, headers=picker)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "ORDER_SAVED"


def test_release_then_other_user_claims(client, picker):
    claimed = _claim(client, picker)
    released = client.post(f"/api/v1/orders/{claimed['id']}/release-claim",
                           json={"reason": "Kho không có hàng"}, headers=picker)
    assert released.status_code == 200
    other = _login(client, "thunho")
    response = client.post(f"/api/v1/orders/{claimed['id']}/claim", headers=other)
    assert response.status_code == 200, response.text
    assert response.json()["data"]["status"] == "PICKING"


def test_release_writes_audit_and_status_event(client, picker, db):
    claimed = _claim(client, picker)
    client.post(f"/api/v1/orders/{claimed['id']}/release-claim",
                json={"reason": "Xưởng 1 không có hàng"}, headers=picker)
    order_id = claimed["id"]
    audit = db.scalar(select(AuditLog).where(
        AuditLog.entity_type == "ORDER", AuditLog.entity_id == order_id,
        AuditLog.action == "ORDER_RELEASED",
    ))
    assert audit is not None
    assert audit.after_data["status"] == "NEW"
    assert audit.after_data["claimed_by"] is None
    event = db.scalar(select(OrderStatusEvent).where(
        OrderStatusEvent.order_id == order_id, OrderStatusEvent.to_status == "NEW",
        OrderStatusEvent.reason.is_not(None),
    ))
    assert event is not None
    assert "Xưởng 1 không có hàng" in event.reason


def test_manager_can_release_other_user_order(client, picker, owner, db):
    claimed = _claim(client, picker)
    response = client.post(f"/api/v1/orders/{claimed['id']}/release-claim",
                           json={"reason": "Chuyển nhân viên khác xử lý"}, headers=owner)
    assert response.status_code == 200, response.text
    event = db.scalar(select(OrderStatusEvent).where(
        OrderStatusEvent.order_id == claimed["id"], OrderStatusEvent.to_status == "NEW",
        OrderStatusEvent.reason.is_not(None),
    ))
    assert event is not None
    assert "Manager" in event.reason
