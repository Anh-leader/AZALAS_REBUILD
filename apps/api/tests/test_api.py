import uuid
from datetime import date, datetime, time as datetime_time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import delete, select

from app.core.text import fold
from app.models import (
    AuditLog, Customer, DebtLedgerEntry, InventoryBalance, InventoryReservation,
    InventoryReservationLine, Invoice, InvoiceOrder, MediaObject, Order, OrderGroup,
    OrderItem, OrderItemRevision, OrderMedia, OrderStatusEvent, Partner, Payment,
    ProductVariant, User, Warehouse,
)
from app.services.orders import generate_order_no


def test_health(client):
    assert client.get("/health/live").json() == {"status": "ok"}


def test_login_ok_wrong_locked(client, db):
    r = client.post("/api/v1/auth/login", json={"username": "owner", "password": "owner123"})
    assert r.status_code == 200
    assert r.json()["data"]["user"]["role"] == "OWNER"

    r = client.post("/api/v1/auth/login", json={"username": "owner", "password": "sai"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "INVALID_CREDENTIALS"

    u = db.scalar(select(User).where(User.username == "hoang"))
    u.status = "LOCKED"
    db.commit()
    r = client.post("/api/v1/auth/login", json={"username": "hoang", "password": "demo123"})
    assert r.status_code == 403


def test_requires_auth(client):
    assert client.get("/api/v1/customers").status_code == 401


def test_customer_sorts_and_total(client, owner):
    def get(sort, q=None):
        params = {"sort": sort} | ({"q": q} if q else {})
        return client.get("/api/v1/customers", params=params, headers=owner).json()

    desc = get("debt_desc")
    debts = [c["debt_amount"] for c in desc["data"]]
    assert debts == sorted(debts, reverse=True)
    asc = [c["debt_amount"] for c in get("debt_asc")["data"]]
    assert asc == sorted(asc)
    names = [fold(c["name"]) for c in get("name_asc")["data"]]
    assert names == sorted(names)
    names_desc = [fold(c["name"]) for c in get("name_desc")["data"]]
    assert names_desc == sorted(names_desc, reverse=True)
    assert desc["meta"]["total_debt_amount"] == sum(d for d in debts if d > 0)

    # Tìm không dấu
    found = get("debt_desc", "cuong au co")["data"]
    assert [c["name"] for c in found] == ["cường âu cơ"]


def test_customer_created_date_sort(client, owner, db):
    older = Customer(customer_code="KH-CREATED-OLD", name="Khách tạo cũ")
    newer = Customer(customer_code="KH-CREATED-NEW", name="Khách tạo mới")
    db.add_all([older, newer])
    db.flush()
    older.created_at = datetime(2024, 1, 1, tzinfo=timezone.utc)
    newer.created_at = datetime(2025, 1, 1, tzinfo=timezone.utc)
    db.commit()

    response = client.get("/api/v1/customers", headers=owner, params={"sort": "created_desc"})
    assert response.status_code == 200
    codes = [customer["customer_code"] for customer in response.json()["data"]]
    assert codes.index("KH-CREATED-NEW") < codes.index("KH-CREATED-OLD")

    response = client.get("/api/v1/customers", headers=owner, params={"sort": "created_asc"})
    assert response.status_code == 200
    codes = [customer["customer_code"] for customer in response.json()["data"]]
    assert codes.index("KH-CREATED-OLD") < codes.index("KH-CREATED-NEW")


def test_customer_debt_changes_today_uses_vietnam_business_day(client, owner, db):
    business_tz = ZoneInfo("Asia/Ho_Chi_Minh")
    today = datetime.now(business_tz).date()
    today_event = datetime.combine(today, datetime_time(0, 30), tzinfo=business_tz)
    yesterday_event = today_event - timedelta(minutes=60)
    payer = Customer(customer_code="KH-TODAY-PAYER", name="Khách trả hôm nay")
    adjusted = Customer(customer_code="KH-TODAY-ADJUST", name="Khách thay đổi hôm nay")
    old_activity = Customer(customer_code="KH-YESTERDAY", name="Khách thay đổi hôm qua")
    db.add_all([payer, adjusted, old_activity])
    db.flush()
    db.add_all([
        DebtLedgerEntry(
            party_type="CUSTOMER", party_id=payer.id, occurred_at=today_event,
            entry_type="PAYMENT", amount_delta=-25_000,
        ),
        DebtLedgerEntry(
            party_type="CUSTOMER", party_id=payer.id, occurred_at=today_event,
            entry_type="RETURN_CREDIT", amount_delta=-10_000,
        ),
        DebtLedgerEntry(
            party_type="CUSTOMER", party_id=adjusted.id, occurred_at=today_event,
            entry_type="INVOICE", amount_delta=40_000,
        ),
        DebtLedgerEntry(
            party_type="CUSTOMER", party_id=old_activity.id, occurred_at=yesterday_event,
            entry_type="PAYMENT", amount_delta=-99_000,
        ),
    ])
    db.commit()

    response = client.get("/api/v1/customers/debt-changes/today", headers=owner)
    assert response.status_code == 200, response.text
    changes = {row["customer_code"]: row for row in response.json()["data"]}
    assert changes["KH-TODAY-PAYER"]["paid_amount"] == 25_000
    assert changes["KH-TODAY-PAYER"]["reduced_amount"] == 35_000
    assert changes["KH-TODAY-PAYER"]["net_change"] == -35_000
    assert changes["KH-TODAY-ADJUST"]["paid_amount"] == 0
    assert changes["KH-TODAY-ADJUST"]["increased_amount"] == 40_000
    assert "KH-YESTERDAY" not in changes


def test_create_customer(client, owner):
    r = client.post("/api/v1/customers", json={"name": "  Khách mới  ", "phone": ""}, headers=owner)
    assert r.status_code == 201
    assert r.json()["data"]["name"] == "Khách mới"
    assert r.json()["data"]["phone"] is None


def _customer_id(db, name="kb pat"):
    return str(db.scalar(select(Customer.id).where(Customer.name == name)))


def test_create_order_both_and_idempotent(client, owner, db):
    body = {
        "customer_id": _customer_id(db),
        "warehouse_mode": "BOTH",
        "created_date": date.today().isoformat(),
        "delivery_date": date.today().isoformat(),
        "is_urgent": True,
        "customer_note": "Test",
    }
    headers = owner | {"Idempotency-Key": str(uuid.uuid4())}
    r = client.post("/api/v1/orders", json=body, headers=headers)
    assert r.status_code == 201, r.text
    orders = r.json()["data"]
    assert len(orders) == 2
    assert {o["warehouse"]["code"] for o in orders} == {"TAN_XUAN", "CA_KOI"}
    assert orders[0]["order_group_id"] and orders[0]["order_group_id"] == orders[1]["order_group_id"]
    assert {o["order_no"][-3:] for o in orders} == {"-TX", "-CK"}
    assert all(o["status"] == "NEW" for o in orders)

    again = client.post("/api/v1/orders", json=body, headers=headers).json()["data"]
    assert {o["id"] for o in again} == {o["id"] for o in orders}
    assert db.query(Order).filter(Order.idempotency_key == headers["Idempotency-Key"]).count() == 2


def test_create_order_resolves_warehouse_by_name_when_code_differs(client, owner, db):
    """Regression: production warehouses use code TX/CK (not TAN_XUAN/CA_KOI).

    The backend must resolve `warehouse_mode` by the stable warehouse name, so a
    warehouse with a non-matching `code` is still found and the created order
    carries the real warehouse id (not a display name or mode string).
    """
    tx = db.scalar(select(Warehouse).where(Warehouse.name == "Tân Xuân"))
    ck = db.scalar(select(Warehouse).where(Warehouse.name == "Cá Koi"))
    assert tx is not None and ck is not None
    tx.code = "TX"
    ck.code = "CK"
    db.commit()

    headers = {"Idempotency-Key": str(uuid.uuid4())}

    # Cá Koi -> warehouse Cá Koi (code CK)
    r = client.post("/api/v1/orders", json={
        "customer_id": _customer_id(db), "warehouse_mode": "CA_KOI",
        "created_date": date.today().isoformat(),
    }, headers=owner | headers)
    assert r.status_code == 201, r.text
    order = r.json()["data"][0]
    assert order["warehouse"]["code"] == "CK"
    assert order["warehouse"]["id"] == str(ck.id)

    # Tân Xuân -> warehouse Tân Xuân (code TX)
    r = client.post("/api/v1/orders", json={
        "customer_id": _customer_id(db), "warehouse_mode": "TAN_XUAN",
        "created_date": date.today().isoformat(),
    }, headers=owner | {"Idempotency-Key": str(uuid.uuid4())})
    assert r.status_code == 201, r.text
    order = r.json()["data"][0]
    assert order["warehouse"]["code"] == "TX"
    assert order["warehouse"]["id"] == str(tx.id)

    # BOTH -> cả hai kho (code TX + CK)
    r = client.post("/api/v1/orders", json={
        "customer_id": _customer_id(db), "warehouse_mode": "BOTH",
        "created_date": date.today().isoformat(),
    }, headers=owner | {"Idempotency-Key": str(uuid.uuid4())})
    assert r.status_code == 201, r.text
    codes = {o["warehouse"]["code"] for o in r.json()["data"]}
    assert codes == {"TX", "CK"}


def test_create_order_missing_warehouse_returns_422(client, owner, db):
    """Khi kho không tồn tại (theo name) backend trả 422 rõ ràng."""
    ck = db.scalar(select(Warehouse).where(Warehouse.name == "Cá Koi"))
    ck.name = "Đã đổi tên"
    db.commit()
    r = client.post("/api/v1/orders", json={
        "customer_id": _customer_id(db), "warehouse_mode": "CA_KOI",
        "created_date": date.today().isoformat(),
    }, headers=owner | {"Idempotency-Key": str(uuid.uuid4())})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "WAREHOUSE_NOT_FOUND"


def test_create_order_validation(client, owner, db):
    body = {"customer_id": str(uuid.uuid4()), "warehouse_mode": "TAN_XUAN", "created_date": "2026-10-08"}
    r = client.post("/api/v1/orders", json=body, headers=owner)
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "CUSTOMER_NOT_FOUND"


def test_bulk_order_creates_independent_orders_and_replays_idempotently(client, owner, db):
    customer_ids = [str(customer.id) for customer in db.scalars(select(Customer).order_by(Customer.id).limit(3))]
    key = uuid.uuid4().hex
    group_count_before = db.query(OrderGroup).count()
    body = {
        "warehouse_mode": "BOTH",
        "created_date": date.today().isoformat(),
        "delivery_date": None,
        "is_urgent": True,
        "common_note": "Giao buổi chiều",
        "customers": [
            {"customer_id": customer_ids[0], "note": "Gọi trước"},
            {"customer_id": customer_ids[1], "note": "Không gấp"},
            {"customer_id": customer_ids[2], "note": ""},
        ],
    }
    response = client.post("/api/v1/orders/bulk", headers=owner | {"Idempotency-Key": key}, json=body)
    assert response.status_code == 201, response.text
    created = response.json()["data"]
    assert len(created) == 6
    assert {row["customer_id"] for row in created} == set(customer_ids)
    assert len({row["order_no"] for row in created}) == 6
    for customer_id in customer_ids:
        rows = [row for row in created if row["customer_id"] == customer_id]
        assert len(rows) == 2
        orders = [db.get(Order, uuid.UUID(row["order_id"])) for row in rows]
        assert len({order.order_group_id for order in orders}) == 1
        assert orders[0].order_group_id is not None
        assert {order.warehouse.code for order in orders} == {"TAN_XUAN", "CA_KOI"}
        assert all("Giao buổi chiều" in order.customer_note for order in orders)
        assert all(db.scalar(select(OrderStatusEvent.id).where(OrderStatusEvent.order_id == order.id)) for order in orders)
        assert all(db.scalar(select(AuditLog.id).where(AuditLog.entity_id == order.id, AuditLog.action == "CREATE")) for order in orders)
    assert db.query(OrderGroup).count() == group_count_before + 3

    replay = client.post("/api/v1/orders/bulk", headers=owner | {"Idempotency-Key": key}, json=body)
    assert replay.status_code == 201
    assert {row["order_id"] for row in replay.json()["data"]} == {row["order_id"] for row in created}
    assert db.query(Order).filter(Order.idempotency_key.in_([f"{key}:{index}" for index in range(3)])).count() == 6


def test_bulk_order_rolls_back_every_customer_on_invalid_row(client, owner, db):
    customer_ids = [str(customer.id) for customer in db.scalars(select(Customer).order_by(Customer.id).limit(2))]
    key = uuid.uuid4().hex
    response = client.post("/api/v1/orders/bulk", headers=owner | {"Idempotency-Key": key}, json={
        "warehouse_mode": "TAN_XUAN",
        "created_date": date.today().isoformat(),
        "customers": [
            {"customer_id": customer_ids[0]},
            {"customer_id": str(uuid.uuid4())},
        ],
    })
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "CUSTOMER_NOT_FOUND"
    assert db.query(Order).filter(Order.idempotency_key.in_([f"{key}:0", f"{key}:1"])).count() == 0


def test_order_no_format():
    no = generate_order_no()
    assert no.startswith("HD") and len(no) == 15 and no[2:].isdigit()


def test_work_queue_groups_by_warehouse_and_customer_id(client, owner):
    data = client.get("/api/v1/order-work-queue", params={"tab": "NEW"}, headers=owner).json()["data"]
    assert [s["warehouse"]["code"] for s in data] == ["TAN_XUAN", "CA_KOI"]
    for sec in data:
        ids = [c["customer_id"] for c in sec["customers"]]
        assert len(ids) == len(set(ids))
        assert sec["order_count"] == sum(c["order_count"] for c in sec["customers"])
    tx = data[0]
    # Hai khách cùng tên "chị My" vẫn là 2 thẻ riêng
    assert len([c for c in tx["customers"] if c["customer_name"] == "chị My"]) == 2


def test_customer_orders_in_warehouse(client, owner):
    data = client.get("/api/v1/order-work-queue", params={"tab": "NEW"}, headers=owner).json()["data"]
    sec = data[0]
    grp = max(sec["customers"], key=lambda c: c["order_count"])
    r = client.get(
        f"/api/v1/order-work-queue/customers/{grp['customer_id']}",
        params={"warehouse_id": sec["warehouse"]["id"], "tab": "NEW"},
        headers=owner,
    ).json()["data"]
    assert len(r["orders"]) == grp["order_count"]
    assert all(o["warehouse"]["id"] == sec["warehouse"]["id"] for o in r["orders"])
    assert all(o["customer_id"] == grp["customer_id"] for o in r["orders"])


def test_search_queue(client, owner):
    data = client.get("/api/v1/order-work-queue", params={"tab": "NEW", "q": "kb pat"}, headers=owner).json()["data"]
    names = {c["customer_name"] for s in data for c in s["customers"]}
    assert names == {"kb pat"}


def test_finish_picking_cannot_bypass_details(client, owner):
    row = client.get("/api/v1/order-work-queue", params={"tab": "NEW"}, headers=owner).json()["data"][0]
    customer = row["customers"][0]
    order = client.get(
        f"/api/v1/order-work-queue/customers/{customer['customer_id']}",
        params={"warehouse_id": row["warehouse"]["id"], "tab": "NEW"}, headers=owner,
    ).json()["data"]["orders"][0]
    claimed = client.post(f"/api/v1/orders/{order['id']}/claim", headers=owner)
    assert claimed.status_code == 200
    assert claimed.json()["data"]["status"] == "PICKING"
    done = client.post(f"/api/v1/orders/{order['id']}/finish-picking", headers=owner)
    assert done.status_code == 409
    assert done.json()["error"]["code"] == "PICK_DETAILS_REQUIRED"


def test_picking_tab_only_own_for_staff(client, picker, db):
    me = db.scalar(select(User).where(User.username == "thupham"))
    data = client.get("/api/v1/order-work-queue", params={"tab": "PICKING"}, headers=picker).json()["data"]
    total = sum(s["order_count"] for s in data)
    assert total == db.query(Order).filter(Order.status == "PICKING", Order.claimed_by == me.id).count()


def test_picker_statistics_owner_only(client, owner, picker):
    assert client.get("/api/v1/picker-statistics", headers=picker).status_code == 403
    r = client.get("/api/v1/picker-statistics", headers=owner)
    assert r.status_code == 200
    d = r.json()["data"]
    # Tổng = Chưa soạn + Đang soạn + Đã soạn + Nợ + Hủy (không bỏ sót đơn chưa claim).
    assert d["total"] == d["new"] + d["picked"] + d["picking"] + d["debt"] + d["cancelled"]


def test_dashboard(client, owner):
    today = datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).date()
    d = client.get("/api/v1/dashboard/overview", headers=owner, params={
        "from_date": (today - timedelta(days=60)).isoformat(),
        "to_date": today.isoformat(),
    }).json()["data"]
    assert d["new_orders"] > 0
    assert len(d["recent_activity"]) == 5
    assert d["period"]["to_date"] == today.isoformat()
    assert d["orders"]["total_orders"] > 0
    assert d["cashflow"]["available"] is True


def test_dashboard_period_counts_and_financial_metrics(client, owner, db):
    business_tz = ZoneInfo("Asia/Ho_Chi_Minh")
    today = datetime.now(business_tz).date()
    old_day = today - timedelta(days=40)
    db.query(Order).update({Order.created_date: old_day}, synchronize_session=False)

    customer = db.scalar(select(Customer).order_by(Customer.id))
    warehouse = db.scalar(select(Warehouse).order_by(Warehouse.code))
    statuses = [
        ("NEW", "DRAFT"),
        ("PICKING", "DRAFT"),
        ("PICKED", "DRAFT"),
        ("SHIPPING", "SENT"),
        ("DEBT_ORDER", "DRAFT"),
        ("CANCELLED", "DRAFT"),
        ("DELETED", "DELETED"),
    ]
    created_orders = []
    for index, (status, billing_status) in enumerate(statuses):
        order = Order(
            order_no=f"HD-DASH-{index}",
            customer_id=customer.id,
            warehouse_id=warehouse.id,
            created_date=today,
            status=status,
            billing_status=billing_status,
            created_at=datetime.combine(today, datetime_time(10, index), tzinfo=business_tz),
        )
        db.add(order)
        created_orders.append(order)
    db.flush()

    invoice = Invoice(
        invoice_no="HD-DASH-SENT",
        customer_id=customer.id,
        status="SENT",
        issued_at=datetime.combine(today, datetime_time(11, 0), tzinfo=business_tz),
        subtotal_amount=1_000,
        surcharge_amount=200,
        snapshot={},
        idempotency_key="dashboard-sent",
    )
    void_invoice = Invoice(
        invoice_no="HD-DASH-VOID",
        customer_id=customer.id,
        status="VOID",
        issued_at=datetime.combine(today, datetime_time(11, 30), tzinfo=business_tz),
        subtotal_amount=99_000,
        snapshot={},
        idempotency_key="dashboard-void",
    )
    db.add_all([invoice, void_invoice])
    db.flush()
    db.add(InvoiceOrder(invoice_id=invoice.id, order_id=created_orders[3].id, amount=1_200))
    db.add_all([
        Payment(
            payment_no="PAY-DASH-RECEIPT",
            party_type="CUSTOMER",
            customer_id=customer.id,
            amount=500,
            method="CASH",
            direction="RECEIPT",
            status="POSTED",
            paid_at=datetime.combine(today, datetime_time(12, 0), tzinfo=business_tz),
            idempotency_key="dashboard-receipt",
        ),
        Payment(
            payment_no="PAY-DASH-VOID",
            party_type="CUSTOMER",
            customer_id=customer.id,
            amount=80_000,
            method="CASH",
            direction="RECEIPT",
            status="VOID",
            paid_at=datetime.combine(today, datetime_time(12, 30), tzinfo=business_tz),
            idempotency_key="dashboard-void-payment",
        ),
    ])
    partner = db.scalar(select(Partner).order_by(Partner.id))
    if partner is None:
        partner = Partner(partner_code="DASHBOARD-TEST", name="Đối tác kiểm thử", partner_type="SUPPLIER")
        db.add(partner)
        db.flush()
    db.add_all([
        DebtLedgerEntry(party_type="CUSTOMER", party_id=customer.id, entry_type="TEST", amount_delta=12_345),
        DebtLedgerEntry(party_type="PARTNER", party_id=partner.id, entry_type="TEST", amount_delta=23_456),
    ])
    db.commit()

    response = client.get(
        "/api/v1/dashboard/overview",
        headers=owner,
        params={"from_date": today.isoformat(), "to_date": today.isoformat()},
    )
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["orders"]["total_orders"] == 7
    assert data["orders"]["new_orders"] == 1
    assert data["orders"]["picking_orders"] == 1
    assert data["orders"]["invoice_pending"] == 1
    assert data["orders"]["invoice_sent"] == 1
    assert data["orders"]["debt_orders"] == 1
    assert data["orders"]["cancelled_orders"] == 2
    assert data["cashflow"]["revenue_amount"] == 1_200
    assert data["cashflow"]["collected_amount"] == 500
    assert data["cashflow"]["receivables_amount"] >= 12_345
    assert data["cashflow"]["payables_amount"] >= 23_456
    assert data["cashflow"]["total_debt_amount"] == (
        data["cashflow"]["receivables_amount"] + data["cashflow"]["payables_amount"]
    )
    assert data["cashflow"]["remaining_amount"] == (
        data["cashflow"]["collected_amount"] - data["cashflow"]["payables_amount"]
    )

    outside = client.get(
        "/api/v1/dashboard/overview",
        headers=owner,
        params={"from_date": old_day.isoformat(), "to_date": old_day.isoformat()},
    ).json()["data"]
    assert outside["orders"]["total_orders"] > 0
    assert outside["cashflow"]["revenue_amount"] == 0
    assert outside["cashflow"]["collected_amount"] == 0


def test_dashboard_invalid_range_and_finance_permissions(client, owner, picker):
    invalid = client.get(
        "/api/v1/dashboard/overview",
        headers=owner,
        params={"from_date": "2026-10-13", "to_date": "2026-10-12"},
    )
    assert invalid.status_code == 422
    data = client.get("/api/v1/dashboard/overview", headers=picker).json()["data"]
    assert data["orders"]["total_orders"] >= 0
    assert data["cashflow"]["available"] is False
    assert data["cashflow"]["revenue_amount"] is None


def test_dashboard_empty_period_returns_zero_counts_and_cashflow(client, owner):
    response = client.get(
        "/api/v1/dashboard/overview",
        headers=owner,
        params={"from_date": "2000-01-01", "to_date": "2000-01-02"},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["orders"] == {
        "total_orders": 0,
        "new_orders": 0,
        "picking_orders": 0,
        "picked_orders": 0,
        "invoice_pending": 0,
        "invoice_sent": 0,
        "debt_orders": 0,
        "cancelled_orders": 0,
    }
    assert data["cashflow"]["revenue_amount"] == 0
    assert data["cashflow"]["collected_amount"] == 0


def test_upload_rejects_non_image(client, owner):
    r = client.post("/api/v1/media/upload", files={"file": ("x.jpg", b"hello", "image/jpeg")}, headers=owner)
    assert r.status_code == 415
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 20
    r = client.post("/api/v1/media/upload", files={"file": ("x.png", png, "image/png")}, headers=owner)
    assert r.status_code == 201


def test_upload_then_create_order_keeps_image(client, owner, db):
    png = b"\x89PNG\r\n\x1a\n" + b"safe-test-image" * 2
    uploaded = client.post(
        "/api/v1/media/upload", files={"file": ("zalo-order.png", png, "image/png")}, headers=owner
    )
    assert uploaded.status_code == 201, uploaded.text
    media = uploaded.json()["data"]

    body = {
        "customer_id": _customer_id(db),
        "warehouse_mode": "TAN_XUAN",
        "created_date": date.today().isoformat(),
        "is_urgent": False,
        "customer_note": "Đơn có ảnh",
        "media_ids": [media["id"]],
    }
    created = client.post(
        "/api/v1/orders", json=body, headers=owner | {"Idempotency-Key": str(uuid.uuid4())}
    )
    assert created.status_code == 201, created.text
    order = created.json()["data"][0]
    assert order["images"] == [{
        "id": media["id"],
        "original_name": "zalo-order.png",
        "content_type": "image/png",
        "url": f"/api/v1/media/{media['id']}/view",
    }]

    detail = client.get(f"/api/v1/orders/{order['id']}", headers=owner)
    assert detail.status_code == 200
    assert detail.json()["data"]["order"]["images"] == order["images"]


# ---- Order deletion ----

def _tx_warehouse_id(db):
    return str(db.scalar(select(Warehouse.id).where(Warehouse.code == "TAN_XUAN")))


def _demo_variant_id(db, internal_code="DEMO-NB-DEN-M"):
    return str(db.scalar(select(ProductVariant.id).where(ProductVariant.internal_code == internal_code)))


def _create_new_order(client, owner, db, warehouse_mode="TAN_XUAN"):
    body = {
        "customer_id": _customer_id(db),
        "warehouse_mode": warehouse_mode,
        "created_date": date.today().isoformat(),
        "is_urgent": False,
    }
    r = client.post("/api/v1/orders", json=body, headers=owner | {"Idempotency-Key": str(uuid.uuid4())})
    assert r.status_code == 201, r.text
    return r.json()["data"][0]


def _pick_order(client, owner, db, order_id):
    """Claim rồi lưu soạn để tạo reservation, trả về order_id ở trạng thái PICKED."""
    claimed = client.post(f"/api/v1/orders/{order_id}/claim", headers=owner)
    assert claimed.status_code == 200, claimed.text
    detail = client.get(f"/api/v1/orders/{order_id}", headers=owner).json()["data"]
    variant_id = _demo_variant_id(db)
    warehouse_id = _tx_warehouse_id(db)
    saved = client.put(f"/api/v1/orders/{order_id}/pick", headers=owner, json={
        "order_id": order_id,
        "version": detail["order"]["version"],
        "staff_note": None,
        "items": [{
            "product_variant_id": variant_id,
            "product_name": "Quần thể thao demo Đen M",
            "warehouse_id": warehouse_id,
            "quantity": 2,
            "unit_price_amount": 100000,
            "sale_type": "MaBanHang",
        }],
    })
    assert saved.status_code == 200, saved.text
    assert saved.json()["data"]["order"]["status"] == "PICKED"
    return variant_id, warehouse_id


def test_delete_new_order_succeeds(client, owner, db):
    order = _create_new_order(client, owner, db)
    order_id = uuid.UUID(order["id"])
    r = client.delete(f"/api/v1/orders/{order['id']}", headers=owner)
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["ok"] is True
    assert data["order_id"] == order["id"]
    assert data["released_reservations"] == 0
    assert data["deleted_media_links"] == 0
    assert db.get(Order, order_id) is None
    assert db.scalar(select(OrderStatusEvent.id).where(OrderStatusEvent.order_id == order_id)) is None
    assert db.scalar(select(AuditLog.id).where(AuditLog.entity_id == order_id, AuditLog.action == "DELETE_ORDER")) is not None


def test_delete_picking_order_releases_claim(client, owner, db):
    order = _create_new_order(client, owner, db)
    order_id = uuid.UUID(order["id"])
    claimed = client.post(f"/api/v1/orders/{order['id']}/claim", headers=owner)
    assert claimed.json()["data"]["status"] == "PICKING"
    r = client.delete(f"/api/v1/orders/{order['id']}", headers=owner)
    assert r.status_code == 200, r.text
    assert db.get(Order, order_id) is None
    assert db.scalar(select(OrderStatusEvent.id).where(OrderStatusEvent.order_id == order_id)) is None


def test_delete_picked_order_releases_reservation(client, owner, db):
    order = _create_new_order(client, owner, db)
    order_id = uuid.UUID(order["id"])
    variant_id, warehouse_id = _pick_order(client, owner, db, order["id"])

    balance = db.scalar(select(InventoryBalance).where(
        InventoryBalance.variant_id == uuid.UUID(variant_id),
        InventoryBalance.warehouse_id == uuid.UUID(warehouse_id),
    ))
    assert balance.reserved == 2

    r = client.delete(f"/api/v1/orders/{order['id']}", headers=owner)
    assert r.status_code == 200, r.text
    assert r.json()["data"]["released_reservations"] == 1
    db.expire_all()
    assert db.scalar(select(InventoryBalance.reserved).where(
        InventoryBalance.variant_id == uuid.UUID(variant_id),
        InventoryBalance.warehouse_id == uuid.UUID(warehouse_id),
    )) == 0
    assert db.get(Order, order_id) is None
    assert db.scalar(select(InventoryReservation.id).where(InventoryReservation.order_id == order_id)) is None


def test_delete_order_with_invoice_conflicts(client, owner, db):
    order = _create_new_order(client, owner, db)
    order_id = uuid.UUID(order["id"])
    customer_id = uuid.UUID(_customer_id(db))
    invoice = Invoice(invoice_no="HD-DEL-TEST", customer_id=customer_id, status="SENT",
                      subtotal_amount=1000, snapshot={}, idempotency_key="test-del-inv")
    db.add(invoice); db.flush()
    db.add(InvoiceOrder(invoice_id=invoice.id, order_id=order_id, amount=1000))
    db.add(DebtLedgerEntry(party_type="CUSTOMER", party_id=customer_id, entry_type="INVOICE",
                           amount_delta=1000, reference_type="INVOICE", reference_id=invoice.id))
    db.commit()

    r = client.delete(f"/api/v1/orders/{order['id']}", headers=owner)
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "ORDER_HAS_INVOICE"
    assert db.get(Order, order_id) is not None


def test_delete_order_forbidden_for_non_owner(client, owner, picker, db):
    order = _create_new_order(client, owner, db)
    order_id = uuid.UUID(order["id"])
    r = client.delete(f"/api/v1/orders/{order['id']}", headers=picker)
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "FORBIDDEN"
    assert db.get(Order, order_id) is not None


def test_delete_order_twice_returns_not_found(client, owner, db):
    order = _create_new_order(client, owner, db)
    assert client.delete(f"/api/v1/orders/{order['id']}", headers=owner).status_code == 200
    r = client.delete(f"/api/v1/orders/{order['id']}", headers=owner)
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "ORDER_NOT_FOUND"


def test_delete_order_rolls_back_when_balance_missing(client, owner, db):
    order = _create_new_order(client, owner, db)
    order_id = uuid.UUID(order["id"])
    variant_id, warehouse_id = _pick_order(client, owner, db, order["id"])
    # Phá vỡ tồn kho để buộc cleanup fail, kiểm tra rollback giữ nguyên đơn.
    db.execute(delete(InventoryBalance).where(
        InventoryBalance.variant_id == uuid.UUID(variant_id),
        InventoryBalance.warehouse_id == uuid.UUID(warehouse_id),
    ))
    db.commit()

    r = client.delete(f"/api/v1/orders/{order['id']}", headers=owner)
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "RESERVATION_BALANCE_MISSING"
    assert db.get(Order, order_id) is not None
    assert db.scalar(select(InventoryReservation.id).where(InventoryReservation.order_id == order_id)) is not None


def test_delete_order_cleans_orphan_group_but_keeps_shared(client, owner, db):
    body = {
        "customer_id": _customer_id(db),
        "warehouse_mode": "BOTH",
        "created_date": date.today().isoformat(),
    }
    r = client.post("/api/v1/orders", json=body, headers=owner | {"Idempotency-Key": str(uuid.uuid4())})
    assert r.status_code == 201, r.text
    orders = r.json()["data"]
    assert len(orders) == 2
    group_id = uuid.UUID(orders[0]["order_group_id"])
    assert db.get(OrderGroup, group_id) is not None

    assert client.delete(f"/api/v1/orders/{orders[0]['id']}", headers=owner).status_code == 200
    assert db.get(OrderGroup, group_id) is not None

    assert client.delete(f"/api/v1/orders/{orders[1]['id']}", headers=owner).status_code == 200
    assert db.get(OrderGroup, group_id) is None


def test_delete_order_removes_links_but_keeps_shared_media(client, owner, db):
    media = MediaObject(storage_provider="local", storage="LOCAL", object_key="test-key",
                        content_type="image/png", size_bytes=10, sha256="abc", checksum="abc", status="READY")
    db.add(media); db.commit()
    order1 = _create_new_order(client, owner, db)
    order2 = _create_new_order(client, owner, db)
    db.add(OrderMedia(order_id=uuid.UUID(order1["id"]), media_id=media.id))
    db.add(OrderMedia(order_id=uuid.UUID(order2["id"]), media_id=media.id))
    db.commit()

    r = client.delete(f"/api/v1/orders/{order1['id']}", headers=owner)
    assert r.status_code == 200, r.text
    assert r.json()["data"]["deleted_media_links"] == 1
    assert db.get(MediaObject, media.id) is not None
    assert db.scalar(select(OrderMedia).where(
        OrderMedia.order_id == uuid.UUID(order2["id"]), OrderMedia.media_id == media.id
    )) is not None
