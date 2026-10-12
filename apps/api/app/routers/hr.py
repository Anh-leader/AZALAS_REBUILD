import calendar
import uuid
from datetime import date

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.deps import current_user, require_permission
from ..core.errors import ApiError
from ..models import PayrollRun, User
from ..services import hr as svc

router = APIRouter(tags=["hr"], dependencies=[Depends(require_permission("hr.view"))])


class EmployeeIn(BaseModel):
    employee_code: str = Field(min_length=1, max_length=80)
    full_name: str = Field(min_length=1, max_length=250)
    phone: str | None = Field(None, max_length=30)
    position: str = Field(min_length=1, max_length=100)
    daily_rate_amount: int = Field(ge=0)
    start_date: date
    notes: str | None = None
    user_id: uuid.UUID | None = None


class EmployeePatch(BaseModel):
    full_name: str | None = Field(None, min_length=1, max_length=250)
    phone: str | None = Field(None, max_length=30)
    position: str | None = Field(None, min_length=1, max_length=100)
    daily_rate_amount: int | None = Field(None, ge=0)
    start_date: date | None = None
    status: str | None = None
    notes: str | None = None
    user_id: uuid.UUID | None = None


@router.get("/employees")
def employees(q: str | None = None, status: str | None = None, position: str | None = None,
              db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.list_employees(db, q, status, position)}


@router.post("/employees", status_code=201, dependencies=[Depends(require_permission("hr.manage"))])
def create_employee(body: EmployeeIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.create_employee(db, data=body.model_dump(), user=user)}


@router.patch("/employees/{employee_id}", dependencies=[Depends(require_permission("hr.manage"))])
def patch_employee(employee_id: uuid.UUID, body: EmployeePatch,
                   db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.update_employee(db, employee_id, values=body.model_dump(exclude_unset=True), user=user)}


class AttendanceIn(BaseModel):
    work_date: date
    employee_id: uuid.UUID
    shift: str = Field(min_length=1, max_length=30)
    work_units: float = Field(ge=0, le=31)
    overtime_hours: float = Field(ge=0, le=744)
    bonus_amount: int = Field(0, ge=0)
    notes: str | None = None


class AttendanceBatch(BaseModel):
    records: list[AttendanceIn] = Field(min_length=1, max_length=1000)


@router.get("/attendance")
def attendance(month: str | None = None, date_from: date | None = None, date_to: date | None = None,
               employee_id: uuid.UUID | None = None, db: Session = Depends(get_db), _=Depends(current_user)):
    if month:
        try:
            first = date.fromisoformat(f"{month}-01"); date_from = first; date_to = date(first.year, first.month, calendar.monthrange(first.year, first.month)[1])
        except ValueError as exc: raise ApiError(422, "MONTH_INVALID", "Tháng phải có dạng YYYY-MM.") from exc
    date_from = date_from or date.today(); date_to = date_to or date_from
    return {"data": svc.list_attendance(db, date_from, date_to, employee_id)}


@router.put("/attendance", dependencies=[Depends(require_permission("hr.manage"))])
def save_attendance(body: AttendanceBatch, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.save_attendance(db, records=[row.model_dump() for row in body.records], user=user)}


class AdvanceIn(BaseModel):
    advance_date: date
    employee_id: uuid.UUID
    amount: int = Field(gt=0)
    note: str | None = None


class AdvancePatch(BaseModel):
    status: str | None = None
    note: str | None = None


@router.get("/salary-advances")
def advances(employee_id: uuid.UUID | None = None, date_from: date | None = None, date_to: date | None = None,
             status: str | None = None, db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.list_advances(db, employee_id, date_from, date_to, status)}


@router.post("/salary-advances", status_code=201, dependencies=[Depends(require_permission("hr.manage"))])
def create_advance(body: AdvanceIn, idempotency_key: str = Header(..., alias="Idempotency-Key"),
                   db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.create_advance(db, data=body.model_dump(), idempotency_key=idempotency_key, user=user)}


@router.patch("/salary-advances/{advance_id}", dependencies=[Depends(require_permission("hr.manage"))])
def patch_advance(advance_id: uuid.UUID, body: AdvancePatch,
                  db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.update_advance(db, advance_id, **body.model_dump(), user=user)}


class PayrollIn(BaseModel):
    period_month: date


@router.post("/payroll-runs", status_code=201, dependencies=[Depends(require_permission("hr.manage"))])
def create_payroll(body: PayrollIn, idempotency_key: str = Header(..., alias="Idempotency-Key"),
                   db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.create_payroll(db, period_month=body.period_month, idempotency_key=idempotency_key, user=user)}


@router.get("/payroll-runs")
def payrolls(db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.list_payrolls(db)}


@router.get("/payroll-runs/{payroll_id}")
def payroll(payroll_id: uuid.UUID, db: Session = Depends(get_db), _=Depends(current_user)):
    row = db.get(PayrollRun, payroll_id)
    if not row: raise ApiError(404, "PAYROLL_NOT_FOUND", "Không tìm thấy bảng lương.")
    return {"data": svc.payroll_dict(row, db)}


class ApproveIn(BaseModel):
    version: int = Field(ge=1)


@router.post("/payroll-runs/{payroll_id}/approve")
def approve(payroll_id: uuid.UUID, body: ApproveIn,
            db: Session = Depends(get_db), user: User = Depends(require_permission("hr.payroll.approve"))):
    return {"data": svc.approve_payroll(db, payroll_id, version=body.version, user=user)}


class RateHistoryIn(BaseModel):
    effective_date: date
    new_daily_rate_amount: int = Field(ge=0)
    reason: str | None = Field(None, max_length=2000)


@router.get("/employees/{employee_id}/rate-history")
def employee_rate_history(employee_id: uuid.UUID, db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.list_rate_history(db, employee_id)}


@router.post("/employees/{employee_id}/rate-history", status_code=201,
             dependencies=[Depends(require_permission("hr.manage"))])
def create_rate_history(employee_id: uuid.UUID, body: RateHistoryIn,
                        db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.create_rate_history(db, employee_id, new_daily_rate_amount=body.new_daily_rate_amount,
                                            effective_date=body.effective_date, reason=body.reason, user=user)}


@router.get("/reports/personal")
def personal(employee_id: uuid.UUID, from_month: date, to_month: date,
             db: Session = Depends(get_db), _=Depends(current_user)):
    if from_month > to_month:
        raise ApiError(422, "MONTH_RANGE_INVALID", "Từ tháng phải trước hoặc bằng đến tháng.")
    return {"data": svc.personal_report(db, employee_id, from_month, to_month)}


@router.get("/reports/summary")
def summary(from_month: date, to_month: date, db: Session = Depends(get_db), _=Depends(current_user)):
    if from_month > to_month:
        raise ApiError(422, "MONTH_RANGE_INVALID", "Từ tháng phải trước hoặc bằng đến tháng.")
    return {"data": svc.summary_report(db, from_month, to_month)}
