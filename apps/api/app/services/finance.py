from __future__ import annotations

import html
import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.errors import ApiError
from ..models import (
    AuditLog, Customer, DebtLedgerEntry, InventoryBalance, InventoryReservation,
    InventoryReservationLine, InventoryTransaction, Invoice, InvoiceCapture,
    InvoiceOrder, MediaObject, Order, OrderItem, PartyDebtBalance, Payment,
    PaymentAllocation, ReturnItem, ReturnRecord, User,
)
from .orders import order_to_dict
from .storage import media_view_url

ELIGIBLE_ORDER_STATUSES = {"PICKED", "SHIPPING", "COMPLETED"}
OPEN_BILLING_STATUSES = {"DRAFT", "READY"}
PAYMENT_METHODS = {"CASH", "BANK_TRANSFER", "RETURN_CREDIT", "OTHER"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _serial(value: Decimal) -> int | float:
    return int(value) if value == value.to_integral_value() else float(value)


def _number(prefix: str) -> str:
    return f"{prefix}-{_now():%Y%m%d%H%M%S}-{uuid.uuid4().hex[:6].upper()}"


def audit(db: Session, *, module: str, action: str, entity_type: str,
          entity_id: uuid.UUID, actor: User, before=None, after=None,
          request_id: str | None = None) -> None:
    db.add(AuditLog(
        module=module, action=action, entity_type=entity_type, entity_id=entity_id,
        actor_user_id=actor.id, before_data=before, after_data=after,
        request_id=request_id, occurred_at=_now(),
    ))


def debt_total(db: Session, customer_id: uuid.UUID) -> int:
    return int(db.scalar(select(func.coalesce(func.sum(DebtLedgerEntry.amount_delta), 0)).where(
        DebtLedgerEntry.party_type == "CUSTOMER", DebtLedgerEntry.party_id == customer_id
    )) or 0)


def refresh_debt_projection(db: Session, customer_id: uuid.UUID) -> PartyDebtBalance:
    rows = list(db.scalars(select(DebtLedgerEntry).where(
        DebtLedgerEntry.party_type == "CUSTOMER", DebtLedgerEntry.party_id == customer_id
    )))
    opening = sum(row.amount_delta for row in rows if row.entry_type == "OPENING")
    debit = sum(row.amount_delta for row in rows if row.amount_delta > 0 and row.entry_type != "OPENING")
    credit = -sum(row.amount_delta for row in rows if row.amount_delta < 0)
    current = sum(row.amount_delta for row in rows)
    projection = db.scalar(select(PartyDebtBalance).where(
        PartyDebtBalance.party_type == "CUSTOMER", PartyDebtBalance.party_id == customer_id
    ).with_for_update(of=PartyDebtBalance))
    if not projection:
        projection = PartyDebtBalance(party_type="CUSTOMER", party_id=customer_id)
        db.add(projection)
    else:
        projection.version += 1
    projection.opening = opening
    projection.debit = debit
    projection.credit = credit
    projection.current = current
    projection.calculated_at = _now()
    return projection


def _active_items(db: Session, order_id: uuid.UUID) -> list[OrderItem]:
    return list(db.scalars(select(OrderItem).where(
        OrderItem.order_id == order_id, OrderItem.active
    ).order_by(OrderItem.line_no)))


def _validate_orders(db: Session, customer_id: uuid.UUID, order_ids: list[uuid.UUID], *, lock=False) -> list[Order]:
    if not order_ids or len(set(order_ids)) != len(order_ids):
        raise ApiError(422, "ORDER_IDS_REQUIRED", "Danh sách đơn hàng không hợp lệ.")
    orders: list[Order] = []
    for order_id in sorted(order_ids, key=str):
        stmt = select(Order).where(Order.id == order_id)
        if lock:
            stmt = stmt.with_for_update(of=Order)
        order = db.scalar(stmt)
        if not order:
            raise ApiError(404, "ORDER_NOT_FOUND", "Không tìm thấy đơn hàng.")
        orders.append(order)
    if any(order.customer_id != customer_id for order in orders):
        raise ApiError(409, "CUSTOMER_MISMATCH", "Tất cả đơn trên một hóa đơn phải cùng khách hàng.")
    for order in orders:
        if order.status not in ELIGIBLE_ORDER_STATUSES:
            raise ApiError(409, "ORDER_NOT_INVOICE_ELIGIBLE", f"Đơn {order.order_no} chưa đủ điều kiện lập hóa đơn.")
        if order.billing_status not in OPEN_BILLING_STATUSES:
            raise ApiError(409, "ORDER_ALREADY_INVOICED", f"Đơn {order.order_no} đã được chốt hóa đơn.")
        if db.scalar(select(InvoiceOrder.id).where(InvoiceOrder.order_id == order.id)):
            raise ApiError(409, "ORDER_ALREADY_INVOICED", f"Đơn {order.order_no} đã thuộc một hóa đơn.")
        if not _active_items(db, order.id):
            raise ApiError(409, "ORDER_ITEMS_REQUIRED", f"Đơn {order.order_no} chưa có chi tiết soạn.")
    return orders


def preview_invoice(db: Session, *, customer_id: uuid.UUID, order_ids: list[uuid.UUID],
                    surcharge_amount: int = 0, return_ids: list[uuid.UUID] | None = None,
                    expected_debt_amount: int | None = None) -> dict:
    customer = db.get(Customer, customer_id)
    if not customer or customer.deleted_at:
        raise ApiError(404, "CUSTOMER_NOT_FOUND", "Không tìm thấy khách hàng.")
    if surcharge_amount < 0:
        raise ApiError(422, "INVALID_SURCHARGE", "Khoản cộng thêm không được âm.")
    orders = _validate_orders(db, customer_id, order_ids)
    debt_before = debt_total(db, customer_id)
    if expected_debt_amount is not None and abs(expected_debt_amount - debt_before) > settings.money_rounding_tolerance_vnd:
        raise ApiError(409, "DEBT_CONFLICT", "Công nợ đã thay đổi, vui lòng tải lại.", {"current_debt": debt_before})
    selected_returns = []
    for return_id in sorted(return_ids or [], key=str):
        row = db.get(ReturnRecord, return_id)
        if not row or row.customer_id != customer_id or row.status != "NEW" or row.total_credit_amount <= 0:
            raise ApiError(409, "RETURN_NOT_AVAILABLE", "Phiếu hàng trả không còn khả dụng.")
        selected_returns.append(row)
    available_returns = list(db.scalars(select(ReturnRecord).where(
        ReturnRecord.customer_id == customer_id, ReturnRecord.status == "NEW",
        ReturnRecord.total_credit_amount > 0,
    ).order_by(ReturnRecord.created_at)))
    order_rows = []
    subtotal = 0
    for order in orders:
        items = _active_items(db, order.id)
        amount = sum(item.line_total_amount for item in items)
        subtotal += amount
        order_rows.append({
            "id": str(order.id), "order_no": order.order_no, "amount": amount,
            "status": order.status, "billing_status": order.billing_status,
            "images": [{"id": str(m.id), "url": media_view_url(m.id), "view_url": media_view_url(m.id), "original_name": m.original_name}
                       for m in order.media],
            "items": [{
                "id": str(item.id), "product_variant_id": str(item.product_variant_id) if item.product_variant_id else None,
                "name": item.product_name_snapshot, "sales_code": item.sales_code_snapshot,
                "internal_code": item.internal_code_snapshot, "color": item.color_snapshot,
                "size": item.size_snapshot, "quantity": _serial(item.quantity),
                "unit_price_amount": item.unit_price_amount, "line_total_amount": item.line_total_amount,
            } for item in items],
        })
    return_credit = sum(row.total_credit_amount for row in selected_returns)
    due = max(subtotal + surcharge_amount - return_credit, 0)
    return {
        "customer": {"id": str(customer.id), "customer_code": customer.customer_code, "name": customer.name,
                     "phone": customer.phone, "address": customer.address},
        "orders": order_rows, "subtotal_amount": subtotal, "surcharge_amount": surcharge_amount,
        "return_credit_amount": return_credit, "amount_due_before_payment": due,
        "debt_before_amount": debt_before,
        "debt_after_before_payment": debt_before + subtotal + surcharge_amount - return_credit,
        "available_returns": [{"id": str(row.id), "return_no": row.return_no,
                               "amount": row.total_credit_amount, "note": row.note}
                              for row in available_returns],
    }


def _invoice_dict(invoice: Invoice, db: Session) -> dict:
    order_links = list(db.scalars(select(InvoiceOrder).where(InvoiceOrder.invoice_id == invoice.id)))
    allocated = int(db.scalar(select(func.coalesce(func.sum(PaymentAllocation.allocated_amount), 0)).where(
        PaymentAllocation.target_type == "INVOICE", PaymentAllocation.target_id == invoice.id
    )) or 0)
    payment_total = int(db.scalar(select(func.coalesce(func.sum(Payment.amount), 0)).join(
        PaymentAllocation, PaymentAllocation.payment_id == Payment.id
    ).where(PaymentAllocation.target_type == "INVOICE", PaymentAllocation.target_id == invoice.id,
            Payment.status == "POSTED")) or 0)
    captured_image = None
    if invoice.captured_invoice_media_id:
        media = db.get(MediaObject, invoice.captured_invoice_media_id)
        if media:
            captured_image = {
                "id": str(media.id), "url": media_view_url(media.id), "view_url": media_view_url(media.id),
                "original_name": media.original_name, "content_type": media.content_type,
            }
    return {
        "id": str(invoice.id), "invoice_no": invoice.invoice_no, "customer_id": str(invoice.customer_id),
        "status": invoice.status, "issued_at": invoice.issued_at.isoformat() if invoice.issued_at else None,
        "subtotal_amount": invoice.subtotal_amount, "surcharge_amount": invoice.surcharge_amount,
        "return_credit_amount": invoice.return_credit_amount, "paid_amount": invoice.paid_amount,
        "balance_amount": invoice.balance_amount, "debt_before_amount": invoice.debt_before_amount,
        "debt_after_amount": invoice.debt_after_amount, "note": invoice.note, "version": invoice.version,
        "order_ids": [str(link.order_id) for link in order_links], "allocated_amount": allocated,
        "unallocated_credit_amount": max(payment_total - allocated, 0), "snapshot": invoice.snapshot,
        "captured_invoice_media_id": str(invoice.captured_invoice_media_id) if invoice.captured_invoice_media_id else None,
        "captured_at": invoice.captured_at.isoformat() if invoice.captured_at else None,
        "captured_image": captured_image,
    }


def list_invoices(db: Session, *, status: str | None = None, customer_id: uuid.UUID | None = None) -> list[dict]:
    stmt = select(Invoice).order_by(Invoice.issued_at.desc())
    if status:
        stmt = stmt.where(Invoice.status == status)
    if customer_id:
        stmt = stmt.where(Invoice.customer_id == customer_id)
    return [_invoice_dict(row, db) for row in db.scalars(stmt)]


def close_invoice(db: Session, *, customer_id: uuid.UUID, order_ids: list[uuid.UUID],
                  surcharge_amount: int, return_ids: list[uuid.UUID], payments: list[dict],
                  note: str | None, expected_debt_amount: int | None,
                  captured_media_id: uuid.UUID | None, idempotency_key: str, user: User) -> dict:
    existing = db.scalar(select(Invoice).where(Invoice.idempotency_key == idempotency_key))
    if existing:
        return _invoice_dict(existing, db)
    if not idempotency_key:
        raise ApiError(422, "IDEMPOTENCY_KEY_REQUIRED", "Thiếu Idempotency-Key.")
    if not captured_media_id:
        raise ApiError(409, "INVOICE_CAPTURE_REQUIRED",
                       "Vui lòng chụp ảnh hóa đơn trước khi xác nhận & chốt nợ.")
    captured_media = db.scalar(select(MediaObject).where(MediaObject.id == captured_media_id))
    if not captured_media:
        raise ApiError(422, "MEDIA_NOT_FOUND", "Ảnh hóa đơn không hợp lệ.")
    customer = db.scalar(select(Customer).where(Customer.id == customer_id).with_for_update(of=Customer))
    if not customer:
        raise ApiError(404, "CUSTOMER_NOT_FOUND", "Không tìm thấy khách hàng.")
    orders = _validate_orders(db, customer_id, order_ids, lock=True)
    preview = preview_invoice(db, customer_id=customer_id, order_ids=order_ids,
                              surcharge_amount=surcharge_amount, return_ids=return_ids,
                              expected_debt_amount=expected_debt_amount)
    debt_before = preview["debt_before_amount"]

    returns: list[ReturnRecord] = []
    for return_id in sorted(return_ids, key=str):
        row = db.scalar(select(ReturnRecord).where(ReturnRecord.id == return_id).with_for_update(of=ReturnRecord))
        if not row or row.customer_id != customer_id or row.status != "NEW" or row.total_credit_amount <= 0:
            raise ApiError(409, "RETURN_NOT_AVAILABLE", "Phiếu hàng trả không còn khả dụng.")
        returns.append(row)

    reservations: list[InventoryReservation] = []
    reservation_lines: list[InventoryReservationLine] = []
    for order in orders:
        reservation = db.scalar(select(InventoryReservation).where(
            InventoryReservation.order_id == order.id,
            InventoryReservation.status == "ACTIVE",
        ).with_for_update(of=InventoryReservation))
        variant_items = [item for item in _active_items(db, order.id) if item.product_variant_id]
        if variant_items and not reservation:
            raise ApiError(409, "ACTIVE_RESERVATION_REQUIRED", f"Đơn {order.order_no} không còn giữ tồn.")
        if reservation:
            reservations.append(reservation)
            reservation_lines.extend(list(db.scalars(select(InventoryReservationLine).where(
                InventoryReservationLine.reservation_id == reservation.id,
                InventoryReservationLine.status == "ACTIVE",
            ).order_by(InventoryReservationLine.id).with_for_update(of=InventoryReservationLine))))
    expected_by_item = {item.id: item.quantity for order in orders for item in _active_items(db, order.id) if item.product_variant_id}
    actual_by_item: dict[uuid.UUID, Decimal] = {}
    for line in reservation_lines:
        actual_by_item[line.order_item_id] = actual_by_item.get(line.order_item_id, Decimal(0)) + line.quantity
    if expected_by_item != actual_by_item:
        raise ApiError(409, "RESERVATION_MISMATCH", "Số lượng giữ tồn không khớp chi tiết đơn.")

    scopes = sorted({(line.variant_id, line.warehouse_id, line.location_id) for line in reservation_lines}, key=lambda x: tuple(str(v or "") for v in x))
    balances: dict[tuple, InventoryBalance] = {}
    for variant_id, warehouse_id, location_id in scopes:
        balance = db.scalar(select(InventoryBalance).where(
            InventoryBalance.variant_id == variant_id,
            InventoryBalance.warehouse_id == warehouse_id,
            InventoryBalance.location_id.is_(None) if location_id is None else InventoryBalance.location_id == location_id,
        ).with_for_update(of=InventoryBalance))
        if not balance:
            raise ApiError(409, "INVENTORY_BALANCE_MISSING", "Không tìm thấy tồn kho đã giữ.")
        balances[(variant_id, warehouse_id, location_id)] = balance
    required: dict[tuple, Decimal] = {}
    for line in reservation_lines:
        key = (line.variant_id, line.warehouse_id, line.location_id)
        required[key] = required.get(key, Decimal(0)) + line.quantity
    shortages = []
    for key, quantity in required.items():
        balance = balances[key]
        if balance.on_hand < quantity or balance.reserved < quantity:
            shortages.append({"variant_id": str(key[0]), "required": _serial(quantity),
                              "on_hand": _serial(balance.on_hand), "reserved": _serial(balance.reserved)})
    if shortages:
        raise ApiError(409, "INSUFFICIENT_STOCK_AT_CLOSE", "Tồn kho thay đổi, không thể chốt hóa đơn.", {"items": shortages})

    invoice = Invoice(
        invoice_no=_number("INV"), customer_id=customer_id, status="SENT", issued_at=_now(),
        subtotal_amount=preview["subtotal_amount"], surcharge_amount=surcharge_amount,
        return_credit_amount=preview["return_credit_amount"], paid_amount=0, balance_amount=0,
        debt_before_amount=debt_before, debt_after_amount=debt_before, note=(note or "").strip() or None,
        template_version="1", snapshot={}, created_by=user.id, idempotency_key=idempotency_key,
        captured_invoice_media_id=captured_media_id, captured_at=_now(),
    )
    db.add(invoice)
    db.flush()

    for line in reservation_lines:
        balance = balances[(line.variant_id, line.warehouse_id, line.location_id)]
        balance.on_hand -= line.quantity
        balance.reserved -= line.quantity
        balance.available = balance.on_hand - balance.reserved
        balance.version += 1
        line.status = "EXPORTED"
        db.add(InventoryTransaction(
            transaction_no=_number("STK"), transaction_type="INVOICE_EXPORT",
            reference_type="INVOICE", reference_id=invoice.id, variant_id=line.variant_id,
            warehouse_id=line.warehouse_id, location_id=line.location_id,
            quantity_delta=-line.quantity, reservation_delta=-line.quantity,
            balance_after=balance.on_hand, actor_user_id=user.id,
            notes=f"Xuất theo {invoice.invoice_no}", idempotency_key=f"{idempotency_key}:stock:{line.id}",
        ))
    for reservation in reservations:
        reservation.status = "CONVERTED"
        reservation.converted_at = _now()
        reservation.version += 1

    for order_row in preview["orders"]:
        db.add(InvoiceOrder(invoice_id=invoice.id, order_id=uuid.UUID(order_row["id"]), amount=order_row["amount"]))

    db.add(DebtLedgerEntry(
        party_type="CUSTOMER", party_id=customer_id, entry_type="INVOICE",
        amount_delta=invoice.subtotal_amount, reference_type="INVOICE", reference_id=invoice.id,
        description=f"Hóa đơn {invoice.invoice_no}", actor_user_id=user.id,
        idempotency_key=f"{idempotency_key}:debt:invoice",
    ))
    if surcharge_amount:
        db.add(DebtLedgerEntry(
            party_type="CUSTOMER", party_id=customer_id, entry_type="SURCHARGE",
            amount_delta=surcharge_amount, reference_type="INVOICE", reference_id=invoice.id,
            description=f"Cộng thêm {invoice.invoice_no}", actor_user_id=user.id,
            idempotency_key=f"{idempotency_key}:debt:surcharge",
        ))
    return_payment_snapshots = []
    if invoice.return_credit_amount:
        db.add(DebtLedgerEntry(
            party_type="CUSTOMER", party_id=customer_id, entry_type="RETURN_CREDIT",
            amount_delta=-invoice.return_credit_amount, reference_type="INVOICE", reference_id=invoice.id,
            description=f"Hàng trả trừ hóa đơn {invoice.invoice_no}", actor_user_id=user.id,
            idempotency_key=f"{idempotency_key}:debt:return",
        ))
        for row in returns:
            return_payment = Payment(
                payment_no=_number("PAY"), party_type="CUSTOMER", customer_id=customer_id,
                paid_at=_now(), amount=row.total_credit_amount, method="RETURN_CREDIT",
                direction="RECEIPT", received_or_paid_by=user.id,
                note=f"Hàng trả {row.return_no}", status="POSTED",
                idempotency_key=f"{idempotency_key}:return-payment:{row.id}",
            )
            db.add(return_payment); db.flush()
            allocation = min(row.total_credit_amount, invoice.subtotal_amount + surcharge_amount)
            if allocation:
                db.add(PaymentAllocation(payment_id=return_payment.id, target_type="INVOICE",
                                         target_id=invoice.id, allocated_amount=allocation))
            return_payment_snapshots.append({"payment_id": str(return_payment.id),
                                             "payment_no": return_payment.payment_no,
                                             "method": "RETURN_CREDIT", "amount": row.total_credit_amount,
                                             "allocated_amount": allocation,
                                             "unallocated_amount": row.total_credit_amount - allocation})
            row.status = "CREDITED"
            row.credit_posted = True
            row.approved_by = user.id
            row.approved_at = _now()
            row.approval_idempotency_key = f"{idempotency_key}:return:{row.id}"
            row.version += 1

    paid_total = 0
    allocated_total = 0
    invoice_due = max(invoice.subtotal_amount + surcharge_amount - invoice.return_credit_amount, 0)
    payment_snapshots = list(return_payment_snapshots)
    for index, raw in enumerate(payments):
        amount = int(raw.get("amount") or 0)
        method = str(raw.get("method") or "").upper()
        if amount <= 0 or method not in PAYMENT_METHODS or method == "RETURN_CREDIT":
            raise ApiError(422, "INVALID_PAYMENT", "Dòng thanh toán không hợp lệ.")
        payment = Payment(
            payment_no=_number("PAY"), party_type="CUSTOMER", customer_id=customer_id,
            paid_at=_now(), amount=amount, method=method, direction="RECEIPT",
            received_or_paid_by=user.id, note=(raw.get("note") or "").strip() or None,
            status="POSTED", idempotency_key=f"{idempotency_key}:payment:{index}",
        )
        db.add(payment)
        db.flush()
        allocation = min(amount, max(invoice_due - allocated_total, 0))
        if allocation:
            db.add(PaymentAllocation(payment_id=payment.id, target_type="INVOICE",
                                     target_id=invoice.id, allocated_amount=allocation))
            allocated_total += allocation
        paid_total += amount
        db.add(DebtLedgerEntry(
            party_type="CUSTOMER", party_id=customer_id, entry_type="PAYMENT",
            amount_delta=-amount, reference_type="PAYMENT", reference_id=payment.id,
            description=f"Thanh toán {invoice.invoice_no}", actor_user_id=user.id,
            idempotency_key=f"{idempotency_key}:debt:payment:{index}",
        ))
        payment_snapshots.append({"payment_id": str(payment.id), "payment_no": payment.payment_no,
                                  "method": method, "amount": amount, "allocated_amount": allocation,
                                  "unallocated_amount": amount - allocation})

    invoice.paid_amount = paid_total
    raw_balance = invoice_due - paid_total
    invoice.balance_amount = 0 if abs(raw_balance) <= settings.money_rounding_tolerance_vnd else max(raw_balance, 0)
    invoice.status = "PAID" if invoice.balance_amount == 0 else ("PARTIALLY_PAID" if paid_total or invoice.return_credit_amount else "SENT")
    debt_after = debt_before + invoice.subtotal_amount + surcharge_amount - invoice.return_credit_amount - paid_total
    invoice.debt_after_amount = 0 if abs(debt_after) <= settings.money_rounding_tolerance_vnd else debt_after

    remaining_paid = paid_total + invoice.return_credit_amount
    for order in orders:
        amount = next(row["amount"] for row in preview["orders"] if row["id"] == str(order.id))
        applied = min(amount, remaining_paid)
        remaining_paid -= applied
        order.paid_amount = applied
        order.invoice_balance_amount = amount - applied
        order.billing_status = "PAID" if order.invoice_balance_amount == 0 else ("PARTIALLY_PAID" if applied else "SENT")
        order.version += 1

    invoice.snapshot = {
        "template_version": "1", "invoice_no": invoice.invoice_no,
        "issued_at": invoice.issued_at.isoformat(), "customer": preview["customer"],
        "orders": preview["orders"], "subtotal_amount": invoice.subtotal_amount,
        "surcharge_amount": surcharge_amount, "return_credit_amount": invoice.return_credit_amount,
        "paid_amount": paid_total, "balance_amount": invoice.balance_amount,
        "debt_before_amount": debt_before, "debt_after_amount": invoice.debt_after_amount,
        "payments": payment_snapshots, "return_ids": [str(row.id) for row in returns], "note": invoice.note,
    }
    db.flush()
    refresh_debt_projection(db, customer_id)
    audit(db, module="INVOICE", action="CLOSE", entity_type="INVOICE", entity_id=invoice.id,
          actor=user, after={"invoice_no": invoice.invoice_no, "total": invoice.subtotal_amount,
                             "status": invoice.status}, request_id=idempotency_key)
    db.commit()
    return _invoice_dict(invoice, db)


def create_payment(db: Session, *, amount: int, method: str, customer_id: uuid.UUID | None,
                   allocations: list[dict], paid_at: datetime | None, note: str | None,
                   idempotency_key: str, user: User) -> dict:
    existing = db.scalar(select(Payment).where(Payment.idempotency_key == idempotency_key))
    if existing:
        return payment_dict(existing, db)
    if amount <= 0:
        raise ApiError(422, "INVALID_PAYMENT_AMOUNT", "Số tiền phải lớn hơn 0.")
    method = method.upper()
    if method not in PAYMENT_METHODS:
        raise ApiError(422, "INVALID_PAYMENT_METHOD", "Phương thức thanh toán không hợp lệ.")
    if method == "RETURN_CREDIT":
        raise ApiError(422, "RETURN_CREDIT_REQUIRES_RETURN", "Credit hàng trả phải được tạo từ quy trình duyệt phiếu hàng trả.")
    if not customer_id or not db.get(Customer, customer_id):
        raise ApiError(422, "CUSTOMER_REQUIRED", "Thanh toán khách hàng cần customer_id.")
    allocated = sum(int(row.get("allocated_amount") or 0) for row in allocations)
    if any(int(row.get("allocated_amount") or 0) <= 0 for row in allocations) or allocated > amount:
        raise ApiError(422, "ALLOCATION_EXCEEDS_PAYMENT", "Tổng phân bổ không được vượt số tiền thanh toán.")
    payment = Payment(
        payment_no=_number("PAY"), party_type="CUSTOMER", customer_id=customer_id,
        paid_at=paid_at or _now(), amount=amount, method=method, direction="RECEIPT",
        received_or_paid_by=user.id, note=(note or "").strip() or None,
        status="POSTED", idempotency_key=idempotency_key,
    )
    db.add(payment)
    db.flush()
    seen = set()
    for row in allocations:
        target_type = str(row.get("target_type") or "").upper()
        target_id = uuid.UUID(str(row.get("target_id")))
        key = (target_type, target_id)
        if key in seen or target_type != "INVOICE":
            raise ApiError(422, "INVALID_ALLOCATION", "Phân bổ thanh toán không hợp lệ.")
        seen.add(key)
        invoice = db.scalar(select(Invoice).where(Invoice.id == target_id).with_for_update(of=Invoice))
        if not invoice or invoice.customer_id != customer_id or invoice.status == "VOID":
            raise ApiError(409, "ALLOCATION_TARGET_INVALID", "Hóa đơn phân bổ không hợp lệ.")
        value = int(row["allocated_amount"])
        db.add(PaymentAllocation(payment_id=payment.id, target_type="INVOICE", target_id=invoice.id,
                                 allocated_amount=value))
        invoice.paid_amount += value
        invoice.balance_amount = max(invoice.balance_amount - value, 0)
        invoice.status = "PAID" if invoice.balance_amount == 0 else "PARTIALLY_PAID"
        invoice.version += 1
        remaining = invoice.paid_amount + invoice.return_credit_amount
        links = list(db.scalars(select(InvoiceOrder).where(InvoiceOrder.invoice_id == invoice.id).order_by(InvoiceOrder.id)))
        for link in links:
            order = db.scalar(select(Order).where(Order.id == link.order_id).with_for_update(of=Order))
            if not order:
                continue
            applied = min(link.amount, remaining)
            remaining -= applied
            order.paid_amount = applied
            order.invoice_balance_amount = link.amount - applied
            order.billing_status = "PAID" if order.invoice_balance_amount == 0 else ("PARTIALLY_PAID" if applied else "SENT")
            order.version += 1
    db.add(DebtLedgerEntry(
        party_type="CUSTOMER", party_id=customer_id, entry_type="PAYMENT", amount_delta=-amount,
        reference_type="PAYMENT", reference_id=payment.id, description=payment.note or payment.payment_no,
        actor_user_id=user.id, idempotency_key=f"{idempotency_key}:debt",
    ))
    db.flush()
    refresh_debt_projection(db, customer_id)
    audit(db, module="PAYMENT", action="CREATE", entity_type="PAYMENT", entity_id=payment.id,
          actor=user, after={"amount": amount, "allocated": allocated}, request_id=idempotency_key)
    db.commit()
    return payment_dict(payment, db)


def payment_dict(payment: Payment, db: Session) -> dict:
    allocations = list(db.scalars(select(PaymentAllocation).where(PaymentAllocation.payment_id == payment.id)))
    allocated = sum(row.allocated_amount for row in allocations)
    return {"id": str(payment.id), "payment_no": payment.payment_no,
            "customer_id": str(payment.customer_id) if payment.customer_id else None,
            "paid_at": payment.paid_at.isoformat(), "amount": payment.amount, "method": payment.method,
            "direction": payment.direction, "status": payment.status, "note": payment.note,
            "allocated_amount": allocated, "unallocated_amount": payment.amount - allocated,
            "allocations": [{"target_type": row.target_type, "target_id": str(row.target_id),
                             "allocated_amount": row.allocated_amount} for row in allocations]}


def list_payments(db: Session, customer_id: uuid.UUID | None = None) -> list[dict]:
    stmt = select(Payment).order_by(Payment.paid_at.desc())
    if customer_id:
        stmt = stmt.where(Payment.customer_id == customer_id)
    return [payment_dict(row, db) for row in db.scalars(stmt)]


def invoice_print_html(invoice: Invoice) -> str:
    snapshot = invoice.snapshot
    customer = snapshot.get("customer", {})
    rows = []
    for order in snapshot.get("orders", []):
        for item in order.get("items", []):
            rows.append("<tr>" + "".join(f"<td>{html.escape(str(value or ''))}</td>" for value in (
                order.get("order_no"), item.get("name"), item.get("color"), item.get("size"),
                item.get("quantity"), f"{item.get('unit_price_amount', 0):,}", f"{item.get('line_total_amount', 0):,}"
            )) + "</tr>")
    return f"""<!doctype html><html><head><meta charset='utf-8'><title>{html.escape(invoice.invoice_no)}</title>
<style>body{{font:14px Arial;max-width:900px;margin:30px auto;color:#172033}}h1{{color:#1268d3}}table{{width:100%;border-collapse:collapse}}th,td{{border:1px solid #ccd5e2;padding:8px;text-align:left}}.sum{{text-align:right;font-size:16px;line-height:1.7}}@media print{{button{{display:none}}}}</style></head><body>
<button onclick='print()'>In hóa đơn</button><h1>AZALAS SPORT — {html.escape(invoice.invoice_no)}</h1>
<p><b>Khách hàng:</b> {html.escape(str(customer.get('name') or ''))}<br><b>Địa chỉ:</b> {html.escape(str(customer.get('address') or ''))}</p>
<table><thead><tr><th>Đơn</th><th>Sản phẩm</th><th>Màu</th><th>Size</th><th>SL</th><th>Đơn giá</th><th>Thành tiền</th></tr></thead><tbody>{''.join(rows)}</tbody></table>
<div class='sum'><b>Tổng đơn:</b> {snapshot.get('subtotal_amount', 0):,} đ<br><b>Cộng thêm:</b> {snapshot.get('surcharge_amount', 0):,} đ<br><b>Hàng trả:</b> -{snapshot.get('return_credit_amount', 0):,} đ<br><b>Đã nhận:</b> -{snapshot.get('paid_amount', 0):,} đ<br><b>Còn lại:</b> {snapshot.get('balance_amount', 0):,} đ</div></body></html>"""


def void_invoice(db: Session, *, invoice_id: uuid.UUID, version: int,
                 reason: str, idempotency_key: str, user: User) -> dict:
    invoice = db.scalar(select(Invoice).where(Invoice.id == invoice_id).with_for_update(of=Invoice))
    if not invoice:
        raise ApiError(404, "INVOICE_NOT_FOUND", "Không tìm thấy hóa đơn.")
    if invoice.status == "VOID" and invoice.void_idempotency_key == idempotency_key:
        return _invoice_dict(invoice, db)
    if invoice.status == "VOID":
        raise ApiError(409, "INVOICE_ALREADY_VOID", "Hóa đơn đã được hủy.")
    if invoice.version != version:
        raise ApiError(409, "VERSION_CONFLICT", "Hóa đơn đã thay đổi, vui lòng tải lại.", {"current_version": invoice.version})
    if not reason.strip():
        raise ApiError(422, "VOID_REASON_REQUIRED", "Bắt buộc nhập lý do hủy hóa đơn.")

    exports = list(db.scalars(select(InventoryTransaction).where(
        InventoryTransaction.reference_type == "INVOICE",
        InventoryTransaction.reference_id == invoice.id,
        InventoryTransaction.transaction_type == "INVOICE_EXPORT",
    ).order_by(InventoryTransaction.id)))
    for original in exports:
        balance = db.scalar(select(InventoryBalance).where(
            InventoryBalance.variant_id == original.variant_id,
            InventoryBalance.warehouse_id == original.warehouse_id,
            InventoryBalance.location_id.is_(None) if original.location_id is None else InventoryBalance.location_id == original.location_id,
        ).with_for_update(of=InventoryBalance))
        if not balance:
            raise ApiError(409, "INVENTORY_BALANCE_MISSING", "Không tìm thấy tồn để hoàn xuất.")
        quantity = -original.quantity_delta
        balance.on_hand += quantity
        balance.available = balance.on_hand - balance.reserved
        balance.version += 1
        db.add(InventoryTransaction(
            transaction_no=_number("STK"), transaction_type="INVOICE_VOID_REVERSAL",
            reference_type="INVOICE", reference_id=invoice.id, variant_id=original.variant_id,
            warehouse_id=original.warehouse_id, location_id=original.location_id,
            quantity_delta=quantity, reservation_delta=0, balance_after=balance.on_hand,
            actor_user_id=user.id, reversal_of_id=original.id, notes=reason.strip(),
            idempotency_key=f"{idempotency_key}:stock:{original.id}",
        ))

    debt_rows = list(db.scalars(select(DebtLedgerEntry).where(
        DebtLedgerEntry.reference_type == "INVOICE", DebtLedgerEntry.reference_id == invoice.id,
        DebtLedgerEntry.reversal_of_id.is_(None),
    ).order_by(DebtLedgerEntry.id)))
    for original in debt_rows:
        db.add(DebtLedgerEntry(
            party_type=original.party_type, party_id=original.party_id,
            entry_type=f"{original.entry_type}_REVERSAL", amount_delta=-original.amount_delta,
            reference_type="INVOICE", reference_id=invoice.id, description=reason.strip(),
            reversal_of_id=original.id, actor_user_id=user.id,
            idempotency_key=f"{idempotency_key}:debt:{original.id}",
        ))

    payment_ids = list(db.scalars(select(PaymentAllocation.payment_id).where(
        PaymentAllocation.target_type == "INVOICE", PaymentAllocation.target_id == invoice.id
    )))
    for payment_id in payment_ids:
        payment = db.scalar(select(Payment).where(Payment.id == payment_id).with_for_update(of=Payment))
        if not payment or not payment.idempotency_key.startswith(f"{invoice.idempotency_key}:payment:"):
            continue
        original = db.scalar(select(DebtLedgerEntry).where(
            DebtLedgerEntry.reference_type == "PAYMENT", DebtLedgerEntry.reference_id == payment.id,
            DebtLedgerEntry.entry_type == "PAYMENT", DebtLedgerEntry.reversal_of_id.is_(None),
        ))
        if original:
            db.add(DebtLedgerEntry(
                party_type="CUSTOMER", party_id=invoice.customer_id, entry_type="PAYMENT_REVERSAL",
                amount_delta=-original.amount_delta, reference_type="INVOICE", reference_id=invoice.id,
                description=f"Hủy thanh toán cùng {invoice.invoice_no}", reversal_of_id=original.id,
                actor_user_id=user.id, idempotency_key=f"{idempotency_key}:payment:{payment.id}",
            ))
        payment.status = "VOID"

    for return_id in invoice.snapshot.get("return_ids", []):
        row = db.get(ReturnRecord, uuid.UUID(return_id))
        if row and row.status == "CREDITED":
            row.status = "CANCELLED"
            row.cancelled_by = user.id
            row.cancelled_at = _now()
            row.cancel_idempotency_key = f"{idempotency_key}:return:{row.id}"
            row.version += 1

    links = list(db.scalars(select(InvoiceOrder).where(InvoiceOrder.invoice_id == invoice.id)))
    for link in links:
        order = db.scalar(select(Order).where(Order.id == link.order_id).with_for_update(of=Order))
        if order:
            order.billing_status = "VOID"
            order.paid_amount = 0
            order.invoice_balance_amount = 0
            order.version += 1
    invoice.status = "VOID"
    invoice.void_idempotency_key = idempotency_key
    invoice.version += 1
    db.flush()
    refresh_debt_projection(db, invoice.customer_id)
    invoice.debt_after_amount = debt_total(db, invoice.customer_id)
    audit(db, module="INVOICE", action="VOID", entity_type="INVOICE", entity_id=invoice.id,
          actor=user, before={"status": "POSTED"}, after={"status": "VOID", "reason": reason.strip()},
          request_id=idempotency_key)
    db.commit()
    return _invoice_dict(invoice, db)


# --- Luồng 3 tab: Chưa gửi đơn / Đã gửi đơn / Đơn đã xóa ---

def _pending_orders_stmt():
    return select(Order).where(
        Order.status.in_(ELIGIBLE_ORDER_STATUSES),
        Order.billing_status.in_(OPEN_BILLING_STATUSES),
    )


def invoice_work_queue(db: Session, *, status: str, q: str | None) -> dict:
    """Trả về danh sách gom theo khách cho từng tab hóa đơn.

    - PENDING: order đã soạn chưa lập hóa đơn (Chưa gửi đơn).
    - SENT: hóa đơn đã chốt (Đã gửi đơn).
    - DELETED: order bị xóa mềm (Đơn đã xóa).
    """
    from ..core.text import fold

    qf = fold(q) if q else None

    if status == "SENT":
        invoices = list(db.scalars(select(Invoice).where(
            Invoice.status.in_(("SENT", "PAID", "PARTIALLY_PAID"))
        ).order_by(Invoice.issued_at.desc())))
        groups: dict[uuid.UUID, dict] = {}
        for invoice in invoices:
            entry = _invoice_dict(invoice, db)
            name = (entry.get("snapshot") or {}).get("customer", {}).get("name") or ""
            if qf and qf not in fold(name) and qf not in fold(invoice.invoice_no):
                continue
            group = groups.setdefault(invoice.customer_id, {
                "customer_id": str(invoice.customer_id), "customer_name": name, "invoices": [],
            })
            group["invoices"].append(entry)
        rows = sorted(groups.values(), key=lambda g: g["customer_name"])
        return {"status": status, "groups": rows, "total": sum(len(g["invoices"]) for g in rows)}

    if status == "DELETED":
        orders = list(db.scalars(select(Order).where(Order.billing_status == "DELETED").order_by(Order.updated_at.desc())).unique())
        groups = {}
        for order in orders:
            name = order.customer.name
            if qf and qf not in fold(name) and qf not in fold(order.order_no):
                continue
            group = groups.setdefault(order.customer_id, {
                "customer_id": str(order.customer_id), "customer_name": name, "orders": [],
            })
            group["orders"].append(order_to_dict(order))
        rows = sorted(groups.values(), key=lambda g: g["customer_name"])
        return {"status": status, "groups": rows, "total": sum(len(g["orders"]) for g in rows)}

    # PENDING
    orders = list(db.scalars(_pending_orders_stmt().order_by(Order.customer_id, Order.created_at)).unique())
    # Chỉ lấy order chưa thuộc invoice nào.
    invoiced_order_ids = set(db.scalars(select(InvoiceOrder.order_id)))
    pending = [o for o in orders if o.id not in invoiced_order_ids]
    active_item_counts = dict(db.execute(
        select(OrderItem.order_id, func.count(OrderItem.id))
        .where(OrderItem.active.is_(True), OrderItem.order_id.in_([order.id for order in pending]))
        .group_by(OrderItem.order_id)
    ).all()) if pending else {}
    groups = {}
    for order in pending:
        name = order.customer.name
        if qf and qf not in fold(name) and qf not in fold(order.order_no):
            continue
        group = groups.setdefault(order.customer_id, {
            "customer_id": str(order.customer_id), "customer_name": name, "orders": [],
        })
        order_data = order_to_dict(order)
        order_data["has_active_items"] = active_item_counts.get(order.id, 0) > 0
        group["orders"].append(order_data)
    rows = sorted(groups.values(), key=lambda g: g["customer_name"])
    return {"status": status, "groups": rows, "total": sum(len(g["orders"]) for g in rows)}


def capture_invoice_image(db: Session, *, customer_id: uuid.UUID, order_ids: list[uuid.UUID],
                          media_id: uuid.UUID, user: User) -> dict:
    customer = db.get(Customer, customer_id)
    if not customer or customer.deleted_at:
        raise ApiError(404, "CUSTOMER_NOT_FOUND", "Không tìm thấy khách hàng.")
    if not order_ids:
        raise ApiError(422, "ORDER_IDS_REQUIRED", "Thiếu danh sách đơn hàng.")
    orders = _validate_orders(db, customer_id, order_ids)
    media = db.get(MediaObject, media_id)
    if not media:
        raise ApiError(422, "MEDIA_NOT_FOUND", "Ảnh hóa đơn không hợp lệ.")
    capture = InvoiceCapture(
        customer_id=customer_id, order_ids=[str(o.id) for o in orders],
        media_id=media_id, captured_by=user.id,
    )
    db.add(capture)
    db.commit()
    return {
        "id": str(capture.id), "media_id": str(media_id),
        "url": media_view_url(media_id), "view_url": media_view_url(media_id), "original_name": media.original_name,
        "content_type": media.content_type,
    }


def get_invoice_capture(db: Session, *, customer_id: uuid.UUID, order_ids: list[uuid.UUID]) -> dict | None:
    if not order_ids or len(set(order_ids)) != len(order_ids):
        raise ApiError(422, "ORDER_IDS_REQUIRED", "Danh sách đơn hàng không hợp lệ.")
    orders = list(db.scalars(select(Order).where(Order.id.in_(order_ids))).unique())
    if len(orders) != len(order_ids) or any(order.customer_id != customer_id for order in orders):
        raise ApiError(409, "CUSTOMER_MISMATCH", "Tất cả đơn trên một hóa đơn phải cùng khách hàng.")

    requested_ids = {str(order_id) for order_id in order_ids}
    captures = db.scalars(select(InvoiceCapture).where(
        InvoiceCapture.customer_id == customer_id
    ).order_by(InvoiceCapture.created_at.desc()))
    capture = next((
        row for row in captures
        if set(row.order_ids or []) == requested_ids and len(row.order_ids or []) == len(requested_ids)
    ), None)
    if not capture:
        return None
    media = db.get(MediaObject, capture.media_id)
    if not media:
        raise ApiError(404, "MEDIA_NOT_FOUND", "Không tìm thấy ảnh hóa đơn đã chụp.")
    return {
        "id": str(capture.id), "media_id": str(media.id),
        "url": media_view_url(media.id), "view_url": media_view_url(media.id), "original_name": media.original_name,
        "content_type": media.content_type,
    }


def delete_pending_orders(db: Session, *, order_ids: list[uuid.UUID], user: User) -> dict:
    """Xóa mềm các đơn đang ở Chưa gửi đơn, chuyển sang tab Đơn đã xóa."""
    if not order_ids or len(set(order_ids)) != len(order_ids):
        raise ApiError(422, "ORDER_IDS_REQUIRED", "Danh sách đơn hàng không hợp lệ.")
    done: list[str] = []
    for order_id in sorted(order_ids, key=str):
        order = db.scalar(select(Order).where(Order.id == order_id).with_for_update(of=Order))
        if not order:
            raise ApiError(404, "ORDER_NOT_FOUND", "Không tìm thấy đơn hàng.")
        if order.billing_status == "DELETED":
            continue
        if order.status not in ELIGIBLE_ORDER_STATUSES or order.billing_status not in OPEN_BILLING_STATUSES:
            raise ApiError(409, "ORDER_NOT_DELETABLE", f"Đơn {order.order_no} không thể xóa.")
        if db.scalar(select(InvoiceOrder.id).where(InvoiceOrder.order_id == order.id)):
            raise ApiError(409, "ORDER_ALREADY_INVOICED", f"Đơn {order.order_no} đã chốt hóa đơn.")
        order.billing_status = "DELETED"
        order.version += 1
        audit(db, module="INVOICE", action="DELETE_PENDING", entity_type="ORDER", entity_id=order.id,
              actor=user, before={"billing_status": "READY"}, after={"billing_status": "DELETED"})
        done.append(order.order_no)
    db.commit()
    return {"deleted": done}


def restore_deleted_orders(db: Session, *, order_ids: list[uuid.UUID], user: User) -> dict:
    """Khôi phục đơn đã xóa về Chưa gửi đơn (billing_status READY)."""
    if not order_ids or len(set(order_ids)) != len(order_ids):
        raise ApiError(422, "ORDER_IDS_REQUIRED", "Danh sách đơn hàng không hợp lệ.")
    done: list[str] = []
    for order_id in sorted(order_ids, key=str):
        order = db.scalar(select(Order).where(Order.id == order_id).with_for_update(of=Order))
        if not order:
            raise ApiError(404, "ORDER_NOT_FOUND", "Không tìm thấy đơn hàng.")
        if order.billing_status != "DELETED":
            continue
        order.billing_status = "READY"
        order.version += 1
        audit(db, module="INVOICE", action="RESTORE", entity_type="ORDER", entity_id=order.id,
              actor=user, before={"billing_status": "DELETED"}, after={"billing_status": "READY"})
        done.append(order.order_no)
    db.commit()
    return {"restored": done}
