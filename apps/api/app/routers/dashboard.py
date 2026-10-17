from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.deps import require_permission
from ..core.errors import ApiError
from ..core.rbac import access_for_user
from ..models import DebtLedgerEntry, Invoice, Order, Payment, User
from ..services.order_metrics import BUSINESS_TZ, INVOICE_SENT_STATUSES, order_metrics

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/overview")
def overview(
    from_date: date | None = None,
    to_date: date | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("sales.view")),
):
    today = datetime.now(BUSINESS_TZ).date()
    period_start = from_date or today
    period_end = to_date or today
    if period_start > period_end:
        raise ApiError(422, "DATE_RANGE_INVALID", "Ngày bắt đầu không được sau ngày kết thúc.")

    start_at = datetime.combine(period_start, time.min, tzinfo=BUSINESS_TZ).astimezone(timezone.utc)
    end_at = datetime.combine(period_end + timedelta(days=1), time.min, tzinfo=BUSINESS_TZ).astimezone(timezone.utc)

    metrics = order_metrics(db, date_from=period_start, date_to=period_end)
    total_orders = metrics["total"]
    invoice_pending = metrics["invoice_pending"]
    invoice_sent = metrics["invoice_sent"]
    cancelled_orders = metrics["cancelled"]
    new_orders = metrics["new"]
    picking_orders = metrics["picking"]
    debt_orders = metrics["debt"]
    picked_orders = metrics["picked"]

    roles, _ = access_for_user(db, user)
    financial_available = "OWNER" in roles or "ADMIN" in roles
    if financial_available:
        revenue_amount = int(db.scalar(
            select(func.coalesce(func.sum(Invoice.subtotal_amount + Invoice.surcharge_amount), 0))
            .where(
                Invoice.issued_at >= start_at,
                Invoice.issued_at < end_at,
                Invoice.status.in_(INVOICE_SENT_STATUSES),
            )
        ) or 0)
        collected_amount = int(db.scalar(
            select(func.coalesce(func.sum(Payment.amount), 0))
            .where(
                Payment.paid_at >= start_at,
                Payment.paid_at < end_at,
                Payment.party_type == "CUSTOMER",
                Payment.direction == "RECEIPT",
                Payment.status == "POSTED",
            )
        ) or 0)
        debt_rows = db.execute(
            select(DebtLedgerEntry.party_type, DebtLedgerEntry.party_id, func.sum(DebtLedgerEntry.amount_delta))
            .group_by(DebtLedgerEntry.party_type, DebtLedgerEntry.party_id)
        ).all()
        receivables_amount = sum(int(balance) for party, _, balance in debt_rows if party == "CUSTOMER" and balance > 0)
        payables_amount = sum(int(balance) for party, _, balance in debt_rows if party != "CUSTOMER" and balance > 0)
        total_debt_amount = receivables_amount + payables_amount
        remaining_amount = collected_amount - payables_amount
        cashflow = {
            "available": True,
            "revenue_amount": revenue_amount,
            "collected_amount": collected_amount,
            "receivables_amount": receivables_amount,
            "payables_amount": payables_amount,
            "total_debt_amount": total_debt_amount,
            "remaining_amount": remaining_amount,
        }
    else:
        cashflow = {
            "available": False,
            "revenue_amount": None,
            "collected_amount": None,
            "receivables_amount": None,
            "payables_amount": None,
            "total_debt_amount": None,
            "remaining_amount": None,
        }

    recent = db.scalars(select(Order).order_by(Order.created_at.desc()).limit(5)).unique()
    return {
        "data": {
            "period": {
                "from_date": period_start.isoformat(),
                "to_date": period_end.isoformat(),
            },
            "cashflow": cashflow,
            "orders": {
                "total_orders": total_orders,
                "new_orders": new_orders,
                "picking_orders": picking_orders,
                "picked_orders": picked_orders,
                "invoice_pending": invoice_pending,
                "invoice_sent": invoice_sent,
                "debt_orders": debt_orders,
                "cancelled_orders": cancelled_orders,
            },
            # Retain flat fields for existing clients during the dashboard migration.
            "new_orders": new_orders,
            "picking_orders": picking_orders,
            "debt_orders": debt_orders,
            "recent_activity": [
                {
                    "order_id": str(o.id),
                    "order_no": o.order_no,
                    "customer_name": o.customer.name,
                    "status": o.status,
                    "created_at": o.created_at.isoformat(),
                }
                for o in recent
            ],
        }
    }
