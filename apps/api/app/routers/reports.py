import uuid
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query
from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.deps import current_user, require_permission
from ..core.errors import ApiError
from ..core.rbac import access_for_user
from ..models import (AuditLog, Customer, DebtLedgerEntry, InventoryBalance, Invoice, InvoiceOrder,
                      Order, OrderStatusEvent, PartyDebtBalance, Payment, User)
from ..services.orders import order_to_dict
from ..services.order_metrics import BUSINESS_TZ, PICKED_STATUSES, order_metrics

router = APIRouter(tags=["reports"], dependencies=[Depends(require_permission("reports.view"))])
INVOICE_REVENUE_STATUSES = ("SENT", "PAID", "PARTIALLY_PAID")


def report_period(date_from: date | None, date_to: date | None) -> tuple[date, date, datetime, datetime]:
    today = datetime.now(BUSINESS_TZ).date()
    first = date_from or today
    last = date_to or today
    if first > last:
        raise ApiError(422, "DATE_RANGE_INVALID", "Ngày bắt đầu không được sau ngày kết thúc.")
    start = datetime.combine(first, time.min, tzinfo=BUSINESS_TZ).astimezone(timezone.utc)
    end = datetime.combine(last + timedelta(days=1), time.min, tzinfo=BUSINESS_TZ).astimezone(timezone.utc)
    return first, last, start, end


def audit_log_data(row: AuditLog, actor_name: str | None = None) -> dict:
    module_label = audit_module_label(row.module)
    action_label = audit_action_label(row.action, row.module, row.entity_type)
    entity_label = audit_entity_label(row.entity_type)
    snapshot = row.after_data or row.before_data
    entity_code = audit_reference(snapshot)
    description = audit_description(actor_name, action_label, entity_label, entity_code,
                                    row.before_data, row.after_data)
    return {
        "id": str(row.id),
        "entity_type": row.entity_type,
        "entity_label": entity_label,
        "entity_id": str(row.entity_id),
        "entity_code": entity_code,
        "action": row.action,
        "action_label": action_label,
        "module": row.module,
        "module_label": module_label,
        "actor_user_id": str(row.actor_user_id) if row.actor_user_id else None,
        "actor_name": actor_name,
        "description_vi": description,
        "request_id": row.request_id,
        "before": row.before_data,
        "after": row.after_data,
        "occurred_at": row.occurred_at.isoformat(),
    }


MODULE_LABELS = {
    "ORDER": "Đơn hàng", "ORDERS": "Đơn hàng", "SALES": "Đơn hàng",
    "CUSTOMER": "Khách hàng", "CUSTOMERS": "Khách hàng",
    "INVOICE": "Hóa đơn", "INVOICES": "Hóa đơn",
    "PAYMENT": "Thanh toán", "PAYMENTS": "Thanh toán",
    "DEBT": "Công nợ", "INVENTORY": "Kho", "MEDIA": "Hình ảnh / File",
    "PRODUCTION": "QL Rập", "WORKSHOP": "Nhà may", "WORKSHOPS": "Nhà may",
    "CUTTING": "Thợ cắt", "CUTTING_TEAM": "Thợ cắt",
    "MATERIAL": "Phụ liệu", "MATERIALS": "Phụ liệu",
    "HR": "Nhân sự", "USER": "Tài khoản", "USERS": "Tài khoản",
    "ADMIN": "Tài khoản", "AUTH": "Đăng nhập", "REPORTS": "Báo cáo",
    "SYSTEM": "Hệ thống", "RETURNS": "Hàng trả",
}
MODULE_FILTER_ALIASES = {
    "ORDER": ("ORDER", "ORDERS", "SALES"),
    "CUSTOMER": ("CUSTOMER", "CUSTOMERS"),
    "INVOICE": ("INVOICE", "INVOICES"),
    "PAYMENT": ("PAYMENT", "PAYMENTS"),
    "DEBT": ("DEBT",),
    "INVENTORY": ("INVENTORY",),
    "MEDIA": ("MEDIA",),
    "PRODUCTION": ("PRODUCTION",),
    "WORKSHOP": ("WORKSHOP", "WORKSHOPS"),
    "CUTTING": ("CUTTING", "CUTTING_TEAM"),
    "MATERIALS": ("MATERIAL", "MATERIALS"),
    "HR": ("HR",),
    "ADMIN": ("ADMIN", "USER", "USERS"),
    "SYSTEM": ("SYSTEM", "AUTH", "REPORTS"),
}

ENTITY_LABELS = {
    "ORDER": "Đơn hàng", "CUSTOMER": "Khách hàng", "INVOICE": "Hóa đơn",
    "PAYMENT": "Thanh toán", "DEBT_ENTRY": "Dòng công nợ",
    "DEBT_ADJUSTMENT": "Điều chỉnh công nợ", "INVENTORY_BALANCE": "Tồn kho",
    "INVENTORY_TRANSACTION": "Giao dịch kho", "PRODUCTION_BATCH": "Mâm/rập",
    "WORKSHOP_SETTLEMENT": "Bảng kê nhà may", "CUTTING_SETTLEMENT": "Bảng kê thợ cắt",
    "CUTTING_REPORT": "Báo cáo thợ cắt", "MATERIAL_RECEIPT": "Phiếu nhập phụ liệu",
    "PARTNER_TRANSACTION": "Giao dịch phụ liệu", "PARTNER_SETTLEMENT": "Bảng kê phụ liệu",
    "EMPLOYEE": "Nhân viên", "ATTENDANCE_RECORD": "Bản ghi chấm công",
    "SALARY_ADVANCE": "Phiếu ứng lương", "PAYROLL_RUN": "Bảng lương",
    "USER": "Tài khoản", "MEDIA_OBJECT": "Ảnh/File", "PARTNER": "Đối tác",
    "WORKSHOP": "Nhà may", "CUTTING_TEAM": "Tổ thợ cắt", "RETURN": "Phiếu hàng trả",
    "PATTERN": "Rập", "PATTERN_NOTE": "Ghi chú rập", "FABRIC_SUPPLIER": "Nhà cung cấp vải",
    "MATERIAL": "Phụ liệu", "BATCH_MATERIAL_DELIVERY": "Phiếu giao phụ liệu",
}

ACTION_LABELS = {
    "ORDER_CREATED": "Tạo đơn hàng", "ORDER_UPDATED": "Cập nhật đơn hàng",
    "ORDER_DELETED": "Xóa đơn hàng", "ORDER_PICKED": "Lưu soạn hàng",
    "ORDER_CLAIMED": "Nhận soạn đơn", "INVOICE_CREATED": "Tạo hóa đơn",
    "INVOICE_CAPTURED": "Chụp ảnh hóa đơn", "INVOICE_CLOSED": "Chốt hóa đơn",
    "PAYMENT_CREATED": "Tạo thanh toán", "CUSTOMER_CREATED": "Thêm khách hàng",
    "CUSTOMER_UPDATED": "Cập nhật khách hàng",
    "CUSTOMER_DEBT_ADJUSTMENT": "Điều chỉnh công nợ khách",
    "INVENTORY_RESERVED": "Giữ tồn kho", "INVENTORY_EXPORTED": "Xuất kho",
    "PRODUCTION_BATCH_CREATED": "Tạo mâm/rập",
    "WORKSHOP_SETTLEMENT_CREATED": "Chốt thanh toán nhà may",
    "CUTTING_SETTLEMENT_CREATED": "Chốt thanh toán thợ cắt",
    "MATERIAL_RECEIPT_CREATED": "Nhập phụ liệu", "MATERIAL_PAYMENT_CREATED": "Thanh toán phụ liệu",
    "EMPLOYEE_ATTENDANCE_CREATED": "Nhập công nhân viên",
    "EMPLOYEE_ADVANCE_CREATED": "Ứng lương nhân viên",
    "USER_LOGIN": "Đăng nhập", "USER_LOGOUT": "Đăng xuất",
    "CREATE": "Tạo mới", "UPDATE": "Cập nhật", "DELETE": "Xóa",
    "VOID": "Hủy", "CANCEL": "Hủy", "RESTORE": "Khôi phục",
    "CLOSE": "Chốt hóa đơn", "PAYMENT": "Thanh toán", "SETTLE": "Chốt thanh toán",
    "RECEIPT": "Nhập kho", "RECEIPT_POST": "Xác nhận nhập kho",
    "IMPORT_STOCK": "Nhập kho thành phẩm", "ATTENDANCE_UPSERT": "Cập nhật chấm công",
    "SALARY_ADVANCE": "Ứng lương nhân viên", "SALARY_ADVANCE_UPDATE": "Cập nhật phiếu ứng lương",
    "PAYROLL_CALCULATE": "Tính lương", "PAYROLL_APPROVE": "Duyệt bảng lương",
    "RATE_CHANGE": "Thay đổi mức lương", "ADJUST": "Điều chỉnh công nợ",
    "START_PICKING": "Bắt đầu xử lý mâm", "MARK_DEBT": "Ghi nhận nợ",
    "FORCE_CLOSE": "Chốt mâm", "MATERIAL_DELIVERY": "Giao phụ liệu",
    "SUPPLEMENTAL_DELIVERY": "Giao hàng bổ sung", "CUTTING_REPORT": "Ghi nhận báo cáo thợ cắt",
    "CUTTING_MONTHLY_SETTLE": "Chốt thanh toán thợ cắt",
    "ATTACH_FILE": "Đính kèm tệp", "APPROVE": "Duyệt phiếu hàng trả",
    "TRANSACTION": "Ghi nhận giao dịch", "DELETE_PENDING": "Xóa hóa đơn chờ",
    "DEBT_ADJUSTMENT": "Điều chỉnh công nợ khách",
    "ORDER_STATUS": "Cập nhật trạng thái đơn hàng",
    "INVOICE_STATUS": "Cập nhật trạng thái hóa đơn",
    "CLAIM": "Nhận soạn đơn", "PICK": "Soạn hàng",
    "INVOICE_CAPTURE": "Chụp ảnh hóa đơn",
    "WORKSHOP_SETTLEMENT": "Chốt thanh toán nhà may",
    "CUTTING_SETTLEMENT": "Chốt thanh toán thợ cắt",
}

REFERENCE_KEYS = (
    "order_no", "invoice_no", "payment_no", "customer_code", "batch_no",
    "settlement_no", "receipt_no", "employee_code", "partner_code", "code",
    "orderNo", "invoiceNo", "paymentNo", "customerCode", "batchNo",
)

DISPLAY_NAME_KEYS = ("customer_name", "name", "employee_name", "workshop_name", "partner_name")
AMOUNT_KEYS = ("amount", "total_amount", "net_amount", "paid_amount")


def _audit_code(value: str | None) -> str:
    return (value or "").strip().upper().replace("-", "_").replace(" ", "_")


def audit_module_label(module: str | None) -> str:
    code = _audit_code(module)
    if code in MODULE_LABELS:
        return MODULE_LABELS[code]
    if code.startswith("CUSTOMER"):
        return "Khách hàng"
    if code.startswith("ORDER"):
        return "Đơn hàng"
    if code.startswith("INVOICE"):
        return "Hóa đơn"
    if code.startswith("PAYMENT"):
        return "Thanh toán"
    return "Hệ thống"


def audit_entity_label(entity_type: str | None) -> str:
    code = _audit_code(entity_type)
    if code in ENTITY_LABELS:
        return ENTITY_LABELS[code]
    if code.endswith("_ORDER"):
        return "Đơn hàng"
    if code.endswith("_PAYMENT"):
        return "Thanh toán"
    return "Đối tượng hệ thống"


def audit_action_label(action: str | None, module: str | None, entity_type: str | None) -> str:
    code = _audit_code(action)
    if code == "ADJUST" and _audit_code(module) == "DEBT" and _audit_code(entity_type) == "CUSTOMER":
        return "Điều chỉnh công nợ khách"
    if code in ACTION_LABELS and code not in ("CREATE", "UPDATE", "DELETE", "SETTLE", "PAYMENT"):
        return ACTION_LABELS[code]
    module_code = _audit_code(module)
    entity_code = _audit_code(entity_type)
    entity_actions = {
        "ORDER": {"CREATE": "Tạo đơn hàng", "UPDATE": "Cập nhật đơn hàng", "DELETE": "Xóa đơn hàng"},
        "CUSTOMER": {"CREATE": "Thêm khách hàng", "UPDATE": "Cập nhật khách hàng", "DELETE": "Xóa khách hàng"},
        "INVOICE": {"CREATE": "Tạo hóa đơn", "UPDATE": "Cập nhật hóa đơn", "DELETE": "Xóa hóa đơn", "CLOSE": "Chốt hóa đơn"},
        "PAYMENT": {"CREATE": "Tạo thanh toán", "PAYMENT": "Tạo thanh toán"},
        "PRODUCTION_BATCH": {"CREATE": "Tạo mâm/rập", "UPDATE": "Cập nhật mâm/rập", "DELETE": "Xóa mâm/rập"},
        "WORKSHOP_SETTLEMENT": {"CREATE": "Chốt thanh toán nhà may", "SETTLE": "Chốt thanh toán nhà may"},
        "CUTTING_REPORT": {"CREATE": "Tạo báo cáo thợ cắt", "SETTLE": "Chốt thanh toán thợ cắt"},
        "EMPLOYEE": {"CREATE": "Thêm nhân viên", "UPDATE": "Cập nhật nhân viên"},
        "USER": {"CREATE": "Tạo tài khoản", "UPDATE": "Cập nhật tài khoản", "DELETE": "Xóa tài khoản"},
        "MATERIAL_RECEIPT": {"CREATE": "Nhập phụ liệu", "RECEIPT": "Nhập phụ liệu"},
    }
    if code in ("CREATE", "UPDATE", "DELETE", "CLOSE", "PAYMENT", "SETTLE"):
        label = entity_actions.get(entity_code, {}).get(code)
        if label:
            return label
    if code in ACTION_LABELS:
        return ACTION_LABELS[code]
    if code.endswith("_SETTLE"):
        if "CUTTING" in code or "CUTTING" in entity_code:
            return "Chốt thanh toán thợ cắt"
        if "PRINT" in code or "EMBROIDERY" in code:
            return "Chốt thanh toán phụ liệu"
        return "Chốt thanh toán nhà may" if module_code == "PRODUCTION" else "Chốt thanh toán"
    if code.endswith("_PAYMENT"):
        return "Thanh toán phụ liệu" if module_code == "MATERIALS" else "Tạo thanh toán"
    if code == "TRANSACTION" and module_code == "MATERIALS":
        return "Ghi nhận giao dịch phụ liệu"
    return "Thao tác khác"


def audit_reference(snapshot) -> str | None:
    if isinstance(snapshot, dict):
        for key in REFERENCE_KEYS:
            value = snapshot.get(key)
            if value is not None and str(value).strip():
                return str(value).strip()
    return None


def _audit_amount(snapshot) -> str | None:
    if isinstance(snapshot, dict):
        for key in AMOUNT_KEYS:
            value = snapshot.get(key)
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                return f"{value:,.0f}".replace(",", ".") + "đ"
    return None


def audit_description(actor_name: str | None, action_label: str, entity_label: str,
                      entity_code: str | None, before, after) -> str:
    actor = (actor_name or "").strip()
    if not actor:
        return f"Thao tác hệ thống: {action_label}."
    if action_label == "Điều chỉnh công nợ khách" and isinstance(before, dict) and isinstance(after, dict):
        old_balance = before.get("balance")
        new_balance = after.get("balance")
        if isinstance(old_balance, (int, float)) and isinstance(new_balance, (int, float)):
            delta = new_balance - old_balance
            related_name = next((
                after[key].strip() for key in DISPLAY_NAME_KEYS
                if isinstance(after.get(key), str) and after[key].strip()
            ), "")
            related = f" {related_name}" if related_name else ""
            formatted_delta = f"{abs(delta):,.0f}".replace(",", ".")
            sign = "+" if delta > 0 else "-" if delta < 0 else ""
            return f"{actor} đã {action_label.casefold()}{related}: {sign}{formatted_delta}đ."
    snapshot = after or before
    if isinstance(snapshot, dict):
        for key in DISPLAY_NAME_KEYS:
            related_name = snapshot.get(key)
            if isinstance(related_name, str) and related_name.strip():
                suffix = f" cho {related_name.strip()}"
                amount = _audit_amount(snapshot)
                if amount:
                    suffix += f": {amount}"
                return f"{actor} đã {action_label.casefold()}{suffix}."
    suffix = f" {entity_code}" if entity_code else ""
    amount = _audit_amount(snapshot)
    if amount:
        suffix += f": {amount}"
    return f"{actor} đã {action_label.casefold()} {entity_label}{suffix}."


@router.get("/reports/overview")
def reports_overview(
    from_date: date | None = None,
    to_date: date | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    first, last, start_at, end_at = report_period(from_date, to_date)
    metrics = order_metrics(db, date_from=first, date_to=last)
    total_orders = metrics["total"]
    new_orders = metrics["new"]
    picking_orders = metrics["picking"]
    picked_orders = metrics["picked"]
    invoice_pending = metrics["invoice_pending"]
    debt_orders = metrics["debt"]
    cancelled_orders = metrics["cancelled"]
    invoice_revenue = int(db.scalar(
        select(func.coalesce(func.sum(Invoice.subtotal_amount + Invoice.surcharge_amount), 0))
        .where(
            Invoice.issued_at >= start_at,
            Invoice.issued_at < end_at,
            Invoice.status.in_(INVOICE_REVENUE_STATUSES),
        )
    ) or 0)
    payment_rows = list(db.scalars(select(Payment).where(
        Payment.paid_at >= start_at,
        Payment.paid_at < end_at,
        Payment.status == "POSTED",
    )))
    money_in = sum(row.amount for row in payment_rows if row.direction == "RECEIPT")
    money_out = sum(row.amount for row in payment_rows if row.direction != "RECEIPT")
    roles, _ = access_for_user(db, user)
    financial_available = bool({"OWNER", "ADMIN", "KE_TOAN"} & set(roles))

    if financial_available:
        debt_rows = db.execute(
            select(DebtLedgerEntry.party_type, DebtLedgerEntry.party_id, func.sum(DebtLedgerEntry.amount_delta))
            .group_by(DebtLedgerEntry.party_type, DebtLedgerEntry.party_id)
        ).all()
        total_debt = sum(max(0, int(balance)) for _, _, balance in debt_rows)
        cashflow = {
            "available": True,
            "invoice_revenue": invoice_revenue,
            "money_in": money_in,
            "money_out": money_out,
            "net_cashflow": money_in - money_out,
            "total_debt": total_debt,
        }
    else:
        cashflow = {
            "available": False,
            "invoice_revenue": None,
            "money_in": None,
            "money_out": None,
            "net_cashflow": None,
            "total_debt": None,
        }

    return {"data": {
        "period": {"from_date": first.isoformat(), "to_date": last.isoformat()},
        "cashflow": cashflow,
        "orders": {
            "total_orders": total_orders,
            "new_orders": new_orders,
            "picking_orders": picking_orders,
            "picked_orders": picked_orders,
            "invoice_pending": invoice_pending,
            "debt_orders": debt_orders,
            "cancelled_orders": cancelled_orders,
        },
    }}


@router.get("/reports/action-items")
def report_action_items(
    from_date: date | None = None,
    to_date: date | None = None,
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    _=Depends(current_user),
):
    first, last, _, _ = report_period(from_date, to_date)
    pending_invoice = (
        ~select(InvoiceOrder.id).where(InvoiceOrder.order_id == Order.id).exists()
    )
    orders = list(db.scalars(
        select(Order)
        .where(
            Order.created_date.between(first, last),
            Order.status.in_(PICKED_STATUSES),
            Order.billing_status.in_(("DRAFT", "READY")),
            pending_invoice,
        )
        .order_by(Order.created_date.desc(), Order.created_at.desc())
        .limit(limit)
    ).unique())
    items = [{
        "id": str(order.id),
        "type": "INVOICE_NOT_SENT",
        "severity": "ACTION_REQUIRED",
        "reference": order.order_no,
        "entity_id": str(order.id),
        "customer_name": order.customer.name,
        "description": "Đơn đã soạn/gửi nhưng chưa có hóa đơn.",
        "occurred_at": order.created_date.isoformat(),
        "target": "orders",
    } for order in orders]
    return {"data": {"count": len(items), "items": items}}


def period(date_from: date | None, date_to: date | None) -> tuple[datetime, datetime]:
    first = date_from or date.today().replace(day=1); last = date_to or date.today()
    if first > last: raise ApiError(422, "DATE_RANGE_INVALID", "Khoảng ngày không hợp lệ.")
    return datetime.combine(first, time.min, tzinfo=timezone.utc), datetime.combine(last, time.max, tzinfo=timezone.utc)


@router.get("/reports/cash-flow")
def cash_flow(date_from: date | None = None, date_to: date | None = None,
              db: Session = Depends(get_db), _=Depends(current_user)):
    start, end = period(date_from, date_to)
    rows = list(db.scalars(select(Payment).where(Payment.paid_at.between(start, end), Payment.status == "POSTED").order_by(Payment.paid_at)))
    incoming = sum(row.amount for row in rows if row.direction == "RECEIPT")
    outgoing = sum(row.amount for row in rows if row.direction != "RECEIPT")
    grouped: dict[str, dict] = {}
    for row in rows:
        key = row.paid_at.date().isoformat(); item = grouped.setdefault(key, {"date": key, "incoming": 0, "outgoing": 0})
        item["incoming" if row.direction == "RECEIPT" else "outgoing"] += row.amount
    return {"data": {"date_from": start.date().isoformat(), "date_to": end.date().isoformat(),
                     "incoming": incoming, "outgoing": outgoing, "net": incoming - outgoing,
                     "series": list(grouped.values())}}


@router.get("/reports/revenue")
def revenue(date_from: date | None = None, date_to: date | None = None,
            db: Session = Depends(get_db), _=Depends(current_user)):
    start, end = period(date_from, date_to)
    rows = list(db.scalars(select(Invoice).where(Invoice.issued_at.between(start, end), Invoice.status != "VOID").order_by(Invoice.issued_at)))
    grouped: dict[str, int] = {}
    for row in rows: grouped[row.issued_at.date().isoformat()] = grouped.get(row.issued_at.date().isoformat(), 0) + row.subtotal_amount + row.surcharge_amount
    return {"data": {"date_from": start.date().isoformat(), "date_to": end.date().isoformat(),
                     "invoice_count": len(rows), "revenue_amount": sum(grouped.values()),
                     "paid_amount": sum(row.paid_amount for row in rows), "balance_amount": sum(row.balance_amount for row in rows),
                     "series": [{"date": key, "amount": value} for key, value in grouped.items()]}}


@router.get("/reports/customers")
def customers(sort: str = "debt_desc", db: Session = Depends(get_db), _=Depends(current_user)):
    rows = []
    for customer in db.scalars(select(Customer).order_by(Customer.name)):
        debt = int(db.scalar(select(func.coalesce(func.sum(DebtLedgerEntry.amount_delta), 0)).where(
            DebtLedgerEntry.party_type == "CUSTOMER", DebtLedgerEntry.party_id == customer.id)) or 0)
        order_count = int(db.scalar(select(func.count(Order.id)).where(Order.customer_id == customer.id)) or 0)
        revenue_amount = int(db.scalar(select(func.coalesce(func.sum(Invoice.subtotal_amount + Invoice.surcharge_amount), 0)).where(
            Invoice.customer_id == customer.id, Invoice.status != "VOID")) or 0)
        rows.append({"customer_id": str(customer.id), "customer_code": customer.customer_code, "name": customer.name,
                     "order_count": order_count, "revenue_amount": revenue_amount, "debt_amount": debt})
    rows.sort(key=(lambda row: row["name"].casefold()) if sort == "name_asc" else (lambda row: -row["debt_amount"]))
    return {"data": rows}


@router.get("/reports/picker-performance")
def picker_performance(month: str | None = None, warehouse_id: uuid.UUID | None = None,
                       db: Session = Depends(get_db), _=Depends(require_permission("reports.picker"))):
    now = datetime.now(timezone.utc)
    try: year, mon = map(int, month.split("-")) if month else (now.year, now.month)
    except ValueError as exc: raise ApiError(422, "MONTH_INVALID", "Tháng phải có dạng YYYY-MM.") from exc
    start = datetime(year, mon, 1, tzinfo=timezone.utc); end = datetime(year + (mon == 12), mon % 12 + 1, 1, tzinfo=timezone.utc)
    stmt = select(Order).where(Order.claimed_by.is_not(None))
    if warehouse_id: stmt = stmt.where(Order.warehouse_id == warehouse_id)
    grouped: dict[str, dict] = {}
    for order in db.scalars(stmt).unique():
        picked = bool(order.picked_at and start <= (order.picked_at if order.picked_at.tzinfo else order.picked_at.replace(tzinfo=timezone.utc)) < end)
        picking = bool(order.status == "PICKING" and start <= (order.updated_at if order.updated_at.tzinfo else order.updated_at.replace(tzinfo=timezone.utc)) < end)
        if not (picked or picking): continue
        item = grouped.setdefault(str(order.claimed_by), {"user_id": str(order.claimed_by), "name": order.claimer.display_name,
            "picked": 0, "picking": 0, "by_warehouse": {}, "orders": []})
        item["picked" if picked else "picking"] += 1; item["by_warehouse"][order.warehouse.name] = item["by_warehouse"].get(order.warehouse.name, 0) + 1
        item["orders"].append(order_to_dict(order))
    values = sorted(grouped.values(), key=lambda row: -(row["picked"] + row["picking"]))
    return {"data": {"month": f"{year:04d}-{mon:02d}", "total": sum(row["picked"] + row["picking"] for row in values),
                     "picked": sum(row["picked"] for row in values), "picking": sum(row["picking"] for row in values), "pickers": values}}


@router.get("/reports/data-warnings")
def data_warnings(db: Session = Depends(get_db), _=Depends(current_user)):
    warnings = []
    for row in db.scalars(select(InventoryBalance)):
        if row.available != row.on_hand - row.reserved:
            warnings.append({"type": "INVENTORY_BALANCE", "severity": "CRITICAL", "entity_id": str(row.id),
                             "message": "available khác on_hand - reserved"})
    for projection in db.scalars(select(PartyDebtBalance)):
        actual = int(db.scalar(select(func.coalesce(func.sum(DebtLedgerEntry.amount_delta), 0)).where(
            DebtLedgerEntry.party_type == projection.party_type, DebtLedgerEntry.party_id == projection.party_id)) or 0)
        if projection.current != actual:
            warnings.append({"type": "DEBT_PROJECTION", "severity": "CRITICAL", "entity_id": str(projection.id),
                             "message": f"projection {projection.current} khác ledger {actual}"})
    return {"data": {"count": len(warnings), "critical_count": sum(row["severity"] == "CRITICAL" for row in warnings), "issues": warnings}}


@router.get("/trace/orders/{order_id}")
def trace_order(order_id: uuid.UUID, db: Session = Depends(get_db), _=Depends(current_user)):
    order = db.get(Order, order_id)
    if not order: raise ApiError(404, "ORDER_NOT_FOUND", "Không tìm thấy đơn.")
    events = list(db.scalars(select(OrderStatusEvent).where(OrderStatusEvent.order_id == order_id).order_by(OrderStatusEvent.occurred_at)))
    invoice_links = list(db.execute(select(InvoiceOrder, Invoice).join(Invoice, Invoice.id == InvoiceOrder.invoice_id).where(InvoiceOrder.order_id == order_id)))
    audits = list(db.scalars(select(AuditLog).where(AuditLog.entity_id == order_id).order_by(AuditLog.occurred_at)))
    timeline = ([{"at": row.occurred_at.isoformat(), "type": "ORDER_STATUS", "label": row.to_status, "detail": row.reason} for row in events] +
                [{"at": invoice.issued_at.isoformat(), "type": "INVOICE", "label": invoice.invoice_no, "detail": invoice.status} for _, invoice in invoice_links] +
                [{"at": row.occurred_at.isoformat(), "type": "AUDIT", "label": row.action, "detail": row.module} for row in audits])
    timeline.sort(key=lambda row: row["at"])
    return {"data": {"order": order_to_dict(order), "timeline": timeline}}


@router.get("/audit-logs")
def audit_logs(actor_user_id: uuid.UUID | None = None, module: str | None = None, action: str | None = None,
               entity_type: str | None = None, from_date: date | None = None, to_date: date | None = None,
               q: str | None = None, limit: int = Query(100, ge=1, le=500),
               db: Session = Depends(get_db), _=Depends(require_permission("reports.audit"))):
    stmt = select(AuditLog, User.display_name).outerjoin(User, User.id == AuditLog.actor_user_id)
    if from_date is not None or to_date is not None:
        _, _, start_at, end_at = report_period(from_date, to_date)
        stmt = stmt.where(AuditLog.occurred_at >= start_at, AuditLog.occurred_at < end_at)
    stmt = stmt.order_by(AuditLog.occurred_at.desc()).limit(limit)
    if actor_user_id: stmt = stmt.where(AuditLog.actor_user_id == actor_user_id)
    if module:
        module_code = _audit_code(module)
        module_aliases = MODULE_FILTER_ALIASES.get(module_code, (module_code,))
        module_condition = AuditLog.module.in_(module_aliases)
        if module_code in MODULE_FILTER_ALIASES:
            module_condition = or_(module_condition, AuditLog.entity_type == module_code)
        stmt = stmt.where(module_condition)
    if action:
        action_code = _audit_code(action)
        if action_code == "PAYMENT":
            stmt = stmt.where(or_(
                AuditLog.action == "PAYMENT",
                (AuditLog.action == "CREATE") & (AuditLog.entity_type == "PAYMENT"),
            ))
        elif action_code == "RECEIPT":
            stmt = stmt.where(AuditLog.action.in_(("RECEIPT", "RECEIPT_POST", "IMPORT_STOCK")))
        else:
            stmt = stmt.where(AuditLog.action == action_code)
    if entity_type: stmt = stmt.where(AuditLog.entity_type == entity_type)
    if q and q.strip():
        search = f"%{q.strip()}%"
        stmt = stmt.where(or_(
            AuditLog.action.ilike(search),
            AuditLog.module.ilike(search),
            AuditLog.entity_type.ilike(search),
            cast(AuditLog.entity_id, String).ilike(search),
            AuditLog.request_id.ilike(search),
            User.display_name.ilike(search),
            cast(AuditLog.before_data, String).ilike(search),
            cast(AuditLog.after_data, String).ilike(search),
        ))
    stmt = stmt.limit(limit)
    rows = list(db.execute(stmt))
    return {"data": [audit_log_data(row, actor_name) for row, actor_name in rows]}


@router.get("/audit-logs/{audit_id}")
def audit_log_detail(
    audit_id: uuid.UUID,
    db: Session = Depends(get_db),
    _=Depends(require_permission("reports.audit")),
):
    row = db.get(AuditLog, audit_id)
    if not row:
        raise ApiError(404, "AUDIT_LOG_NOT_FOUND", "Không tìm thấy nhật ký thao tác.")
    actor = db.get(User, row.actor_user_id) if row.actor_user_id else None
    return {"data": audit_log_data(row, actor.display_name if actor else None)}
