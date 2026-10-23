"""Tests cho quyền customer_debt.view — tách "Khách hàng / công nợ" khỏi sales.view.

Đảm bảo:
- MEMBER / KHO (sales.view=true, customer_debt.view=false) vẫn xem được Chi tiết đơn
  và lookup khách hàng tối thiểu cho Tạo đơn, nhưng KHÔNG xem công nợ.
- OWNER xem được cả hai.
"""
from __future__ import annotations

import uuid


def _create_user(client, owner, role="MEMBER"):
    username = f"member_{uuid.uuid4().hex[:8]}"
    response = client.post("/api/v1/users", headers=owner, json={
        "username": username, "password": "safe-pass-123", "display_name": "Người dùng công nợ",
        "phone": None, "role_codes": [role],
    })
    assert response.status_code == 201, response.text
    return response.json()["data"], username


def _login(client, username, password="safe-pass-123"):
    response = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['data']['access_token']}"}


def _member_auth(client, owner):
    _, username = _create_user(client, owner, "MEMBER")
    return _login(client, username)


def test_member_can_view_orders_and_lookup_but_not_debt(client, owner):
    auth = _member_auth(client, owner)
    # Chi tiết đơn (order_detail.view) + lookup tối thiểu (sales.view) vẫn hoạt động.
    assert client.get("/api/v1/order-work-queue", headers=auth).status_code == 200
    assert client.get("/api/v1/customers/lookup", headers=auth).status_code == 200
    # Công nợ đầy đủ bị chặn 403.
    assert client.get("/api/v1/customers", headers=auth).status_code == 403
    assert client.get("/api/v1/customers/debt-changes/today", headers=auth).status_code == 403
    assert client.get("/api/v1/debt/summary", headers=auth).status_code == 403


def test_member_can_open_order_detail_but_no_debt_field(client, owner):
    auth = _member_auth(client, owner)
    queue = client.get("/api/v1/order-work-queue", params={"tab": "NEW"}, headers=auth).json()["data"]
    assert queue, "phải có ít nhất một warehouse section để lấy order"
    section = queue[0]
    customer = section["customers"][0]
    detail = client.get(
        f"/api/v1/order-work-queue/customers/{customer['customer_id']}",
        params={"warehouse_id": section["warehouse"]["id"], "tab": "NEW"}, headers=auth,
    )
    assert detail.status_code == 200, detail.text
    orders = detail.json()["data"]["orders"]
    assert orders, "phải có ít nhất một đơn"
    first = orders[0]
    # Chi tiết đơn có thông tin khách/đơn nhưng KHÔNG lộ công nợ.
    assert "customer_id" in first or "customer_name" in first
    for key in ("debt_amount", "current_debt", "debt_balance", "debt_history", "opening_debt", "payment_ledger"):
        assert key not in first


def test_kho_can_view_orders_and_lookup_but_not_debt(client, owner, picker):
    assert client.get("/api/v1/order-work-queue", headers=picker).status_code == 200
    assert client.get("/api/v1/customers/lookup", headers=picker).status_code == 200
    assert client.get("/api/v1/customers", headers=picker).status_code == 403
    assert client.get("/api/v1/debt/summary", headers=picker).status_code == 403


def test_owner_can_view_customers_and_debt(client, owner):
    assert client.get("/api/v1/customers", headers=owner).status_code == 200
    assert client.get("/api/v1/customers/lookup", headers=owner).status_code == 200
    assert client.get("/api/v1/debt/summary", headers=owner).status_code == 200


def test_lookup_does_not_leak_debt(client, owner):
    lookup = client.get("/api/v1/customers/lookup", headers=owner).json()["data"]
    assert lookup, "lookup phải trả danh sách khách"
    for row in lookup:
        assert set(row.keys()) == {"id", "customer_code", "name", "phone"}
        assert "debt_amount" not in row
