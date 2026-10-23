"""Tests đếm đơn theo workflow bucket/tab — đảm bảo không double count và
transition NEW -> PICKING -> PICKED đúng nhóm.

Dùng chung order_metrics.classify_order (single source of truth) và endpoint
order-work-queue (Chi tiết đơn) để khoá hành vi.
"""
from __future__ import annotations

import uuid

from sqlalchemy import select

from app.models import InventoryBalance, Order
from app.services.order_metrics import classify_order


def _login(client, username: str, password: str = "demo123") -> dict:
    response = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['data']['access_token']}"}


def _new_order(client, auth) -> dict:
    section = client.get("/api/v1/order-work-queue", params={"tab": "NEW"}, headers=auth).json()["data"][0]
    customer = section["customers"][0]
    return client.get(
        f"/api/v1/order-work-queue/customers/{customer['customer_id']}",
        params={"warehouse_id": section["warehouse"]["id"], "tab": "NEW"}, headers=auth,
    ).json()["data"]["orders"][0]


def _queue_count(client, auth, tab: str) -> int:
    data = client.get("/api/v1/order-work-queue", params={"tab": tab}, headers=auth).json()["data"]
    return sum(sec["order_count"] for sec in data)


def test_classify_order_is_mutually_exclusive():
    """Không một status nào rơi vào 2 bucket cùng lúc."""
    statuses = ["NEW", "PICKING", "PICKED", "SHIPPING", "COMPLETED", "RETURNED",
                "DEBT_ORDER", "CANCELLED", "DELETED"]
    buckets = {classify_order(Order(order_no=f"T-{s}", status=s, billing_status="DRAFT")) for s in statuses}
    # 5 bucket chuẩn, không có bucket "unclassified" nào bị rò rỉ.
    assert buckets == {"new", "picking", "picked", "debt", "cancelled"}


def test_delivered_and_completed_not_in_new_or_picking():
    """Đơn đã giao / hoàn tất phải rời khỏi 'Đơn mới' và 'Đang soạn'."""
    for status in ("PICKED", "SHIPPING", "COMPLETED", "RETURNED"):
        assert classify_order(Order(order_no=f"T-{status}", status=status, billing_status="DRAFT")) == "picked"


def test_debt_order_bucket():
    assert classify_order(Order(order_no="T-DEBT", status="DEBT_ORDER", billing_status="DRAFT")) == "debt"


def test_cancelled_and_deleted_never_shown_in_active_buckets():
    assert classify_order(Order(order_no="T-C", status="CANCELLED", billing_status="DRAFT")) == "cancelled"
    assert classify_order(Order(order_no="T-D", status="DELETED", billing_status="DRAFT")) == "cancelled"
    # Soft-delete bằng billing_status DELETED cũng phải bị loại khỏi bucket active.
    assert classify_order(Order(order_no="T-D2", status="NEW", billing_status="DELETED")) == "cancelled"


def test_customer_order_new_remains_in_new_bucket():
    """Khách đặt cũng là bucket 'new'; tab CUSTOMER_ORDER tách bằng order_type, không đổi status."""
    assert classify_order(Order(order_no="T-KD", status="NEW", billing_status="DRAFT", order_type="CUSTOMER_ORDER")) == "new"


def test_new_order_counts_new_and_claim_moves_to_picking(client, owner, db):
    before_new = _queue_count(client, owner, "NEW")
    before_picking = _queue_count(client, owner, "PICKING")

    order = _new_order(client, owner)
    assert classify_order(db.get(Order, uuid.UUID(order["id"]))) == "new"

    claimed = client.post(f"/api/v1/orders/{order['id']}/claim", headers=owner)
    assert claimed.status_code == 200, claimed.text
    assert claimed.json()["data"]["status"] == "PICKING"

    assert _queue_count(client, owner, "NEW") == before_new - 1
    assert _queue_count(client, owner, "PICKING") == before_picking + 1


def test_release_moves_order_back_to_new(client, picker):
    order = _new_order(client, picker)
    claimed = client.post(f"/api/v1/orders/{order['id']}/claim", headers=picker)
    assert claimed.json()["data"]["status"] == "PICKING"

    before_new = _queue_count(client, picker, "NEW")
    before_picking = _queue_count(client, picker, "PICKING")

    released = client.post(f"/api/v1/orders/{order['id']}/release-claim",
                           json={"reason": "Kho/xưởng không có hàng"}, headers=picker)
    assert released.status_code == 200, released.text
    assert released.json()["data"]["status"] == "NEW"

    assert _queue_count(client, picker, "NEW") == before_new + 1
    assert _queue_count(client, picker, "PICKING") == before_picking - 1


def test_finish_picking_leaves_new_and_picking(client, picker, db):
    order = _new_order(client, picker)
    order_id = order["id"]
    claimed = client.post(f"/api/v1/orders/{order_id}/claim", headers=picker)
    assert claimed.json()["data"]["status"] == "PICKING"

    before_picking = _queue_count(client, picker, "PICKING")

    row = db.get(Order, uuid.UUID(order_id))
    balance = db.scalar(select(InventoryBalance).where(InventoryBalance.warehouse_id == row.warehouse_id))
    variant = balance.variant
    saved = client.put(f"/api/v1/orders/{order_id}/pick", headers=picker, json={
        "order_id": order_id, "version": row.version, "staff_note": "",
        "items": [{
            "product_variant_id": str(variant.id), "product_name": variant.display_name,
            "sales_code": variant.sales_code, "internal_code": variant.internal_code,
            "color": variant.color.canonical_name, "size": variant.size,
            "warehouse_id": str(row.warehouse_id), "quantity": 1,
            "unit_price_amount": 50000, "sale_type": "MaBanHang", "note": "",
        }],
    })
    assert saved.status_code == 200, saved.text
    assert saved.json()["data"]["order"]["status"] == "PICKED"

    db.expire_all()
    assert classify_order(db.get(Order, uuid.UUID(order_id))) == "picked"

    # PICKING giảm 1 (đơn đã soạn xong rời khỏi tab Đang soạn).
    assert _queue_count(client, picker, "PICKING") == before_picking - 1
