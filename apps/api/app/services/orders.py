import random
import uuid
from datetime import date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.errors import ApiError
from ..core.text import fold
from ..models import AuditLog, Customer, MediaObject, Order, OrderGroup, OrderMedia, OrderStatusEvent, User, Warehouse
from .storage import media_view_url

TZ = ZoneInfo("Asia/Ho_Chi_Minh")

WAREHOUSE_MODES = {"TAN_XUAN", "CA_KOI", "BOTH", "CUSTOMER_ORDER"}

# Tab "Chi tiết đơn" -> điều kiện lọc (giữ đúng hành vi app cũ)
TABS = {
    "NEW": {"status": "NEW", "order_type": "NORMAL"},
    "PICKING": {"status": "PICKING", "order_type": None},
    "DEBT": {"status": "DEBT_ORDER", "order_type": None},
    "CUSTOMER_ORDER": {"status": "NEW", "order_type": "CUSTOMER_ORDER"},
}


def generate_order_no(now: datetime | None = None) -> str:
    """Format cũ: HD + yyMMddHHmmss + 1 chữ số ngẫu nhiên (vd HD2610081530127)."""
    now = now or datetime.now(TZ)
    return f"HD{now:%y%m%d%H%M%S}{random.randint(0, 9)}"


def _unique_order_no(db: Session) -> str:
    for _ in range(20):
        no = generate_order_no()
        taken = db.scalar(
            select(Order.id).where(Order.order_no.in_([no, f"{no}-TX", f"{no}-CK"]))
        )
        if not taken:
            return no
    raise ApiError(409, "ORDER_NO_CONFLICT", "Không sinh được mã đơn, thử lại.")


def _warehouses(db: Session) -> dict[str, Warehouse]:
    return {w.code: w for w in db.scalars(select(Warehouse))}


def create_order(
    db: Session,
    *,
    user: User,
    customer_id: uuid.UUID,
    warehouse_mode: str,
    created_date: date,
    delivery_date: date | None,
    is_urgent: bool,
    customer_note: str | None,
    media_ids: list[uuid.UUID],
    idempotency_key: str | None,
) -> list[Order]:
    if idempotency_key:
        existing = list(
            db.scalars(
                select(Order).where(Order.idempotency_key == idempotency_key).order_by(Order.order_no)
            )
        )
        if existing:
            return existing

    orders = _create_order_rows(
        db,
        user=user,
        customer_id=customer_id,
        warehouse_mode=warehouse_mode,
        created_date=created_date,
        delivery_date=delivery_date,
        is_urgent=is_urgent,
        customer_note=customer_note,
        media_ids=media_ids,
        idempotency_key=idempotency_key,
        status_reason="Tạo đơn",
    )
    db.commit()
    for order in orders:
        db.refresh(order)
    return orders


def _create_order_rows(
    db,
    *,
    user: User,
    customer_id: uuid.UUID,
    warehouse_mode: str,
    created_date: date,
    delivery_date: date | None,
    is_urgent: bool,
    customer_note: str | None,
    media_ids: list[uuid.UUID],
    idempotency_key: str | None,
    status_reason: str,
    audit_create: bool = False,
) -> list[Order]:
    if warehouse_mode not in WAREHOUSE_MODES:
        raise ApiError(422, "INVALID_WAREHOUSE_MODE", "Loại đơn không hợp lệ.")
    customer = db.get(Customer, customer_id)
    if not customer or customer.deleted_at:
        raise ApiError(422, "CUSTOMER_NOT_FOUND", "Bạn vui lòng chọn khách có trong danh sách!")
    if delivery_date and delivery_date < created_date:
        raise ApiError(422, "INVALID_DELIVERY_DATE", "Ngày giao không được trước ngày tạo.")

    media = list(db.scalars(select(MediaObject).where(MediaObject.id.in_(media_ids)))) if media_ids else []
    if len(media) != len(set(media_ids)):
        raise ApiError(422, "MEDIA_NOT_FOUND", "Ảnh đính kèm không hợp lệ.")

    wh = _warehouses(db)
    if warehouse_mode == "BOTH" and not {"TAN_XUAN", "CA_KOI"}.issubset(wh):
        raise ApiError(422, "WAREHOUSE_NOT_FOUND", "Không tìm thấy đủ hai kho để tạo đơn.")
    if warehouse_mode != "BOTH":
        warehouse_code = "CA_KOI" if warehouse_mode == "CA_KOI" else "TAN_XUAN"
        if warehouse_code not in wh:
            raise ApiError(422, "WAREHOUSE_NOT_FOUND", "Không tìm thấy kho được chọn.")
    base_no = _unique_order_no(db)
    note = (customer_note or "").strip() or None

    if warehouse_mode == "BOTH":
        group = OrderGroup(group_no=base_no, customer_id=customer.id)
        db.add(group)
        db.flush()
        parts = [
            (f"{base_no}-TX", wh["TAN_XUAN"], " (Phần kho Tân Xuân)", group.id),
            (f"{base_no}-CK", wh["CA_KOI"], " (Phần kho Cá Koi)", group.id),
        ]
    else:
        target = wh["CA_KOI"] if warehouse_mode == "CA_KOI" else wh["TAN_XUAN"]
        parts = [(base_no, target, "", None)]

    orders: list[Order] = []
    for order_no, warehouse, suffix, group_id in parts:
        order = Order(
            order_no=order_no,
            order_group_id=group_id,
            customer_id=customer.id,
            warehouse_id=warehouse.id,
            order_type="CUSTOMER_ORDER" if warehouse_mode == "CUSTOMER_ORDER" else "NORMAL",
            created_date=created_date,
            delivery_date=delivery_date,
            is_urgent=is_urgent,
            customer_note=(note + suffix) if note and suffix else note,
            status="NEW",
            created_by=user.id,
            idempotency_key=idempotency_key,
        )
        db.add(order)
        db.flush()
        db.add(OrderStatusEvent(order_id=order.id, to_status="NEW", actor_user_id=user.id, reason=status_reason))
        for m in media:
            db.add(OrderMedia(order_id=order.id, media_id=m.id))
        if audit_create:
            db.add(AuditLog(
                entity_type="ORDER",
                entity_id=order.id,
                action="CREATE",
                module="SALES",
                actor_user_id=user.id,
                after_data={
                    "order_no": order.order_no,
                    "customer_id": str(customer.id),
                    "customer_name": customer.name,
                    "created_via": "BULK",
                },
            ))
        orders.append(order)
    return orders


def create_orders_bulk(
    db,
    *,
    user: User,
    warehouse_mode: str,
    created_date: date,
    delivery_date: date | None,
    is_urgent: bool,
    common_note: str | None,
    customers: list[dict],
    idempotency_key: str,
) -> list[dict]:
    if not idempotency_key or len(idempotency_key) > 70:
        raise ApiError(422, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key là bắt buộc và tối đa 70 ký tự.")
    if not customers:
        raise ApiError(422, "CUSTOMERS_REQUIRED", "Thêm ít nhất một khách hàng.")
    if len(customers) > 100:
        raise ApiError(422, "CUSTOMER_LIMIT", "Mỗi lần tạo tối đa 100 khách hàng.")
    if warehouse_mode not in WAREHOUSE_MODES:
        raise ApiError(422, "INVALID_WAREHOUSE_MODE", "Loại đơn không hợp lệ.")
    if delivery_date and delivery_date < created_date:
        raise ApiError(422, "INVALID_DELIVERY_DATE", "Ngày giao không được trước ngày tạo.")

    customer_ids = [item["customer_id"] for item in customers]
    if len(customer_ids) != len(set(customer_ids)):
        raise ApiError(422, "DUPLICATE_CUSTOMER", "Không thể thêm trùng khách hàng trong cùng một lần tạo.")
    for index, item in enumerate(customers, start=1):
        if len(item.get("media_ids") or []) > 20:
            raise ApiError(422, "MEDIA_LIMIT", f"Khách ở dòng {index} vượt quá 20 ảnh.")

    keys = [f"{idempotency_key}:{index}" for index in range(len(customers))]
    existing = list(db.scalars(select(Order).where(Order.idempotency_key.in_(keys)).order_by(Order.order_no)))
    expected_order_count = len(customers) * (2 if warehouse_mode == "BOTH" else 1)
    if existing:
        expected_warehouse_codes = {
            "TAN_XUAN": {"TAN_XUAN"},
            "CA_KOI": {"CA_KOI"},
            "CUSTOMER_ORDER": {"TAN_XUAN"},
            "BOTH": {"TAN_XUAN", "CA_KOI"},
        }[warehouse_mode]
        expected_customers = set(customer_ids)
        existing_customers = {order.customer_id for order in existing}
        existing_by_key: dict[str, list[Order]] = {}
        for order in existing:
            existing_by_key.setdefault(order.idempotency_key or "", []).append(order)
        complete_per_customer = all(
            len(existing_by_key.get(key, [])) == (2 if warehouse_mode == "BOTH" else 1)
            and {order.warehouse.code for order in existing_by_key.get(key, [])} == expected_warehouse_codes
            and len({order.customer_id for order in existing_by_key.get(key, [])}) == 1
            and next(iter({order.customer_id for order in existing_by_key.get(key, [])}), None) == customers[index]["customer_id"]
            for index, key in enumerate(keys)
        )
        if (len(existing) != expected_order_count or existing_customers != expected_customers
                or not complete_per_customer):
            raise ApiError(409, "BULK_IDEMPOTENCY_CONFLICT", "Yêu cầu tạo đơn trước chưa hoàn tất; không thể phát lại an toàn.")
        return [{
            "customer_id": str(order.customer_id),
            "customer_name": order.customer.name,
            "order_id": str(order.id),
            "order_no": order.order_no,
            "warehouse": order.warehouse.name,
            "warehouse_code": order.warehouse.code,
        } for order in existing]

    warehouses = _warehouses(db)
    required_codes = {"TAN_XUAN", "CA_KOI"} if warehouse_mode == "BOTH" else {
        "CA_KOI" if warehouse_mode == "CA_KOI" else "TAN_XUAN"
    }
    if not required_codes.issubset(warehouses):
        raise ApiError(422, "WAREHOUSE_NOT_FOUND", "Không tìm thấy kho được chọn.")

    # Validate every row's customer and media before writing the first order.
    normalized_rows = []
    for index, item in enumerate(customers, start=1):
        customer = db.get(Customer, item["customer_id"])
        if not customer or customer.deleted_at:
            raise ApiError(422, "CUSTOMER_NOT_FOUND", f"Khách hàng ở dòng {index} không tồn tại hoặc đã ngừng sử dụng.")
        media_ids = item.get("media_ids") or []
        media = list(db.scalars(select(MediaObject).where(MediaObject.id.in_(media_ids)))) if media_ids else []
        if len(media) != len(set(media_ids)):
            raise ApiError(422, "MEDIA_NOT_FOUND", f"Ảnh đính kèm ở dòng {index} không hợp lệ.")
        row_note = (item.get("note") or "").strip()
        combined_note = "\n".join(part for part in ((common_note or "").strip(), row_note) if part) or None
        normalized_rows.append((customer, media_ids, combined_note))

    created = []
    try:
        for index, (item, (customer, media_ids, note)) in enumerate(zip(customers, normalized_rows), start=1):
            orders = _create_order_rows(
                db,
                user=user,
                customer_id=customer.id,
                warehouse_mode=warehouse_mode,
                created_date=created_date,
                delivery_date=delivery_date,
                is_urgent=is_urgent,
                customer_note=note,
                media_ids=media_ids,
                idempotency_key=keys[index - 1],
                status_reason="Tạo đơn nhiều khách",
                audit_create=True,
            )
            created.extend({
                "customer_id": str(customer.id),
                "customer_name": customer.name,
                "order_id": str(order.id),
                "order_no": order.order_no,
                "warehouse": order.warehouse.name,
                "warehouse_code": order.warehouse.code,
            } for order in orders)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return created


def _queue_query(tab: str, user: User):
    if tab not in TABS:
        raise ApiError(422, "INVALID_TAB", "Tab không hợp lệ.")
    rule = TABS[tab]
    stmt = select(Order).where(Order.status == rule["status"])
    if rule["order_type"]:
        stmt = stmt.where(Order.order_type == rule["order_type"])
    # App cũ: nhân viên thường chỉ thấy đơn mình đang soạn
    if tab == "PICKING" and user.role not in ("OWNER", "ADMIN"):
        stmt = stmt.where(Order.claimed_by == user.id)
    return stmt


def _matches(order: Order, q: str) -> bool:
    return not q or q in fold(order.order_no) or q in fold(order.customer.name)


def _sort_key(o: Order):
    # Đơn gấp lên đầu, rồi ngày giao gần nhất
    return (not o.is_urgent, o.delivery_date or date.max, o.created_at)


def work_queue(db: Session, *, tab: str, q: str | None, user: User) -> list[dict]:
    qf = fold(q)
    orders = [o for o in db.scalars(_queue_query(tab, user)).unique() if _matches(o, qf)]
    sections: dict[uuid.UUID, dict] = {}
    for w in db.scalars(select(Warehouse).where(Warehouse.active).order_by(Warehouse.sort_order)):
        sections[w.id] = {"warehouse": {"id": str(w.id), "code": w.code, "name": w.name}, "order_count": 0, "_c": {}}
    for o in sorted(orders, key=_sort_key):
        sec = sections.get(o.warehouse_id)
        if not sec:
            continue
        sec["order_count"] += 1
        # Gom theo customer_id, KHÔNG theo tên
        grp = sec["_c"].setdefault(
            o.customer_id,
            {"customer_id": str(o.customer_id), "customer_name": o.customer.name, "order_count": 0, "has_urgent": False},
        )
        grp["order_count"] += 1
        grp["has_urgent"] = grp["has_urgent"] or o.is_urgent
    result = []
    for sec in sections.values():
        if sec["order_count"]:
            sec["customers"] = list(sec.pop("_c").values())
            result.append(sec)
    return result


def order_to_dict(o: Order) -> dict:
    return {
        "id": str(o.id),
        "order_no": o.order_no,
        "order_group_id": str(o.order_group_id) if o.order_group_id else None,
        "customer_id": str(o.customer_id),
        "customer_name": o.customer.name,
        "warehouse": {"id": str(o.warehouse.id), "code": o.warehouse.code, "name": o.warehouse.name},
        "order_type": o.order_type,
        "created_date": o.created_date.isoformat(),
        "delivery_date": o.delivery_date.isoformat() if o.delivery_date else None,
        "is_urgent": o.is_urgent,
        "customer_note": o.customer_note,
        "staff_note": o.staff_note,
        "status": o.status,
        "claimed_by_name": o.claimer.display_name if o.claimer else None,
        "picked_at": o.picked_at.isoformat() if o.picked_at else None,
        "total_amount": o.total_amount,
        "billing_status": o.billing_status,
        "paid_amount": o.paid_amount,
        "invoice_balance_amount": o.invoice_balance_amount,
        "version": o.version,
        "created_at": o.created_at.isoformat() if o.created_at else None,
        "images": [{
            "id": str(m.id),
            "original_name": m.original_name,
            "content_type": m.content_type,
            "url": media_view_url(m.id),
            "view_url": media_view_url(m.id),
        } for m in o.media],
    }


def customer_orders(
    db: Session, *, customer_id: uuid.UUID, warehouse_id: uuid.UUID, tab: str, user: User
) -> dict:
    customer = db.get(Customer, customer_id)
    warehouse = db.get(Warehouse, warehouse_id)
    if not customer or not warehouse:
        raise ApiError(404, "NOT_FOUND", "Không tìm thấy khách hoặc kho.")
    stmt = _queue_query(tab, user).where(Order.customer_id == customer_id, Order.warehouse_id == warehouse_id)
    orders = sorted(db.scalars(stmt).unique(), key=_sort_key)
    return {
        "customer": {"id": str(customer.id), "name": customer.name, "phone": customer.phone},
        "warehouse": {"id": str(warehouse.id), "code": warehouse.code, "name": warehouse.name},
        "orders": [order_to_dict(o) for o in orders],
    }


def claim_order(db: Session, *, order_id: uuid.UUID, user: User) -> Order:
    """Atomically assign a NEW order to a picker.

    `FOR UPDATE` is ignored by SQLite tests but locks the row in PostgreSQL.
    """
    # Relationships are eager-loaded with LEFT JOIN; lock only `orders` so
    # PostgreSQL does not try to lock the nullable side of those joins.
    order = db.scalar(select(Order).where(Order.id == order_id).with_for_update(of=Order))
    if not order:
        raise ApiError(404, "ORDER_NOT_FOUND", "Không tìm thấy đơn hàng.")
    if order.claimed_by and order.claimed_by != user.id:
        raise ApiError(409, "ORDER_ALREADY_CLAIMED", "Đơn đã có người khác nhận.", {"claimed_by": order.claimer.display_name if order.claimer else None})
    if order.status not in ("NEW", "PICKING"):
        raise ApiError(409, "ORDER_NOT_CLAIMABLE", "Đơn không còn ở trạng thái có thể nhận.")
    if order.claimed_by == user.id and order.status == "PICKING":
        return order
    old_status = order.status
    order.claimed_by = user.id
    order.claimed_at = datetime.now(TZ)
    order.status = "PICKING"
    order.version += 1
    db.add(OrderStatusEvent(order_id=order.id, from_status=old_status, to_status="PICKING", actor_user_id=user.id, reason="Nhận đơn để soạn"))
    db.commit()
    db.refresh(order)
    return order
