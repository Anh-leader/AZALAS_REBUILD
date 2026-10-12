import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.errors import ApiError
from ..models import AuditLog, Order, OrderStatusEvent, User
from .orders import order_to_dict

TRANSITIONS = {
    ("PICKED", "START_SHIPPING"): "SHIPPING",
    ("SHIPPING", "COMPLETE"): "COMPLETED",
    ("SHIPPING", "RETURN"): "RETURNED",
}
QUEUE_STATUS = {"WAITING": "PICKED", "SHIPPING": "SHIPPING", "COMPLETED": "COMPLETED", "RETURNED": "RETURNED"}


def work_queue(db: Session, *, tab: str, q: str | None = None) -> list[dict]:
    if tab not in QUEUE_STATUS:
        raise ApiError(422, "INVALID_SHIPMENT_TAB", "Tab vận chuyển không hợp lệ.")
    rows = list(db.scalars(select(Order).where(Order.status == QUEUE_STATUS[tab]).order_by(
        Order.is_urgent.desc(), Order.delivery_date, Order.created_at
    )).unique())
    needle = (q or "").strip().casefold()
    if needle:
        rows = [row for row in rows if needle in row.order_no.casefold() or needle in row.customer.name.casefold()]
    return [order_to_dict(row) for row in rows]


def transition(db: Session, *, order_id: uuid.UUID, event: str, version: int, note: str | None, user: User) -> dict:
    order = db.scalar(select(Order).where(Order.id == order_id).with_for_update(of=Order))
    if not order:
        raise ApiError(404, "ORDER_NOT_FOUND", "Không tìm thấy đơn hàng.")
    if order.version != version:
        raise ApiError(409, "VERSION_CONFLICT", "Đơn đã thay đổi, vui lòng tải lại.", {"current_version": order.version})
    target = TRANSITIONS.get((order.status, event.upper()))
    if not target:
        raise ApiError(409, "INVALID_SHIPPING_TRANSITION", "Không thể thực hiện bước vận chuyển này.",
                       {"status": order.status, "event": event})
    before = {"status": order.status, "billing_status": order.billing_status, "version": order.version}
    old = order.status
    order.status = target
    order.version += 1
    db.add(OrderStatusEvent(order_id=order.id, from_status=old, to_status=target,
                            actor_user_id=user.id, reason=(note or "").strip() or event.upper()))
    db.add(AuditLog(module="SHIPPING", entity_type="ORDER", entity_id=order.id,
                    action=event.upper(), actor_user_id=user.id, before_data=before,
                    after_data={"status": target, "billing_status": order.billing_status,
                                "version": order.version}))
    db.commit()
    return order_to_dict(order)
