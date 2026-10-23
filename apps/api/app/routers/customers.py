import time
from datetime import datetime, time as datetime_time, timezone
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.deps import current_user, require_permission
from ..core.errors import ApiError
from ..core.text import fold
from ..models import Customer, DebtLedgerEntry, Order
from ..services import orders as order_svc

router = APIRouter(prefix="/customers", tags=["customers"])

Sort = Literal[
    "debt_desc",
    "debt_asc",
    "name_asc",
    "name_desc",
    "created_desc",
    "created_asc",
]
BUSINESS_TZ = ZoneInfo("Asia/Ho_Chi_Minh")


def _name_key(r: dict) -> tuple[str, str]:
    return (fold(r["name"]), r["name"])


def sort_customers(rows: list[dict], sort: Sort) -> list[dict]:
    if sort == "created_desc":
        return sorted(rows, key=lambda r: (r["created_at"] or "", r["customer_code"]), reverse=True)
    if sort == "created_asc":
        return sorted(rows, key=lambda r: (r["created_at"] or "", r["customer_code"]))
    if sort == "name_asc":
        return sorted(rows, key=lambda r: (_name_key(r), -r["debt_amount"]))
    if sort == "name_desc":
        return sorted(rows, key=lambda r: (_name_key(r), r["debt_amount"]), reverse=True)
    if sort == "debt_asc":
        return sorted(rows, key=lambda r: (r["debt_amount"], _name_key(r)))
    return sorted(rows, key=lambda r: (-r["debt_amount"], _name_key(r)))


def customer_dict(c: Customer, debt_amount: int = 0, last_date=None) -> dict:
    return {
        "id": str(c.id),
        "customer_code": c.customer_code,
        "name": c.name,
        "phone": c.phone,
        "address": c.address,
        "carrier_name": c.carrier_name,
        "carrier_phone": c.carrier_phone,
        "debt_amount": int(debt_amount),
        "last_order_date": last_date.isoformat() if last_date else None,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


@router.get("")
def list_customers(
    q: str | None = None, sort: Sort = "debt_desc", db: Session = Depends(get_db), _=Depends(require_permission("customer_debt.view"))
):
    # Công nợ tính từ ledger, không lấy số chỉnh tay
    debt = (
        select(DebtLedgerEntry.party_id, func.sum(DebtLedgerEntry.amount_delta).label("debt"))
        .where(DebtLedgerEntry.party_type == "CUSTOMER")
        .group_by(DebtLedgerEntry.party_id)
        .subquery()
    )
    last = (
        select(Order.customer_id, func.max(Order.created_date).label("last"))
        .where(Order.status.not_in(["CANCELLED", "DELETED"]))
        .group_by(Order.customer_id)
        .subquery()
    )
    stmt = (
        select(Customer, func.coalesce(debt.c.debt, 0), last.c.last)
        .outerjoin(debt, debt.c.party_id == Customer.id)
        .outerjoin(last, last.c.customer_id == Customer.id)
        .where(Customer.deleted_at.is_(None))
    )
    qf = fold(q)
    rows = [
        customer_dict(c, d, l)
        for c, d, l in db.execute(stmt).all()
        if not qf or qf in fold(c.name) or qf in (c.phone or "") or qf in fold(c.customer_code)
    ]
    rows = sort_customers(rows, sort)
    total = sum(r["debt_amount"] for r in rows if r["debt_amount"] > 0)
    return {"data": rows, "meta": {"total_debt_amount": total, "count": len(rows)}}


@router.get("/debt-changes/today")
def customer_debt_changes_today(db: Session = Depends(get_db), _=Depends(require_permission("customer_debt.view"))):
    today = datetime.now(BUSINESS_TZ).date()
    start = datetime.combine(today, datetime_time.min, tzinfo=BUSINESS_TZ).astimezone(timezone.utc)
    end = datetime.combine(today, datetime_time.max, tzinfo=BUSINESS_TZ).astimezone(timezone.utc)
    paid_amount = func.sum(
        case(
            (DebtLedgerEntry.entry_type == "PAYMENT", -DebtLedgerEntry.amount_delta),
            else_=0,
        )
    )
    reduced_amount = func.sum(case((DebtLedgerEntry.amount_delta < 0, -DebtLedgerEntry.amount_delta), else_=0))
    increased_amount = func.sum(case((DebtLedgerEntry.amount_delta > 0, DebtLedgerEntry.amount_delta), else_=0))
    rows = db.execute(
        select(
            Customer.id,
            Customer.customer_code,
            Customer.name,
            func.sum(DebtLedgerEntry.amount_delta).label("net_change"),
            paid_amount.label("paid_amount"),
            reduced_amount.label("reduced_amount"),
            increased_amount.label("increased_amount"),
            func.count(DebtLedgerEntry.id).label("change_count"),
            func.max(DebtLedgerEntry.occurred_at).label("last_changed_at"),
        )
        .join(DebtLedgerEntry, DebtLedgerEntry.party_id == Customer.id)
        .where(
            Customer.deleted_at.is_(None),
            DebtLedgerEntry.party_type == "CUSTOMER",
            DebtLedgerEntry.occurred_at >= start,
            DebtLedgerEntry.occurred_at <= end,
        )
        .group_by(Customer.id, Customer.customer_code, Customer.name)
        .order_by(func.max(DebtLedgerEntry.occurred_at).desc(), Customer.name)
    ).all()
    changes = [
        {
            "customer_id": str(row.id),
            "customer_code": row.customer_code,
            "customer_name": row.name,
            "net_change": int(row.net_change or 0),
            "paid_amount": int(row.paid_amount or 0),
            "reduced_amount": int(row.reduced_amount or 0),
            "increased_amount": int(row.increased_amount or 0),
            "change_count": int(row.change_count or 0),
            "last_changed_at": row.last_changed_at.isoformat() if row.last_changed_at else None,
        }
        for row in rows
    ]
    return {
        "data": changes,
        "meta": {
            "customers_changed": len(changes),
            "total_paid_amount": sum(row["paid_amount"] for row in changes),
            "total_reduced_amount": sum(row["reduced_amount"] for row in changes),
            "total_increased_amount": sum(row["increased_amount"] for row in changes),
        },
    }


class CustomerIn(BaseModel):
    name: str = Field(min_length=1, max_length=300)
    phone: str | None = Field(None, max_length=30)
    address: str | None = None
    carrier_name: str | None = Field(None, max_length=200)
    carrier_phone: str | None = Field(None, max_length=30)


@router.post("", status_code=201)
def create_customer(body: CustomerIn, db: Session = Depends(get_db), _=Depends(current_user)):
    name = body.name.strip()
    if not name:
        raise ApiError(422, "NAME_REQUIRED", "Tên khách hàng là bắt buộc.")
    c = Customer(
        customer_code=f"KH{int(time.time() * 1000)}",
        name=name,
        phone=(body.phone or "").strip() or None,
        address=body.address,
        carrier_name=(body.carrier_name or "").strip() or None,
        carrier_phone=(body.carrier_phone or "").strip() or None,
    )
    db.add(c)
    db.commit()
    return {"data": customer_dict(c)}


@router.get("/lookup")
def lookup_customers(q: str | None = None, db: Session = Depends(get_db), _=Depends(require_permission("sales.view"))):
    """Lookup tối thiểu cho form tạo đơn / chọn khách: KHÔNG trả công nợ.

    Chỉ trả id, customer_code, name, phone. Endpoint đầy đủ (có debt) là GET /customers
    và yêu cầu quyền customer_debt.view.
    """
    stmt = select(Customer).where(Customer.deleted_at.is_(None)).order_by(Customer.name)
    qf = fold(q)
    rows = [
        {"id": str(c.id), "customer_code": c.customer_code, "name": c.name, "phone": c.phone}
        for c in db.scalars(stmt).all()
        if not qf or qf in fold(c.name) or qf in (c.phone or "") or qf in fold(c.customer_code)
    ]
    return {"data": rows}


@router.get("/{customer_id}")
def customer_detail(customer_id: str, db: Session = Depends(get_db), _=Depends(require_permission("customer_debt.view"))):
    try:
        import uuid
        parsed = uuid.UUID(customer_id)
    except ValueError as exc:
        raise ApiError(422, "INVALID_CUSTOMER_ID", "Mã khách hàng không hợp lệ.") from exc
    customer = db.get(Customer, parsed)
    if not customer or customer.deleted_at:
        raise ApiError(404, "CUSTOMER_NOT_FOUND", "Không tìm thấy khách hàng.")
    debt_amount = int(db.scalar(select(func.coalesce(func.sum(DebtLedgerEntry.amount_delta), 0)).where(
        DebtLedgerEntry.party_type == "CUSTOMER", DebtLedgerEntry.party_id == customer.id
    )) or 0)
    recent = list(db.scalars(select(Order).where(Order.customer_id == customer.id).order_by(
        Order.created_at.desc()).limit(20)).unique())
    return {"data": {**customer_dict(customer, debt_amount),
                     "recent_orders": [order_svc.order_to_dict(row) for row in recent]}}
