from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import datetime
from decimal import Decimal, InvalidOperation

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core.errors import ApiError
from ..core.text import fold
from ..models import (
    AuditLog,
    Color,
    InventoryBalance,
    InventoryReservation,
    InventoryReservationLine,
    InventoryTransaction,
    Order,
    OrderItem,
    OrderItemRevision,
    OrderStatusEvent,
    Product,
    ProductVariant,
    User,
    Warehouse,
)
from .orders import TZ, order_to_dict


def _decimal(value) -> Decimal:
    try:
        quantity = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ApiError(422, "INVALID_QUANTITY", "Số lượng không hợp lệ.") from exc
    if not quantity.is_finite() or quantity.as_tuple().exponent < -3:
        raise ApiError(422, "INVALID_QUANTITY", "Số lượng chỉ được có tối đa 3 chữ số thập phân.")
    return quantity


def _number(value: Decimal) -> int | float:
    return int(value) if value == value.to_integral_value() else float(value)


def _item_dict(item: OrderItem) -> dict:
    return {
        "id": str(item.id), "line_no": item.line_no,
        "product_variant_id": str(item.product_variant_id) if item.product_variant_id else None,
        "product_name": item.product_name_snapshot, "sales_code": item.sales_code_snapshot,
        "internal_code": item.internal_code_snapshot, "color": item.color_snapshot,
        "size": item.size_snapshot, "warehouse_id": str(item.warehouse_id),
        "quantity": _number(item.quantity), "unit_price_amount": item.unit_price_amount,
        "line_total_amount": item.line_total_amount, "sale_type": item.sale_type,
        "note": item.notes, "revision_no": item.revision_no,
    }


def _balance_dict(balance: InventoryBalance) -> dict:
    variant = balance.variant
    return {
        "id": str(balance.id), "variant_id": str(balance.variant_id),
        "warehouse": {"id": str(balance.warehouse.id), "code": balance.warehouse.code, "name": balance.warehouse.name},
        "location_id": str(balance.location_id) if balance.location_id else None,
        "on_hand": _number(balance.on_hand), "reserved": _number(balance.reserved),
        "available": _number(balance.on_hand - balance.reserved),
        "pending_finish": _number(balance.pending_finish), "cut_separated": _number(balance.cut_separated),
        "defective": _number(balance.defective), "version": balance.version,
        "internal_code": variant.internal_code, "sales_code": variant.sales_code,
        "size": variant.size, "display_name": variant.display_name,
        "product_code": variant.product.product_code, "pattern_code": variant.product.pattern_code,
        "product_name": variant.product.name,
        "color": variant.color.canonical_name if variant.color else None,
    }


def list_products(db: Session, *, q: str | None = None) -> list[dict]:
    qf = fold(q)
    products = list(db.scalars(select(Product).where(Product.status == "ACTIVE").order_by(Product.name)).unique())
    if qf:
        variant_product_ids = {
            variant.product_id for variant in db.scalars(select(ProductVariant).where(ProductVariant.status == "ACTIVE")).unique()
            if qf in fold(variant.internal_code) or qf in fold(variant.sales_code) or qf in fold(variant.display_name)
            or qf in fold(variant.size) or (variant.color and qf in fold(variant.color.canonical_name))
        }
        products = [p for p in products if p.id in variant_product_ids or any(qf in fold(v) for v in (p.product_code, p.pattern_code, p.name, p.brand))]
    return [{"id": str(p.id), "product_code": p.product_code, "pattern_code": p.pattern_code,
             "brand": p.brand, "name": p.name, "category": p.category, "status": p.status} for p in products[:100]]


def list_variants(db: Session, *, q: str | None = None, warehouse_id: uuid.UUID | None = None) -> list[dict]:
    qf = fold(q)
    balances = list(db.scalars(select(InventoryBalance).order_by(InventoryBalance.id)).unique())
    totals: dict[uuid.UUID, dict] = defaultdict(lambda: {"on_hand": Decimal(0), "reserved": Decimal(0), "available": Decimal(0)})
    for balance in balances:
        if warehouse_id and balance.warehouse_id != warehouse_id:
            continue
        totals[balance.variant_id]["on_hand"] += balance.on_hand
        totals[balance.variant_id]["reserved"] += balance.reserved
        totals[balance.variant_id]["available"] += balance.on_hand - balance.reserved
    rows = []
    for variant in db.scalars(select(ProductVariant).where(ProductVariant.status == "ACTIVE").order_by(ProductVariant.sales_code, ProductVariant.size)).unique():
        color = variant.color.canonical_name if variant.color else None
        haystack = (variant.internal_code, variant.sales_code, variant.display_name, variant.size,
                    variant.product.product_code, variant.product.pattern_code, variant.product.name, color)
        if qf and not any(qf in fold(value) for value in haystack):
            continue
        stock = totals[variant.id]
        rows.append({
            "id": str(variant.id), "product_id": str(variant.product_id),
            "product_code": variant.product.product_code, "pattern_code": variant.product.pattern_code,
            "product_name": variant.product.name, "internal_code": variant.internal_code,
            "sales_code": variant.sales_code, "color": color, "size": variant.size,
            "display_name": variant.display_name,
            **{key: _number(value) for key, value in stock.items()},
        })
    return rows[:200]


def list_balances(db: Session, *, q: str | None = None, warehouse_id: uuid.UUID | None = None) -> list[dict]:
    qf = fold(q)
    stmt = select(InventoryBalance)
    if warehouse_id:
        stmt = stmt.where(InventoryBalance.warehouse_id == warehouse_id)
    result = []
    for balance in db.scalars(stmt.order_by(InventoryBalance.id)).unique():
        row = _balance_dict(balance)
        searchable = (
            row.get("internal_code"), row.get("sales_code"), row.get("pattern_code"),
            row.get("product_name"), row.get("color"), row.get("size"),
            row["warehouse"]["code"], row["warehouse"]["name"],
        )
        if not qf or any(qf in fold(value) for value in searchable):
            result.append(row)
    return result[:500]


def order_detail(db: Session, *, order_id: uuid.UUID) -> dict:
    order = db.get(Order, order_id)
    if not order:
        raise ApiError(404, "ORDER_NOT_FOUND", "Không tìm thấy đơn hàng.")
    items = list(db.scalars(select(OrderItem).where(OrderItem.order_id == order.id, OrderItem.active).order_by(OrderItem.line_no)).unique())
    reservation = db.scalar(select(InventoryReservation).where(InventoryReservation.order_id == order.id))
    reservation_lines = []
    if reservation:
        reservation_lines = list(db.scalars(select(InventoryReservationLine).where(
            InventoryReservationLine.reservation_id == reservation.id,
            InventoryReservationLine.status == "ACTIVE",
        )))
    balance_ids = {(line.variant_id, line.warehouse_id, line.location_id) for line in reservation_lines}
    balances = list(db.scalars(select(InventoryBalance)).unique()) if balance_ids else []
    balances = [b for b in balances if (b.variant_id, b.warehouse_id, b.location_id) in balance_ids]
    history = list(db.scalars(select(OrderStatusEvent).where(OrderStatusEvent.order_id == order.id).order_by(OrderStatusEvent.occurred_at.desc()).limit(30)))
    return {
        "order": order_to_dict(order),
        "customer": {"id": str(order.customer.id), "name": order.customer.name, "phone": order.customer.phone},
        "warehouse": {"id": str(order.warehouse.id), "code": order.warehouse.code, "name": order.warehouse.name},
        "items": [_item_dict(item) for item in items],
        "reservation": None if not reservation else {
            "id": str(reservation.id), "reservation_no": reservation.reservation_no,
            "status": reservation.status, "version": reservation.version,
            "lines": [{"variant_id": str(line.variant_id), "warehouse_id": str(line.warehouse_id),
                       "location_id": str(line.location_id) if line.location_id else None,
                       "quantity": _number(line.quantity)} for line in reservation_lines],
        },
        "inventory": [_balance_dict(balance) for balance in balances],
        "history": [{"from_status": e.from_status, "to_status": e.to_status, "reason": e.reason,
                     "occurred_at": e.occurred_at.isoformat()} for e in history],
    }


def save_pick(db: Session, *, order_id: uuid.UUID, user: User, items: list[dict], staff_note: str | None, version: int) -> dict:
    order = db.scalar(select(Order).where(Order.id == order_id).with_for_update(of=Order))
    if not order:
        raise ApiError(404, "ORDER_NOT_FOUND", "Không tìm thấy đơn hàng.")
    if order.version != version:
        raise ApiError(409, "VERSION_CONFLICT", "Đơn đã thay đổi, vui lòng tải lại.", {"current_version": order.version})
    if order.claimed_by != user.id and user.role not in ("OWNER", "ADMIN"):
        raise ApiError(403, "ORDER_NOT_ASSIGNEE", "Chỉ người đang soạn mới được lưu đơn.")
    if order.status not in ("PICKING", "PICKED"):
        raise ApiError(409, "ORDER_NOT_PICKING", "Đơn không ở trạng thái có thể soạn.")
    old_status = order.status
    old_billing_status = order.billing_status
    if old_billing_status not in ("DRAFT", "READY"):
        raise ApiError(409, "ORDER_BILLING_LOCKED", "Đơn đã gửi hóa đơn hoặc không còn ở trạng thái chờ hóa đơn.")

    valid = []
    for raw in items:
        name = str(raw.get("product_name") or "").strip()
        quantity = _decimal(raw.get("quantity", 0))
        if not name or quantity <= 0:
            continue
        warehouse_id = raw.get("warehouse_id")
        if warehouse_id != order.warehouse_id:
            raise ApiError(422, "WAREHOUSE_MISMATCH", "Kho xuất của dòng phải trùng kho của đơn.")
        unit_price = int(raw.get("unit_price_amount") or 0)
        if unit_price < 0:
            raise ApiError(422, "INVALID_PRICE", "Đơn giá không được âm.")
        total = quantity * unit_price
        if total != total.to_integral_value():
            raise ApiError(422, "MONEY_FRACTION", "Thành tiền phải là số VND nguyên.")
        valid.append({**raw, "product_name": name, "quantity": quantity,
                      "unit_price_amount": unit_price, "line_total_amount": int(total)})
    if not valid:
        raise ApiError(422, "PICK_ITEMS_REQUIRED", "Không có dòng sản phẩm hợp lệ để lưu.")

    variant_ids = {row["product_variant_id"] for row in valid if row.get("product_variant_id")}
    variants = {v.id: v for v in db.scalars(select(ProductVariant).where(ProductVariant.id.in_(variant_ids))).unique()} if variant_ids else {}
    if len(variants) != len(variant_ids):
        raise ApiError(422, "VARIANT_NOT_FOUND", "Có biến thể sản phẩm không tồn tại.")

    old_items = list(db.scalars(select(OrderItem).where(OrderItem.order_id == order.id, OrderItem.active).order_by(OrderItem.line_no)).unique())
    reservation = db.scalar(select(InventoryReservation).where(InventoryReservation.order_id == order.id))
    old_lines = list(db.scalars(select(InventoryReservationLine).where(
        InventoryReservationLine.reservation_id == reservation.id,
        InventoryReservationLine.status == "ACTIVE",
    ))) if reservation else []

    relevant_variants = variant_ids | {line.variant_id for line in old_lines}
    balances = list(db.scalars(
        select(InventoryBalance).where(
            InventoryBalance.variant_id.in_(relevant_variants),
            InventoryBalance.warehouse_id == order.warehouse_id,
        ).order_by(InventoryBalance.id).with_for_update(of=InventoryBalance)
    ).unique()) if relevant_variants else []
    balance_by_scope = {(b.variant_id, b.warehouse_id, b.location_id): b for b in balances}
    own_old: dict[tuple, Decimal] = defaultdict(Decimal)
    for line in old_lines:
        own_old[(line.variant_id, line.warehouse_id, line.location_id)] += line.quantity
    requested: dict[uuid.UUID, Decimal] = defaultdict(Decimal)
    for row in valid:
        if row.get("product_variant_id"):
            requested[row["product_variant_id"]] += row["quantity"]

    shortages = []
    for variant_id, quantity in requested.items():
        available = sum((b.on_hand - b.reserved + own_old[(b.variant_id, b.warehouse_id, b.location_id)]
                         for b in balances if b.variant_id == variant_id), Decimal(0))
        if quantity > available:
            variant = variants[variant_id]
            shortages.append({"variant_id": str(variant_id), "internal_code": variant.internal_code,
                              "warehouse_id": str(order.warehouse_id), "requested": _number(quantity),
                              "available": _number(available)})
    if shortages:
        db.rollback()
        raise ApiError(409, "INSUFFICIENT_STOCK", "Không đủ tồn khả dụng.", {"items": shortages})

    before_snapshot = [_item_dict(item) for item in old_items]
    revision_no = (db.scalar(select(func.max(OrderItem.revision_no)).where(OrderItem.order_id == order.id)) or 0) + 1
    now = datetime.now(TZ)
    db.add(OrderItemRevision(order_id=order.id, revision_no=revision_no, items_snapshot=before_snapshot,
                             reason="Lưu lại chi tiết soạn", created_by=user.id))

    # Release only this order's old reservation.
    for line in old_lines:
        balance = balance_by_scope[(line.variant_id, line.warehouse_id, line.location_id)]
        balance.reserved -= line.quantity
        balance.available = balance.on_hand - balance.reserved
        balance.version += 1
        line.status = "RELEASED"
    for item in old_items:
        item.active = False
    if reservation:
        reservation.status = "RELEASED"
        reservation.released_at = now
        reservation.version += 1
    else:
        reservation = InventoryReservation(
            reservation_no=f"RSV-{order.order_no}", order_id=order.id, status="RELEASED", created_by=user.id
        )
        db.add(reservation)
    db.flush()

    new_items = []
    for index, row in enumerate(valid, start=1):
        variant = variants.get(row.get("product_variant_id"))
        item = OrderItem(
            order_id=order.id, line_no=index, product_variant_id=variant.id if variant else None,
            product_name_snapshot=row["product_name"],
            sales_code_snapshot=variant.sales_code if variant else row.get("sales_code"),
            internal_code_snapshot=variant.internal_code if variant else row.get("internal_code"),
            color_snapshot=(variant.color.canonical_name if variant and variant.color else row.get("color")),
            size_snapshot=variant.size if variant else row.get("size"), warehouse_id=order.warehouse_id,
            quantity=row["quantity"], unit_price_amount=row["unit_price_amount"],
            line_total_amount=row["line_total_amount"], sale_type=row.get("sale_type"),
            product_image_url_snapshot=row.get("product_image_url"), notes=row.get("note"),
            revision_no=revision_no, active=True,
        )
        db.add(item)
        new_items.append((item, variant))
    db.flush()

    # Allocate each line deterministically over locked locations.
    for item, variant in new_items:
        if not variant:
            continue
        remaining = item.quantity
        candidates = [b for b in balances if b.variant_id == variant.id]
        for balance in candidates:
            take = min(remaining, balance.on_hand - balance.reserved)
            if take <= 0:
                continue
            balance.reserved += take
            balance.available = balance.on_hand - balance.reserved
            balance.version += 1
            db.add(InventoryReservationLine(
                reservation_id=reservation.id, order_item_id=item.id, variant_id=variant.id,
                warehouse_id=order.warehouse_id, location_id=balance.location_id,
                quantity=take, status="ACTIVE",
            ))
            remaining -= take
            if remaining == 0:
                break

    reservation.status = "ACTIVE"
    reservation.released_at = None
    order.status = "PICKED"
    order.billing_status = "READY"
    order.claimed_by = user.id
    order.claimed_at = order.claimed_at or now
    order.picked_at = now
    order.staff_note = (staff_note or "").strip() or None
    order.total_amount = sum(item.line_total_amount for item, _ in new_items)
    previous_version = order.version
    order.version += 1
    if old_status != "PICKED":
        db.add(OrderStatusEvent(order_id=order.id, from_status=old_status, to_status="PICKED",
                                actor_user_id=user.id, reason="Đã soạn; chờ gửi hóa đơn"))
    after_snapshot = [_item_dict(item) for item, _ in new_items]
    db.add(AuditLog(entity_type="ORDER", entity_id=order.id, action="PICK_SAVE", actor_user_id=user.id,
                    before_data={"version": previous_version, "items": before_snapshot,
                                 "status": old_status, "billing_status": old_billing_status},
                    after_data={"version": order.version, "items": after_snapshot,
                                "status": order.status, "billing_status": order.billing_status}))
    db.commit()
    db.refresh(order)
    return order_detail(db, order_id=order.id)


def finish_picking_compat(db: Session, *, order_id: uuid.UUID, user: User) -> Order:
    order = db.get(Order, order_id)
    if not order:
        raise ApiError(404, "ORDER_NOT_FOUND", "Không tìm thấy đơn hàng.")
    if order.claimed_by != user.id and user.role not in ("OWNER", "ADMIN"):
        raise ApiError(403, "ORDER_NOT_ASSIGNEE", "Chỉ người đang soạn mới được hoàn tất đơn.")
    items = list(db.scalars(select(OrderItem).where(
        OrderItem.order_id == order.id, OrderItem.active
    ).order_by(OrderItem.line_no)))
    reservation = db.scalar(select(InventoryReservation).where(
        InventoryReservation.order_id == order.id, InventoryReservation.status == "ACTIVE"
    ))
    if not items or not reservation:
        raise ApiError(409, "PICK_DETAILS_REQUIRED", "Phải lưu chi tiết soạn và giữ tồn trước khi hoàn tất.")
    if order.status == "PICKED":
        return order
    if order.status != "PICKING":
        raise ApiError(409, "ORDER_NOT_PICKING", "Đơn chưa ở trạng thái đang soạn.")

    # Trạng thái hiếm gặp từ dữ liệu cũ: chạy lại đúng domain service để việc
    # kiểm tồn, thay reservation, revision, audit và status vẫn chỉ có một nơi.
    payload = [{
        "product_variant_id": item.product_variant_id,
        "product_name": item.product_name_snapshot,
        "sales_code": item.sales_code_snapshot,
        "internal_code": item.internal_code_snapshot,
        "color": item.color_snapshot,
        "size": item.size_snapshot,
        "warehouse_id": item.warehouse_id,
        "quantity": item.quantity,
        "unit_price_amount": item.unit_price_amount,
        "sale_type": item.sale_type,
        "product_image_url": item.product_image_url_snapshot,
        "note": item.notes,
    } for item in items]
    save_pick(db, order_id=order.id, user=user, items=payload,
              staff_note=order.staff_note, version=order.version)
    return db.get(Order, order.id)


def post_inventory_receipt(
    db: Session, *, variant_id: uuid.UUID, warehouse_id: uuid.UUID,
    quantity, reference_type: str, reference_id: uuid.UUID,
    actor_user_id: uuid.UUID | None, idempotency_key: str, notes: str | None = None,
) -> InventoryBalance:
    """Shared stock-receipt boundary used by production/returns/import workflows.

    The caller owns the surrounding database transaction. This function never
    commits and never changes an existing ledger entry.
    """
    qty = _decimal(quantity)
    if qty <= 0:
        raise ApiError(422, "INVALID_RECEIPT_QUANTITY", "Số lượng nhập kho phải lớn hơn 0.")
    existing = db.scalar(select(InventoryTransaction).where(
        InventoryTransaction.idempotency_key == idempotency_key
    ))
    if existing:
        balance = db.scalar(select(InventoryBalance).where(
            InventoryBalance.variant_id == existing.variant_id,
            InventoryBalance.warehouse_id == existing.warehouse_id,
            InventoryBalance.location_id.is_(None),
        ))
        if not balance:
            raise ApiError(409, "INVENTORY_LEDGER_ORPHAN", "Ledger nhập kho không còn balance tương ứng.")
        return balance
    variant = db.get(ProductVariant, variant_id)
    warehouse = db.get(Warehouse, warehouse_id)
    if not variant or not warehouse:
        raise ApiError(422, "INVENTORY_SCOPE_INVALID", "Sản phẩm hoặc kho nhập không hợp lệ.")
    balance = db.scalar(select(InventoryBalance).where(
        InventoryBalance.variant_id == variant_id,
        InventoryBalance.warehouse_id == warehouse_id,
        InventoryBalance.location_id.is_(None),
    ).with_for_update(of=InventoryBalance))
    if not balance:
        balance = InventoryBalance(
            variant_id=variant_id, warehouse_id=warehouse_id, location_id=None,
            on_hand=0, reserved=0, available=0, pending_finish=0,
            cut_separated=0, defective=0, version=1,
        )
        db.add(balance)
        db.flush()
    balance.on_hand += qty
    balance.available = balance.on_hand - balance.reserved
    balance.version += 1
    db.add(InventoryTransaction(
        transaction_no=f"STK-IN-{uuid.uuid4().hex[:16].upper()}",
        transaction_type="PRODUCTION_RECEIPT", reference_type=reference_type,
        reference_id=reference_id, variant_id=variant_id, warehouse_id=warehouse_id,
        location_id=None, quantity_delta=qty, reservation_delta=0,
        balance_after=balance.on_hand, actor_user_id=actor_user_id,
        notes=notes, idempotency_key=idempotency_key,
    ))
    return balance
