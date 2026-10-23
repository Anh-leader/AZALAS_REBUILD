"""Shared order classification & metrics — single source of truth for order stats.

Mọi màn hình (Dashboard, Chi tiết đơn, Thống kê soạn, Báo cáo) phải dùng chung
module này để đếm đơn, tránh mỗi nơi một công thức riêng và tránh bỏ sót đơn
chưa claim khỏi tổng thống kê.

Classification chuẩn (mutually exclusive, partition đúng 1 lần mỗi order):
- new       : status == NEW                       (chưa nhận / chưa soạn)
- picking   : status == PICKING                   (đã nhận, đang soạn)
- picked    : status in PICKED/SHIPPING/COMPLETED  (đã hoàn tất bước soạn)
- debt      : status == DEBT_ORDER                 (nợ đơn)
- cancelled : billing DELETED hoặc status CANCELLED/DELETED (hủy/xóa)
"""
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Invoice, InvoiceOrder, Order

BUSINESS_TZ = ZoneInfo("Asia/Ho_Chi_Minh")

# Workflow buckets (mutually exclusive) — giữ nguyên status code backend.
# "RETURNED" là trạng thái sau vận chuyển (hàng trả), vẫn đã hoàn tất bước soạn.
PICKED_STATUSES = ("PICKED", "SHIPPING", "COMPLETED", "RETURNED")
CANCELLED_STATUSES = ("CANCELLED", "DELETED")
DEBT_STATUSES = ("DEBT_ORDER",)
INVOICE_SENT_STATUSES = ("SENT", "PAID", "PARTIALLY_PAID")
INVOICE_PENDING_BILLING = ("DRAFT", "READY")

# Status chuẩn cho từng bucket workflow — dùng chung giữa Python (classify_order)
# và SQL (queue filter) để hai nơi không bao giờ lệch nhau.
NEW_STATUS = "NEW"
PICKING_STATUS = "PICKING"

_BUCKETS = ("new", "picking", "picked", "debt", "cancelled", "unclassified")


def bucket_statuses(bucket: str) -> tuple[str, ...]:
    """Trả về các status thuộc một workflow bucket (dùng chung cho Python + SQL)."""
    if bucket == "new":
        return (NEW_STATUS,)
    if bucket == "picking":
        return (PICKING_STATUS,)
    if bucket == "picked":
        return PICKED_STATUSES
    if bucket == "debt":
        return DEBT_STATUSES
    if bucket == "cancelled":
        return CANCELLED_STATUSES
    return ()


def classify_order(order: Order) -> str:
    """Phân loại một order vào đúng một bucket workflow (không double count)."""
    if order.billing_status == "DELETED" or order.status in CANCELLED_STATUSES:
        return "cancelled"
    if order.status == NEW_STATUS:
        return "new"
    if order.status == PICKING_STATUS:
        return "picking"
    if order.status in PICKED_STATUSES:
        return "picked"
    if order.status in DEBT_STATUSES:
        return "debt"
    return "unclassified"


def _order_filters(date_from: date, date_to: date, *, warehouse_id=None, order_type=None, picker_id=None):
    conds = [Order.created_date.between(date_from, date_to)]
    if warehouse_id:
        conds.append(Order.warehouse_id == warehouse_id)
    if order_type:
        conds.append(Order.order_type == order_type)
    if picker_id:
        conds.append(Order.claimed_by == picker_id)
    return conds


def _load_orders(db: Session, date_from: date, date_to: date, *, warehouse_id=None, order_type=None, picker_id=None) -> list[Order]:
    return list(db.scalars(
        select(Order).where(*_order_filters(date_from, date_to, warehouse_id=warehouse_id, order_type=order_type, picker_id=picker_id))
    ).unique())


def _sent_invoice_order_ids(db: Session, order_ids: list) -> set:
    if not order_ids:
        return set()
    return set(db.scalars(
        select(InvoiceOrder.order_id).where(
            InvoiceOrder.order_id.in_(order_ids),
            InvoiceOrder.invoice_id.in_(
                select(Invoice.id).where(Invoice.status.in_(INVOICE_SENT_STATUSES))
            ),
        )
    ).all())


def order_metrics(db: Session, *, date_from: date, date_to: date, warehouse_id=None, order_type=None, picker_id=None) -> dict:
    """Đếm đơn theo classification chuẩn trong khoảng created_date [date_from, date_to]."""
    orders = _load_orders(db, date_from, date_to, warehouse_id=warehouse_id, order_type=order_type, picker_id=picker_id)
    sent_ids = _sent_invoice_order_ids(db, [o.id for o in orders])

    buckets = {key: 0 for key in _BUCKETS}
    invoice_pending = 0
    invoice_sent = 0
    for o in orders:
        bucket = classify_order(o)
        buckets[bucket] += 1
        if bucket == "picked":
            if o.id in sent_ids:
                invoice_sent += 1
            elif o.billing_status in INVOICE_PENDING_BILLING:
                invoice_pending += 1

    new = buckets["new"]
    picking = buckets["picking"]
    picked = buckets["picked"]
    debt = buckets["debt"]
    cancelled = buckets["cancelled"]
    total = new + picking + picked + debt + cancelled + buckets["unclassified"]
    return {
        "total": total,
        "total_active": new + picking + picked + debt,
        "new": new,
        "picking": picking,
        "picked": picked,
        "debt": debt,
        "cancelled": cancelled,
        "unclassified": buckets["unclassified"],
        "invoice_pending": invoice_pending,
        "invoice_sent": invoice_sent,
    }


def picker_statistics(db: Session, *, month: str | None = None, warehouse_id=None) -> dict:
    """Thống kê soạn theo tháng, dùng chung classification & created_date như Dashboard.

    Trả về: total/new/picking/picked/debt/cancelled (toàn bộ đơn trong tháng,
    KHÔNG bỏ sót đơn chưa claim) + danh sách per-picker (Đã soạn / Đang soạn).
    """
    from ..core.errors import ApiError
    from .orders import order_to_dict

    today = datetime.now(BUSINESS_TZ).date()
    try:
        y, m = (int(x) for x in month.split("-")) if month else (today.year, today.month)
        start_date = date(y, m, 1)
        end_date = date(y + (m == 12), m % 12 + 1, 1) - timedelta(days=1)
    except (ValueError, AttributeError):
        raise ApiError(422, "INVALID_MONTH", "Tháng phải có dạng YYYY-MM.")

    metrics = order_metrics(db, date_from=start_date, date_to=end_date, warehouse_id=warehouse_id)

    orders = _load_orders(db, start_date, end_date, warehouse_id=warehouse_id)
    pickers: dict[str, dict] = {}
    for o in orders:
        bucket = classify_order(o)
        if bucket not in ("picking", "picked"):
            continue
        if o.claimed_by is None:
            continue
        p = pickers.setdefault(
            str(o.claimed_by),
            {"user_id": str(o.claimed_by), "name": o.claimer.display_name if o.claimer else None,
             "picked": 0, "picking": 0, "by_warehouse": {}, "orders": []},
        )
        p["picked" if bucket == "picked" else "picking"] += 1
        p["by_warehouse"][o.warehouse.name] = p["by_warehouse"].get(o.warehouse.name, 0) + 1
        p["orders"].append(order_to_dict(o))

    rows = sorted(pickers.values(), key=lambda p: -(p["picked"] + p["picking"]))
    return {
        "month": f"{y:04d}-{m:02d}",
        "total": metrics["total"],
        "new": metrics["new"],
        "picked": metrics["picked"],
        "picking": metrics["picking"],
        "debt": metrics["debt"],
        "cancelled": metrics["cancelled"],
        "pickers": rows,
    }
