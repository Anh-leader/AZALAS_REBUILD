import uuid

from sqlalchemy import func, select

from app.models import AttendanceRecord, Employee, EmployeeRateHistory, SalaryAdvance


def _employee(client, owner, rate=240_000):
    response = client.post("/api/v1/employees", headers=owner, json={
        "employee_code": f"NV-{uuid.uuid4().hex[:8]}", "full_name": "Nhân viên kiểm thử", "phone": None,
        "position": "KHO", "daily_rate_amount": rate, "start_date": "2026-01-01", "notes": None, "user_id": None,
    })
    assert response.status_code == 201, response.text
    return response.json()["data"]


def _advance(client, owner, employee_id, amount=50_000, note="Ứng"):
    r = client.post("/api/v1/salary-advances", headers={**owner, "Idempotency-Key": uuid.uuid4().hex}, json={
        "advance_date": "2026-10-04", "employee_id": employee_id, "amount": amount, "note": note})
    assert r.status_code == 201, r.text
    return r.json()["data"]


# 1. Tạo nhân viên
def test_create_employee(client, owner, db):
    employee = _employee(client, owner)
    assert db.get(Employee, uuid.UUID(employee["id"])) is not None


# 2. Sửa nhân viên
def test_update_employee(client, owner, db):
    employee = _employee(client, owner)
    r = client.patch(f"/api/v1/employees/{employee['id']}", headers=owner, json={"full_name": "Tên đã sửa", "phone": "0900000000"})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["full_name"] == "Tên đã sửa"


# 3. Cho nghỉ không xóa vật lý
def test_inactivate_employee_keeps_record(client, owner, db):
    employee = _employee(client, owner)
    r = client.patch(f"/api/v1/employees/{employee['id']}", headers=owner, json={"status": "INACTIVE"})
    assert r.status_code == 200
    assert db.get(Employee, uuid.UUID(employee["id"])) is not None
    assert db.get(Employee, uuid.UUID(employee["id"])).status == "INACTIVE"


# 4. Nhập công tháng
def test_save_monthly_attendance(client, owner, db):
    employee = _employee(client, owner)
    r = client.put("/api/v1/attendance", headers=owner, json={"records": [{
        "work_date": "2026-10-01", "employee_id": employee["id"], "shift": "MONTH",
        "work_units": 23.3, "overtime_hours": 10, "bonus_amount": 200_000, "notes": "Cuối tháng"}]})
    assert r.status_code == 200, r.text
    data = r.json()["data"][0]
    assert data["work_units"] == 23.3
    assert data["bonus_amount"] == 200_000


# 5. Nhập công lần 2 cùng nhân viên/tháng -> update
def test_attendance_upsert_same_month(client, owner, db):
    employee = _employee(client, owner)
    body = {"records": [{"work_date": "2026-10-01", "employee_id": employee["id"], "shift": "MONTH",
                         "work_units": 23.3, "overtime_hours": 10, "bonus_amount": 0}]}
    assert client.put("/api/v1/attendance", headers=owner, json=body).status_code == 200
    body["records"][0].update({"work_units": 24.0, "bonus_amount": 100_000})
    r = client.put("/api/v1/attendance", headers=owner, json=body)
    assert r.status_code == 200
    assert r.json()["data"][0]["work_units"] == 24.0
    assert db.scalar(select(func.count(AttendanceRecord.id))) == 1


# 6. Parse "23,3" -> 23.3 (service decimal parse)
def test_work_units_decimal_comma(client, owner, db):
    from app.services.production import decimal
    from decimal import Decimal
    assert decimal("23,3") == Decimal("23.3")
    assert decimal("23.3") == Decimal("23.3")


# 7. Nhập ứng thành công
def test_create_advance(client, owner, db):
    employee = _employee(client, owner)
    advance = _advance(client, owner, employee["id"])
    assert advance["amount"] == 50_000


# 8. Tiền ứng <= 0 reject
def test_advance_non_positive_rejected(client, owner, db):
    employee = _employee(client, owner)
    r = client.post("/api/v1/salary-advances", headers={**owner, "Idempotency-Key": uuid.uuid4().hex}, json={
        "advance_date": "2026-10-04", "employee_id": employee["id"], "amount": 0, "note": "x"})
    assert r.status_code == 422


# 9. Đổi giá công tạo lịch sử
def test_rate_history_recorded(client, owner, db):
    employee = _employee(client, owner, rate=240_000)
    r = client.post(f"/api/v1/employees/{employee['id']}/rate-history", headers=owner, json={
        "effective_date": "2026-10-10", "new_daily_rate_amount": 300_000, "reason": "Làm tốt"})
    assert r.status_code == 201, r.text
    assert r.json()["data"]["old_daily_rate_amount"] == 240_000
    assert r.json()["data"]["new_daily_rate_amount"] == 300_000
    # employee rate cập nhật
    current = client.get("/api/v1/employees", headers=owner).json()["data"]
    row = [e for e in current if e["id"] == employee["id"]][0]
    assert row["daily_rate_amount"] == 300_000
    history = client.get(f"/api/v1/employees/{employee['id']}/rate-history", headers=owner).json()["data"]
    assert len(history) == 1


# 10. Báo cáo cá nhân
def test_personal_report(client, owner, db):
    employee = _employee(client, owner, rate=100_000)
    client.put("/api/v1/attendance", headers=owner, json={"records": [{
        "work_date": "2026-10-01", "employee_id": employee["id"], "shift": "MONTH",
        "work_units": 20, "overtime_hours": 0, "bonus_amount": 100_000}]})
    _advance(client, owner, employee["id"], 50_000)
    r = client.get("/api/v1/reports/personal", headers=owner, params={
        "employee_id": employee["id"], "from_month": "2026-10-01", "to_month": "2026-10-01"})
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["total_work_units"] == 20
    assert data["total_bonus_amount"] == 100_000
    assert data["total_advance_amount"] == 50_000
    # lương = 20 * 100000 + 100000 - 50000 = 2050000
    assert data["net_amount"] == 2_050_000


# 11. Báo cáo tổng quát
def test_summary_report(client, owner, db):
    e1 = _employee(client, owner, rate=100_000)
    e2 = _employee(client, owner, rate=100_000)
    client.put("/api/v1/attendance", headers=owner, json={"records": [
        {"work_date": "2026-10-01", "employee_id": e1["id"], "shift": "MONTH", "work_units": 20, "overtime_hours": 0, "bonus_amount": 0},
        {"work_date": "2026-10-01", "employee_id": e2["id"], "shift": "MONTH", "work_units": 10, "overtime_hours": 0, "bonus_amount": 0},
    ]})
    r = client.get("/api/v1/reports/summary", headers=owner, params={
        "from_month": "2026-10-01", "to_month": "2026-10-01"})
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["employee_count"] == 2
    assert data["total_work_units"] == 30
    assert data["total_net_amount"] == 3_000_000


# 12. Role không đủ quyền 403
def test_staff_forbidden(client, owner, db):
    username = f"member_{uuid.uuid4().hex[:8]}"
    client.post("/api/v1/users", headers=owner, json={
        "username": username, "password": "safe-pass-123", "display_name": "Member", "phone": None, "role_codes": ["MEMBER"]})
    login = client.post("/api/v1/auth/login", json={"username": username, "password": "safe-pass-123"})
    auth = {"Authorization": f"Bearer {login.json()['data']['access_token']}"}
    employee = _employee(client, owner)
    assert client.patch(f"/api/v1/employees/{employee['id']}", headers=auth, json={"full_name": "X"}).status_code == 403
    assert client.post("/api/v1/salary-advances", headers={**auth, "Idempotency-Key": uuid.uuid4().hex},
                       json={"advance_date": "2026-10-04", "employee_id": employee["id"], "amount": 1000}).status_code == 403


# 13. Sửa công ghi audit
def test_attendance_audit(client, owner, db):
    from app.models import AuditLog
    employee = _employee(client, owner)
    client.put("/api/v1/attendance", headers=owner, json={"records": [{
        "work_date": "2026-10-01", "employee_id": employee["id"], "shift": "MONTH", "work_units": 20, "overtime_hours": 0}]})
    db.expire_all()
    count = db.scalar(select(func.count(AuditLog.id)).where(AuditLog.action == "ATTENDANCE_UPSERT"))
    assert count >= 1


# 14. Sửa ứng ghi audit
def test_advance_audit(client, owner, db):
    from app.models import AuditLog
    employee = _employee(client, owner)
    adv = _advance(client, owner, employee["id"])
    client.patch(f"/api/v1/salary-advances/{adv['id']}", headers=owner, json={"note": "Sửa ghi chú"})
    db.expire_all()
    count = db.scalar(select(func.count(AuditLog.id)).where(AuditLog.action == "SALARY_ADVANCE_UPDATE"))
    assert count >= 1


# 15. Tiền không dùng float
def test_money_is_integer(client, owner, db):
    employee = _employee(client, owner, rate=100_000)
    client.put("/api/v1/attendance", headers=owner, json={"records": [{
        "work_date": "2026-10-01", "employee_id": employee["id"], "shift": "MONTH",
        "work_units": 20, "overtime_hours": 0, "bonus_amount": 100_000}]})
    r = client.get("/api/v1/reports/personal", headers=owner, params={
        "employee_id": employee["id"], "from_month": "2026-10-01", "to_month": "2026-10-01"})
    data = r.json()["data"]
    for field in ("total_bonus_amount", "total_advance_amount", "base_amount", "overtime_amount", "gross_amount", "net_amount"):
        assert isinstance(data[field], int)
