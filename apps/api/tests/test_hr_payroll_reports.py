import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import func, select

from app.models import (
    AttendanceRecord, AuditLog, Customer, DebtLedgerEntry, Employee, Invoice, Order,
    Partner, Payment, PayrollLine, PayrollRun, User, Warehouse,
)


def _employee(client, owner, rate=240_000):
    response = client.post("/api/v1/employees", headers=owner, json={
        "employee_code": f"NV-{uuid.uuid4().hex[:8]}", "full_name": "Nhân viên kiểm thử", "phone": None,
        "position": "KHO", "daily_rate_amount": rate, "start_date": "2026-01-01", "notes": None, "user_id": None,
    })
    assert response.status_code == 201, response.text
    return response.json()["data"]


def test_attendance_batch_upserts_unique_day_shift_instead_of_duplicate(client, owner, db):
    employee = _employee(client, owner)
    payload = {"records": [{"work_date": "2026-10-02", "employee_id": employee["id"], "shift": "DAY",
                            "work_units": 1, "overtime_hours": 1, "notes": "Lần một"}]}
    assert client.put("/api/v1/attendance", headers=owner, json=payload).status_code == 200
    payload["records"][0].update({"work_units": 0.5, "overtime_hours": 2, "notes": "Sửa"})
    response = client.put("/api/v1/attendance", headers=owner, json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["data"][0]["work_units"] == 0.5
    assert db.scalar(select(func.count(AttendanceRecord.id))) == 1


def test_payroll_calculates_from_attendance_rate_and_approved_advances(client, owner, db):
    employee = _employee(client, owner, rate=240_000)
    attendance = {"records": [
        {"work_date": "2026-10-02", "employee_id": employee["id"], "shift": "DAY", "work_units": 1, "overtime_hours": 2},
        {"work_date": "2026-10-03", "employee_id": employee["id"], "shift": "DAY", "work_units": 0.5, "overtime_hours": 0},
    ]}
    assert client.put("/api/v1/attendance", headers=owner, json=attendance).status_code == 200
    advance = client.post("/api/v1/salary-advances", headers={**owner, "Idempotency-Key": uuid.uuid4().hex}, json={
        "advance_date": "2026-10-04", "employee_id": employee["id"], "amount": 50_000, "note": "Ứng"})
    assert advance.status_code == 201, advance.text
    payroll = client.post("/api/v1/payroll-runs", headers={**owner, "Idempotency-Key": uuid.uuid4().hex}, json={"period_month": "2026-10-01"})
    assert payroll.status_code == 201, payroll.text
    line = payroll.json()["data"]["lines"][0]
    assert line["work_units"] == 1.5
    assert line["overtime_hours"] == 2
    assert line["base_amount"] == 360_000
    assert line["overtime_amount"] == 60_000
    assert line["advance_amount"] == 50_000
    assert line["net_amount"] == 370_000


def test_approved_payroll_snapshot_stays_immutable_and_locks_source_month(client, owner, db):
    employee = _employee(client, owner)
    client.put("/api/v1/attendance", headers=owner, json={"records": [{
        "work_date": "2026-10-02", "employee_id": employee["id"], "shift": "DAY", "work_units": 1, "overtime_hours": 0}]})
    run = client.post("/api/v1/payroll-runs", headers={**owner, "Idempotency-Key": uuid.uuid4().hex}, json={"period_month": "2026-10-01"}).json()["data"]
    approved = client.post(f"/api/v1/payroll-runs/{run['id']}/approve", headers=owner, json={"version": run["version"]})
    assert approved.status_code == 200, approved.text
    before = approved.json()["data"]["lines"][0]
    locked = client.put("/api/v1/attendance", headers=owner, json={"records": [{
        "work_date": "2026-10-02", "employee_id": employee["id"], "shift": "DAY", "work_units": 2, "overtime_hours": 0}]})
    assert locked.status_code == 409
    assert locked.json()["error"]["code"] == "PAYROLL_LOCKED"
    client.patch(f"/api/v1/employees/{employee['id']}", headers=owner, json={"daily_rate_amount": 999_000, "full_name": "Tên mới"})
    current = client.get(f"/api/v1/payroll-runs/{run['id']}", headers=owner).json()["data"]["lines"][0]
    assert current["daily_rate_amount"] == before["daily_rate_amount"]
    assert current["employee_name"] == before["employee_name"]
    assert current["snapshot"] == before["snapshot"]


def test_payroll_retry_idempotent_and_duplicate_month_rejected(client, owner, db):
    _employee(client, owner); key = uuid.uuid4().hex; body = {"period_month": "2026-10-01"}
    first = client.post("/api/v1/payroll-runs", headers={**owner, "Idempotency-Key": key}, json=body)
    retry = client.post("/api/v1/payroll-runs", headers={**owner, "Idempotency-Key": key}, json=body)
    duplicate = client.post("/api/v1/payroll-runs", headers={**owner, "Idempotency-Key": uuid.uuid4().hex}, json=body)
    assert first.status_code == retry.status_code == 201
    assert first.json()["data"]["id"] == retry.json()["data"]["id"]
    assert duplicate.status_code == 409
    assert db.scalar(select(func.count(PayrollRun.id))) == 1


def test_reports_read_ledger_and_data_warning_invariants(client, owner, db):
    assert client.get("/api/v1/reports/cash-flow", headers=owner).status_code == 200
    assert client.get("/api/v1/reports/revenue", headers=owner).status_code == 200
    assert client.get("/api/v1/reports/customers", headers=owner).status_code == 200
    warnings = client.get("/api/v1/reports/data-warnings", headers=owner)
    assert warnings.status_code == 200
    assert warnings.json()["data"]["critical_count"] == 0
    assert client.get("/api/v1/audit-logs", headers=owner).status_code == 200


def test_reports_overview_filters_period_and_aggregates_real_data(client, owner, db):
    business_tz = ZoneInfo("Asia/Ho_Chi_Minh")
    today = datetime.now(business_tz).date()
    customer = db.scalar(select(Customer).order_by(Customer.id))
    warehouse = db.scalar(select(Warehouse).order_by(Warehouse.code))
    order = Order(
        order_no=f"RP-{uuid.uuid4().hex[:10]}",
        customer_id=customer.id,
        warehouse_id=warehouse.id,
        created_date=today,
        status="PICKED",
        billing_status="DRAFT",
    )
    invoice = Invoice(
        invoice_no=f"HD-RP-{uuid.uuid4().hex[:8]}",
        customer_id=customer.id,
        status="SENT",
        issued_at=datetime.now(business_tz),
        subtotal_amount=1_000,
        surcharge_amount=200,
        snapshot={},
        idempotency_key=uuid.uuid4().hex,
    )
    partner = db.scalar(select(Partner).order_by(Partner.id))
    if partner is None:
        partner = Partner(partner_code=f"RP-{uuid.uuid4().hex[:8]}", name="Đối tác kiểm thử", partner_type="SUPPLIER")
        db.add(partner)
        db.flush()
    db.add_all([order, invoice])
    db.add_all([
        Payment(
            payment_no=f"PAY-RP-{uuid.uuid4().hex[:8]}",
            party_type="CUSTOMER",
            customer_id=customer.id,
            amount=500,
            method="CASH",
            direction="RECEIPT",
            status="POSTED",
            paid_at=datetime.now(business_tz),
            idempotency_key=uuid.uuid4().hex,
        ),
        Payment(
            payment_no=f"PAY-RP-{uuid.uuid4().hex[:8]}",
            party_type="PARTNER",
            supplier_id=partner.id,
            amount=200,
            method="CASH",
            direction="PAYMENT",
            status="POSTED",
            paid_at=datetime.now(business_tz),
            idempotency_key=uuid.uuid4().hex,
        ),
    ])
    db.add(DebtLedgerEntry(
        party_type="CUSTOMER",
        party_id=customer.id,
        entry_type="TEST",
        amount_delta=3_000,
    ))
    db.commit()

    response = client.get("/api/v1/reports/overview", headers=owner, params={
        "from_date": today.isoformat(),
        "to_date": today.isoformat(),
    })
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["period"] == {"from_date": today.isoformat(), "to_date": today.isoformat()}
    assert data["orders"]["total_orders"] >= 1
    assert data["orders"]["picked_orders"] >= 1
    assert data["orders"]["invoice_pending"] >= 1
    assert data["cashflow"]["invoice_revenue"] >= 1_200
    assert data["cashflow"]["money_in"] >= 500
    assert data["cashflow"]["money_out"] >= 200
    assert data["cashflow"]["net_cashflow"] == data["cashflow"]["money_in"] - data["cashflow"]["money_out"]
    assert data["cashflow"]["total_debt"] >= 3_000

    previous = today - timedelta(days=1)
    old_period = client.get("/api/v1/reports/overview", headers=owner, params={
        "from_date": previous.isoformat(),
        "to_date": previous.isoformat(),
    }).json()["data"]
    assert old_period["cashflow"]["invoice_revenue"] == 0
    assert old_period["cashflow"]["money_in"] == 0
    invalid = client.get("/api/v1/reports/overview", headers=owner, params={
        "from_date": today.isoformat(),
        "to_date": previous.isoformat(),
    })
    assert invalid.status_code == 422


def test_report_action_items_lists_unsent_invoice_orders_in_period(client, owner, db):
    business_today = datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).date()
    customer = db.scalar(select(Customer).order_by(Customer.id))
    warehouse = db.scalar(select(Warehouse).order_by(Warehouse.code))
    order = Order(
        order_no=f"RP-ACTION-{uuid.uuid4().hex[:8]}",
        customer_id=customer.id,
        warehouse_id=warehouse.id,
        created_date=business_today,
        status="PICKED",
        billing_status="DRAFT",
    )
    db.add(order)
    db.commit()

    response = client.get("/api/v1/reports/action-items", headers=owner, params={
        "from_date": business_today.isoformat(),
        "to_date": business_today.isoformat(),
    })
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    item = next(row for row in data["items"] if row["entity_id"] == str(order.id))
    assert item["type"] == "INVOICE_NOT_SENT"
    assert item["reference"] == order.order_no
    assert item["customer_name"] == customer.name

    response = client.get("/api/v1/reports/action-items", headers=owner, params={
        "from_date": "2000-01-01",
        "to_date": "2000-01-02",
    })
    assert response.status_code == 200
    assert response.json()["data"]["items"] == []


def test_audit_log_period_sort_and_detail(client, owner, db):
    now = datetime.now(timezone.utc)
    actor = db.scalar(select(User).where(User.username == "owner"))
    older = AuditLog(
        entity_type="REPORT_TEST",
        entity_id=uuid.uuid4(),
        action="OLDER",
        module="TEST",
        occurred_at=now - timedelta(minutes=2),
        before_data={"value": 1},
        after_data={"value": 2},
    )
    newest = AuditLog(
        entity_type="ORDER",
        entity_id=uuid.uuid4(),
        action="CREATE",
        module="SALES",
        actor_user_id=actor.id,
        occurred_at=now - timedelta(minutes=1),
        before_data={"value": 2},
        after_data={"order_no": "HD-AUDIT-VI-001", "customer_name": "Khách kiểm thử", "amount": 125_000},
    )
    debt_adjustment = AuditLog(
        entity_type="CUSTOMER",
        entity_id=uuid.uuid4(),
        action="ADJUST",
        module="DEBT",
        actor_user_id=actor.id,
        occurred_at=now,
        before_data={"balance": 400},
        after_data={"balance": 500},
    )
    db.add_all([older, newest, debt_adjustment])
    db.commit()

    today = now.astimezone(ZoneInfo("Asia/Ho_Chi_Minh")).date().isoformat()
    response = client.get("/api/v1/audit-logs", headers=owner, params={
        "from_date": today,
        "to_date": today,
    })
    assert response.status_code == 200, response.text
    rows = response.json()["data"]
    test_rows = [row for row in rows if row["entity_id"] in (str(older.entity_id), str(newest.entity_id))]
    assert [row["action"] for row in test_rows[:2]] == ["CREATE", "OLDER"]
    translated = test_rows[0]
    assert translated["action_label"] == "Tạo đơn hàng"
    assert translated["module_label"] == "Đơn hàng"
    assert translated["entity_label"] == "Đơn hàng"
    assert translated["entity_code"] == "HD-AUDIT-VI-001"
    assert "đã tạo đơn hàng" in translated["description_vi"]
    debt_response = client.get("/api/v1/audit-logs", headers=owner, params={
        "from_date": today,
        "to_date": today,
        "module": "DEBT",
        "action": "ADJUST",
    })
    assert debt_response.status_code == 200, debt_response.text
    debt_row = debt_response.json()["data"][0]
    assert debt_row["action_label"] == "Điều chỉnh công nợ khách"
    assert debt_row["module_label"] == "Công nợ"
    assert debt_row["entity_label"] == "Khách hàng"
    assert debt_row["description_vi"] == f"{actor.display_name} đã điều chỉnh công nợ khách: +100đ."

    filtered = client.get("/api/v1/audit-logs", headers=owner, params={
        "from_date": today,
        "to_date": today,
        "module": "ORDER",
        "action": "CREATE",
        "q": "HD-AUDIT-VI-001",
    })
    assert filtered.status_code == 200, filtered.text
    assert [row["id"] for row in filtered.json()["data"]] == [str(newest.id)]

    detail = client.get(f"/api/v1/audit-logs/{newest.id}", headers=owner)
    assert detail.status_code == 200, detail.text
    assert detail.json()["data"]["before"] == {"value": 2}
    assert detail.json()["data"]["after"]["order_no"] == "HD-AUDIT-VI-001"
    assert detail.json()["data"]["action_label"] == "Tạo đơn hàng"
    assert client.get(f"/api/v1/audit-logs/{uuid.uuid4()}", headers=owner).status_code == 404
