from __future__ import annotations

import calendar
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core.errors import ApiError
from ..models import AttendanceRecord, Employee, EmployeeRateHistory, PayrollLine, PayrollRun, SalaryAdvance, User
from .production import add_audit, decimal, number, serial


def month_bounds(month: date) -> tuple[date, date]:
    first = month.replace(day=1)
    return first, date(first.year, first.month, calendar.monthrange(first.year, first.month)[1])


def money(value: Decimal) -> int:
    return int(value.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def employee_dict(row: Employee) -> dict:
    return {"id": str(row.id), "employee_code": row.employee_code, "full_name": row.full_name, "phone": row.phone,
            "position": row.position, "daily_rate_amount": row.daily_rate_amount, "start_date": row.start_date.isoformat(),
            "status": row.status, "notes": row.notes, "user_id": str(row.user_id) if row.user_id else None}


def list_employees(db: Session, q: str | None, status: str | None, position: str | None) -> list[dict]:
    stmt = select(Employee).order_by(Employee.full_name)
    if status: stmt = stmt.where(Employee.status == status)
    if position: stmt = stmt.where(Employee.position == position)
    rows = list(db.scalars(stmt)); needle = (q or "").strip().casefold()
    if needle: rows = [row for row in rows if needle in row.full_name.casefold() or needle in row.employee_code.casefold()]
    return [employee_dict(row) for row in rows]


def create_employee(db: Session, *, data: dict, user: User) -> dict:
    code = data["employee_code"].strip()
    if db.scalar(select(Employee.id).where(Employee.employee_code == code)):
        raise ApiError(409, "EMPLOYEE_EXISTS", "Mã nhân viên đã tồn tại.")
    row = Employee(employee_code=code, full_name=data["full_name"].strip(), phone=data.get("phone"),
                   position=data["position"].strip(), daily_rate_amount=data["daily_rate_amount"],
                   start_date=data["start_date"], notes=data.get("notes"), user_id=data.get("user_id"), status="ACTIVE")
    db.add(row); db.flush(); add_audit(db, user, "HR", "CREATE", "EMPLOYEE", row.id, after={"code": code, "name": row.full_name}); db.commit()
    return employee_dict(row)


def update_employee(db: Session, employee_id: uuid.UUID, *, values: dict, user: User) -> dict:
    row = db.scalar(select(Employee).where(Employee.id == employee_id).with_for_update(of=Employee))
    if not row: raise ApiError(404, "EMPLOYEE_NOT_FOUND", "Không tìm thấy nhân viên.")
    before = {key: getattr(row, key) for key in values}
    for key, value in values.items(): setattr(row, key, value)
    add_audit(db, user, "HR", "UPDATE", "EMPLOYEE", row.id, before=before, after=values); db.commit()
    return employee_dict(row)


def attendance_dict(row: AttendanceRecord, employee: Employee | None = None) -> dict:
    return {"id": str(row.id), "work_date": row.work_date.isoformat(), "employee_id": str(row.employee_id),
            "employee_name": employee.full_name if employee else None, "shift": row.shift,
            "work_units": serial(row.work_units), "overtime_hours": serial(row.overtime_hours),
            "bonus_amount": row.bonus_amount, "notes": row.notes}


def list_attendance(db: Session, date_from: date, date_to: date, employee_id: uuid.UUID | None) -> list[dict]:
    stmt = select(AttendanceRecord).where(AttendanceRecord.work_date.between(date_from, date_to)).order_by(AttendanceRecord.work_date, AttendanceRecord.employee_id, AttendanceRecord.shift)
    if employee_id: stmt = stmt.where(AttendanceRecord.employee_id == employee_id)
    rows = list(db.scalars(stmt)); employees = {row.id: row for row in db.scalars(select(Employee).where(Employee.id.in_({r.employee_id for r in rows})))} if rows else {}
    return [attendance_dict(row, employees.get(row.employee_id)) for row in rows]


def save_attendance(db: Session, *, records: list[dict], user: User) -> list[dict]:
    if not records: raise ApiError(422, "ATTENDANCE_REQUIRED", "Danh sách chấm công trống.")
    keys = [(row["work_date"], row["employee_id"], row["shift"]) for row in records]
    if len(keys) != len(set(keys)): raise ApiError(422, "ATTENDANCE_DUPLICATE", "Trùng nhân viên/ngày/ca trong cùng lần lưu.")
    changed = []
    for data in records:
        employee = db.get(Employee, data["employee_id"])
        if not employee: raise ApiError(404, "EMPLOYEE_NOT_FOUND", "Có nhân viên không tồn tại.")
        month = data["work_date"].replace(day=1)
        approved = db.scalar(select(PayrollRun.id).where(PayrollRun.period_month == month, PayrollRun.status.in_(("APPROVED", "PAID"))))
        if approved: raise ApiError(409, "PAYROLL_LOCKED", "Tháng đã duyệt lương, không thể sửa chấm công.")
        work_units = decimal(data["work_units"]); overtime = decimal(data["overtime_hours"])
        bonus = int(data.get("bonus_amount") or 0)
        if bonus < 0: raise ApiError(422, "BONUS_INVALID", "Thưởng không được âm.")
        is_month = data.get("shift") == "MONTH"
        max_units = 31 if is_month else 2
        if work_units < 0 or work_units > max_units or overtime < 0 or overtime > 744:
            raise ApiError(422, "ATTENDANCE_VALUE_INVALID",
                           f"Công phải từ 0–{max_units} và tăng ca từ 0–744 giờ.")
        row = db.scalar(select(AttendanceRecord).where(AttendanceRecord.work_date == data["work_date"],
            AttendanceRecord.employee_id == data["employee_id"], AttendanceRecord.shift == data["shift"]).with_for_update(of=AttendanceRecord))
        if row:
            row.work_units = work_units; row.overtime_hours = overtime; row.bonus_amount = bonus
            row.notes = data.get("notes"); row.entered_by = user.id
        else:
            row = AttendanceRecord(work_date=data["work_date"], employee_id=data["employee_id"], shift=data["shift"],
                                   work_units=work_units, overtime_hours=overtime, bonus_amount=bonus,
                                   notes=data.get("notes"), entered_by=user.id)
            db.add(row); db.flush()
        changed.append((row, employee))
    add_audit(db, user, "HR", "ATTENDANCE_UPSERT", "ATTENDANCE_RECORD", changed[0][0].id,
              after={"record_count": len(changed), "dates": sorted({str(row[0].work_date) for row in changed})}); db.commit()
    return [attendance_dict(row, employee) for row, employee in changed]


def advance_dict(row: SalaryAdvance, employee: Employee | None = None) -> dict:
    return {"id": str(row.id), "advance_no": row.advance_no, "advance_date": row.advance_date.isoformat(),
            "employee_id": str(row.employee_id), "employee_name": employee.full_name if employee else None,
            "amount": row.amount, "note": row.note, "status": row.status}


def create_advance(db: Session, *, data: dict, idempotency_key: str, user: User) -> dict:
    existing = db.scalar(select(SalaryAdvance).where(SalaryAdvance.idempotency_key == idempotency_key))
    if existing: return advance_dict(existing, db.get(Employee, existing.employee_id))
    employee = db.get(Employee, data["employee_id"])
    if not employee: raise ApiError(404, "EMPLOYEE_NOT_FOUND", "Không tìm thấy nhân viên.")
    month = data["advance_date"].replace(day=1)
    if db.scalar(select(PayrollRun.id).where(PayrollRun.period_month == month, PayrollRun.status.in_(("APPROVED", "PAID")))):
        raise ApiError(409, "PAYROLL_LOCKED", "Tháng đã duyệt lương, không thể thêm ứng lương.")
    row = SalaryAdvance(advance_no=number("UL"), advance_date=data["advance_date"], employee_id=employee.id,
                        amount=data["amount"], note=data.get("note"), approved_by=user.id, status="APPROVED",
                        idempotency_key=idempotency_key)
    db.add(row); db.flush(); add_audit(db, user, "HR", "SALARY_ADVANCE", "SALARY_ADVANCE", row.id, idempotency_key, after={"employee_id": str(employee.id), "amount": row.amount}); db.commit()
    return advance_dict(row, employee)


def list_advances(db: Session, employee_id: uuid.UUID | None, date_from: date | None, date_to: date | None, status: str | None) -> list[dict]:
    stmt = select(SalaryAdvance).order_by(SalaryAdvance.advance_date.desc(), SalaryAdvance.created_at.desc())
    if employee_id: stmt = stmt.where(SalaryAdvance.employee_id == employee_id)
    if date_from: stmt = stmt.where(SalaryAdvance.advance_date >= date_from)
    if date_to: stmt = stmt.where(SalaryAdvance.advance_date <= date_to)
    if status: stmt = stmt.where(SalaryAdvance.status == status)
    rows = list(db.scalars(stmt)); employees = {row.id: row for row in db.scalars(select(Employee))}
    return [advance_dict(row, employees.get(row.employee_id)) for row in rows]


def update_advance(db: Session, advance_id: uuid.UUID, *, status: str | None, note: str | None, user: User) -> dict:
    row = db.scalar(select(SalaryAdvance).where(SalaryAdvance.id == advance_id).with_for_update(of=SalaryAdvance))
    if not row: raise ApiError(404, "SALARY_ADVANCE_NOT_FOUND", "Không tìm thấy phiếu ứng lương.")
    month = row.advance_date.replace(day=1)
    if db.scalar(select(PayrollRun.id).where(PayrollRun.period_month == month, PayrollRun.status.in_(("APPROVED", "PAID")))):
        raise ApiError(409, "PAYROLL_LOCKED", "Tháng đã duyệt lương, không thể sửa ứng lương.")
    if status and status not in ("APPROVED", "CANCELLED"):
        raise ApiError(422, "ADVANCE_STATUS_INVALID", "Trạng thái ứng lương không hợp lệ.")
    before = {"status": row.status, "note": row.note}
    if status: row.status = status
    if note is not None: row.note = note
    add_audit(db, user, "HR", "SALARY_ADVANCE_UPDATE", "SALARY_ADVANCE", row.id, before=before,
              after={"status": row.status, "note": row.note}); db.commit()
    return advance_dict(row, db.get(Employee, row.employee_id))


def payroll_dict(row: PayrollRun, db: Session) -> dict:
    lines = list(db.scalars(select(PayrollLine).where(PayrollLine.payroll_run_id == row.id).order_by(PayrollLine.employee_name_snapshot)))
    return {"id": str(row.id), "payroll_no": row.payroll_no, "period_month": row.period_month.isoformat(),
            "status": row.status, "calculated_at": row.calculated_at.isoformat(),
            "approved_at": row.approved_at.isoformat() if row.approved_at else None,
            "paid_at": row.paid_at.isoformat() if row.paid_at else None,
            "total_gross_amount": row.total_gross_amount, "total_advance_amount": row.total_advance_amount,
            "total_net_amount": row.total_net_amount, "version": row.version, "snapshot": row.snapshot,
            "lines": [{"id": str(line.id), "employee_id": str(line.employee_id), "employee_name": line.employee_name_snapshot,
                       "daily_rate_amount": line.daily_rate_amount, "work_units": serial(line.work_units),
                       "overtime_hours": serial(line.overtime_hours), "base_amount": line.base_amount,
                       "overtime_amount": line.overtime_amount, "advance_amount": line.advance_amount,
                       "net_amount": line.net_amount, "snapshot": line.snapshot} for line in lines]}


def create_payroll(db: Session, *, period_month: date, idempotency_key: str, user: User) -> dict:
    existing = db.scalar(select(PayrollRun).where(PayrollRun.idempotency_key == idempotency_key))
    if existing: return payroll_dict(existing, db)
    month, month_end = month_bounds(period_month)
    if db.scalar(select(PayrollRun.id).where(PayrollRun.period_month == month)):
        raise ApiError(409, "PAYROLL_MONTH_EXISTS", "Tháng này đã có bảng lương.")
    employees = list(db.scalars(select(Employee).where(Employee.status == "ACTIVE", Employee.start_date <= month_end).order_by(Employee.id)))
    run = PayrollRun(payroll_no=number("BL"), period_month=month, status="DRAFT", calculated_at=datetime.now(timezone.utc),
                     total_gross_amount=0, total_advance_amount=0, total_net_amount=0,
                     snapshot={"formula": "base=work_units*daily_rate; overtime=hours*daily_rate/8", "period_end": month_end.isoformat()},
                     created_by=user.id, idempotency_key=idempotency_key)
    db.add(run); db.flush(); gross_total = advance_total = net_total = 0
    for employee in employees:
        attendance = list(db.scalars(select(AttendanceRecord).where(AttendanceRecord.employee_id == employee.id,
            AttendanceRecord.work_date.between(month, month_end)).order_by(AttendanceRecord.work_date, AttendanceRecord.shift)))
        advances = list(db.scalars(select(SalaryAdvance).where(SalaryAdvance.employee_id == employee.id,
            SalaryAdvance.advance_date.between(month, month_end), SalaryAdvance.status == "APPROVED")))
        work_units = sum((row.work_units for row in attendance), Decimal(0)); overtime_hours = sum((row.overtime_hours for row in attendance), Decimal(0))
        base_amount = money(work_units * employee.daily_rate_amount); overtime_amount = money(overtime_hours * Decimal(employee.daily_rate_amount) / Decimal(8))
        advance_amount = sum(row.amount for row in advances); net_amount = base_amount + overtime_amount - advance_amount
        snapshot = {"employee_code": employee.employee_code, "full_name": employee.full_name,
                    "daily_rate_amount": employee.daily_rate_amount, "attendance_ids": [str(row.id) for row in attendance],
                    "advance_ids": [str(row.id) for row in advances]}
        db.add(PayrollLine(payroll_run_id=run.id, employee_id=employee.id, employee_name_snapshot=employee.full_name,
            daily_rate_amount=employee.daily_rate_amount, work_units=work_units, overtime_hours=overtime_hours,
            base_amount=base_amount, overtime_amount=overtime_amount, advance_amount=advance_amount,
            net_amount=net_amount, snapshot=snapshot))
        gross_total += base_amount + overtime_amount; advance_total += advance_amount; net_total += net_amount
    run.total_gross_amount = gross_total; run.total_advance_amount = advance_total; run.total_net_amount = net_total
    add_audit(db, user, "HR", "PAYROLL_CALCULATE", "PAYROLL_RUN", run.id, idempotency_key, after={"period_month": month.isoformat(), "employee_count": len(employees), "net_amount": net_total}); db.commit()
    return payroll_dict(run, db)


def approve_payroll(db: Session, payroll_id: uuid.UUID, *, version: int, user: User) -> dict:
    row = db.scalar(select(PayrollRun).where(PayrollRun.id == payroll_id).with_for_update(of=PayrollRun))
    if not row: raise ApiError(404, "PAYROLL_NOT_FOUND", "Không tìm thấy bảng lương.")
    if row.status == "APPROVED": return payroll_dict(row, db)
    if row.status != "DRAFT" or row.version != version: raise ApiError(409, "PAYROLL_CONFLICT", "Bảng lương đã thay đổi hoặc không thể duyệt.")
    row.status = "APPROVED"; row.approved_by = user.id; row.approved_at = datetime.now(timezone.utc); row.version += 1
    add_audit(db, user, "HR", "PAYROLL_APPROVE", "PAYROLL_RUN", row.id, after={"period_month": row.period_month.isoformat(), "net_amount": row.total_net_amount}); db.commit()
    return payroll_dict(row, db)


def list_payrolls(db: Session) -> list[dict]:
    return [payroll_dict(row, db) for row in db.scalars(select(PayrollRun).order_by(PayrollRun.period_month.desc()))]


def create_rate_history(db: Session, employee_id: uuid.UUID, *, new_daily_rate_amount: int,
                        effective_date: date, reason: str | None, user: User) -> dict:
    employee = db.scalar(select(Employee).where(Employee.id == employee_id).with_for_update(of=Employee))
    if not employee: raise ApiError(404, "EMPLOYEE_NOT_FOUND", "Không tìm thấy nhân viên.")
    if new_daily_rate_amount < 0: raise ApiError(422, "RATE_INVALID", "Giá công không được âm.")
    old = employee.daily_rate_amount
    employee.daily_rate_amount = new_daily_rate_amount
    row = EmployeeRateHistory(employee_id=employee.id, effective_date=effective_date,
                              old_daily_rate_amount=old, new_daily_rate_amount=new_daily_rate_amount,
                              reason=(reason or "").strip() or None, changed_by=user.id)
    db.add(row); db.flush()
    add_audit(db, user, "HR", "RATE_CHANGE", "EMPLOYEE", employee.id,
              before={"daily_rate_amount": old}, after={"daily_rate_amount": new_daily_rate_amount,
                                                        "effective_date": effective_date.isoformat()})
    db.commit()
    return rate_history_dict(row)


def rate_history_dict(row: EmployeeRateHistory) -> dict:
    return {"id": str(row.id), "employee_id": str(row.employee_id), "effective_date": row.effective_date.isoformat(),
            "old_daily_rate_amount": row.old_daily_rate_amount, "new_daily_rate_amount": row.new_daily_rate_amount,
            "reason": row.reason, "changed_by": str(row.changed_by) if row.changed_by else None,
            "created_at": row.created_at.isoformat() if row.created_at else None}


def list_rate_history(db: Session, employee_id: uuid.UUID) -> list[dict]:
    rows = list(db.scalars(select(EmployeeRateHistory).where(
        EmployeeRateHistory.employee_id == employee_id).order_by(EmployeeRateHistory.effective_date.desc(),
                                                                 EmployeeRateHistory.created_at.desc())))
    return [rate_history_dict(row) for row in rows]


def _month_between(month: date, start: date, end: date) -> bool:
    return start.replace(day=1) <= month.replace(day=1) <= end.replace(day=1)


def _employee_report_rows(db: Session, employee: Employee, start: date, end: date) -> dict:
    attendance = list(db.scalars(select(AttendanceRecord).where(
        AttendanceRecord.employee_id == employee.id,
        AttendanceRecord.work_date.between(start, end)).order_by(AttendanceRecord.work_date)))
    advances = list(db.scalars(select(SalaryAdvance).where(
        SalaryAdvance.employee_id == employee.id,
        SalaryAdvance.advance_date.between(start, end), SalaryAdvance.status == "APPROVED")))
    work_units = sum((row.work_units for row in attendance), Decimal(0))
    overtime_hours = sum((row.overtime_hours for row in attendance), Decimal(0))
    bonus = sum(row.bonus_amount for row in attendance)
    advance_amount = sum(row.amount for row in advances)
    base = money(work_units * employee.daily_rate_amount)
    overtime_amount = money(overtime_hours * Decimal(employee.daily_rate_amount) / Decimal(8))
    gross = base + overtime_amount + bonus
    net = gross - advance_amount
    by_month: dict[str, dict] = {}
    for row in attendance:
        key = row.work_date.strftime("%Y-%m")
        entry = by_month.setdefault(key, {"month": key, "work_units": Decimal(0), "overtime_hours": Decimal(0), "bonus_amount": 0})
        entry["work_units"] += row.work_units
        entry["overtime_hours"] += row.overtime_hours
        entry["bonus_amount"] += row.bonus_amount
    advance_by_month: dict[str, int] = {}
    for row in advances:
        key = row.advance_date.strftime("%Y-%m")
        advance_by_month[key] = advance_by_month.get(key, 0) + row.amount
    month_rows = []
    for key in sorted(set(list(by_month) + list(advance_by_month))):
        att = by_month.get(key, {"work_units": Decimal(0), "overtime_hours": Decimal(0), "bonus_amount": 0})
        adv = advance_by_month.get(key, 0)
        month_rows.append({"month": key, "work_units": serial(att["work_units"]),
                           "overtime_hours": serial(att["overtime_hours"]), "bonus_amount": att["bonus_amount"],
                           "advance_amount": adv})
    return {"employee_id": str(employee.id), "employee_name": employee.full_name,
            "employee_code": employee.employee_code, "daily_rate_amount": employee.daily_rate_amount,
            "total_work_units": serial(work_units), "total_overtime_hours": serial(overtime_hours),
            "total_bonus_amount": bonus, "total_advance_amount": advance_amount,
            "base_amount": base, "overtime_amount": overtime_amount, "gross_amount": gross,
            "net_amount": net, "months": month_rows}


def personal_report(db: Session, employee_id: uuid.UUID, from_month: date, to_month: date) -> dict:
    employee = db.get(Employee, employee_id)
    if not employee: raise ApiError(404, "EMPLOYEE_NOT_FOUND", "Không tìm thấy nhân viên.")
    start = from_month.replace(day=1)
    end = date(to_month.year, to_month.month, calendar.monthrange(to_month.year, to_month.month)[1])
    return _employee_report_rows(db, employee, start, end)


def summary_report(db: Session, from_month: date, to_month: date) -> dict:
    start = from_month.replace(day=1)
    end = date(to_month.year, to_month.month, calendar.monthrange(to_month.year, to_month.month)[1])
    employees = list(db.scalars(select(Employee).where(Employee.status == "ACTIVE").order_by(Employee.full_name)))
    rows = [_employee_report_rows(db, employee, start, end) for employee in employees]
    return {
        "from_month": start.isoformat(), "to_month": end.isoformat(),
        "employee_count": len(rows),
        "total_work_units": sum(r["total_work_units"] for r in rows),
        "total_overtime_hours": sum(r["total_overtime_hours"] for r in rows),
        "total_bonus_amount": sum(r["total_bonus_amount"] for r in rows),
        "total_advance_amount": sum(r["total_advance_amount"] for r in rows),
        "total_gross_amount": sum(r["gross_amount"] for r in rows),
        "total_net_amount": sum(r["net_amount"] for r in rows),
        "employees": rows,
    }
