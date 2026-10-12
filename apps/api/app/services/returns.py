from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.errors import ApiError
from ..models import (
    Customer, DebtLedgerEntry, InventoryBalance, InventoryTransaction, ProductVariant,
    Payment, ReturnItem, ReturnRecord, User, Warehouse,
)
from .finance import _number, _serial, audit, refresh_debt_projection


def _qty(value) -> Decimal:
    try:
        result = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ApiError(422, "INVALID_QUANTITY", "Số lượng hàng trả không hợp lệ.") from exc
    if not result.is_finite() or result <= 0 or result.as_tuple().exponent < -3:
        raise ApiError(422, "INVALID_QUANTITY", "Số lượng hàng trả phải dương và tối đa 3 số lẻ.")
    return result


def return_dict(row: ReturnRecord, db: Session) -> dict:
    items = list(db.scalars(select(ReturnItem).where(ReturnItem.return_id == row.id).order_by(ReturnItem.id)))
    customer = db.get(Customer, row.customer_id)
    warehouse = db.get(Warehouse, row.warehouse_id)
    return {
        "id": str(row.id), "return_no": row.return_no, "customer_id": str(row.customer_id),
        "customer_name": customer.name if customer else None,
        "warehouse": {"id": str(warehouse.id), "code": warehouse.code, "name": warehouse.name} if warehouse else None,
        "status": row.status, "total_credit_amount": row.total_credit_amount,
        "restock_posted": row.restock_posted, "credit_posted": row.credit_posted,
        "note": row.note, "version": row.version,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "approved_at": row.approved_at.isoformat() if row.approved_at else None,
        "items": [{"id": str(item.id), "product_variant_id": str(item.product_variant_id) if item.product_variant_id else None,
                   "description": item.description_snapshot, "quantity": _serial(item.quantity),
                   "unit_credit_amount": item.unit_credit_amount, "line_credit_amount": item.line_credit_amount,
                   "condition": item.condition, "restock": item.restock} for item in items],
    }


def create_return(db: Session, *, customer_id: uuid.UUID, warehouse_id: uuid.UUID,
                  items: list[dict], note: str | None, user: User) -> dict:
    if not db.get(Customer, customer_id):
        raise ApiError(404, "CUSTOMER_NOT_FOUND", "Không tìm thấy khách hàng.")
    if not db.get(Warehouse, warehouse_id):
        raise ApiError(404, "WAREHOUSE_NOT_FOUND", "Không tìm thấy kho.")
    if not items:
        raise ApiError(422, "RETURN_ITEMS_REQUIRED", "Phiếu hàng trả cần ít nhất một dòng.")
    normalized = []
    for raw in items:
        qty = _qty(raw.get("quantity"))
        price = int(raw.get("unit_credit_amount") or 0)
        if price < 0:
            raise ApiError(422, "INVALID_RETURN_CREDIT", "Giá trị hoàn không được âm.")
        total = qty * price
        if total != total.to_integral_value():
            raise ApiError(422, "MONEY_FRACTION", "Thành tiền hoàn phải là số VND nguyên.")
        variant_id = raw.get("product_variant_id")
        variant = db.get(ProductVariant, variant_id) if variant_id else None
        if variant_id and not variant:
            raise ApiError(422, "VARIANT_NOT_FOUND", "Sản phẩm hàng trả không tồn tại.")
        description = str(raw.get("description") or (variant.display_name if variant else "")).strip()
        if not description:
            raise ApiError(422, "RETURN_DESCRIPTION_REQUIRED", "Thiếu mô tả hàng trả.")
        normalized.append((raw, variant, qty, price, int(total), description))
    row = ReturnRecord(return_no=_number("RET"), customer_id=customer_id, warehouse_id=warehouse_id,
                       status="NEW", total_credit_amount=sum(item[4] for item in normalized),
                       note=(note or "").strip() or None, created_by=user.id)
    db.add(row)
    db.flush()
    for raw, variant, qty, price, total, description in normalized:
        db.add(ReturnItem(return_id=row.id, product_variant_id=variant.id if variant else None,
                          description_snapshot=description, quantity=qty, unit_credit_amount=price,
                          line_credit_amount=total, condition=(raw.get("condition") or "").strip() or None,
                          restock=bool(raw.get("restock", True))))
    audit(db, module="RETURNS", action="CREATE", entity_type="RETURN", entity_id=row.id,
          actor=user, after={"total_credit_amount": row.total_credit_amount})
    db.commit()
    return return_dict(row, db)


def update_return(db: Session, *, return_id: uuid.UUID, version: int, items: list[dict] | None,
                  note: str | None, user: User) -> dict:
    row = db.scalar(select(ReturnRecord).where(ReturnRecord.id == return_id).with_for_update(of=ReturnRecord))
    if not row:
        raise ApiError(404, "RETURN_NOT_FOUND", "Không tìm thấy phiếu hàng trả.")
    if row.status != "NEW":
        raise ApiError(409, "RETURN_ALREADY_POSTED", "Chỉ phiếu mới được chỉnh sửa.")
    if row.version != version:
        raise ApiError(409, "VERSION_CONFLICT", "Phiếu đã thay đổi, vui lòng tải lại.", {"current_version": row.version})
    if items is not None:
        # NEW documents have no ledger yet, so replacing draft lines is safe.
        for item in list(db.scalars(select(ReturnItem).where(ReturnItem.return_id == row.id))):
            db.delete(item)
        db.flush()
        row.total_credit_amount = 0
        for raw in items:
            qty = _qty(raw.get("quantity")); price = int(raw.get("unit_credit_amount") or 0)
            variant = db.get(ProductVariant, raw.get("product_variant_id")) if raw.get("product_variant_id") else None
            description = str(raw.get("description") or (variant.display_name if variant else "")).strip()
            total = qty * price
            if price < 0 or not description or total != total.to_integral_value():
                raise ApiError(422, "INVALID_RETURN_ITEM", "Dòng hàng trả không hợp lệ.")
            db.add(ReturnItem(return_id=row.id, product_variant_id=variant.id if variant else None,
                              description_snapshot=description, quantity=qty, unit_credit_amount=price,
                              line_credit_amount=int(total), condition=(raw.get("condition") or "").strip() or None,
                              restock=bool(raw.get("restock", True))))
            row.total_credit_amount += int(total)
    row.note = (note or "").strip() or None
    row.version += 1
    audit(db, module="RETURNS", action="UPDATE", entity_type="RETURN", entity_id=row.id,
          actor=user, after={"version": row.version, "total_credit_amount": row.total_credit_amount})
    db.commit()
    return return_dict(row, db)


def approve_return(db: Session, *, return_id: uuid.UUID, restock: bool, credit: bool,
                   version: int, idempotency_key: str, user: User) -> dict:
    row = db.scalar(select(ReturnRecord).where(ReturnRecord.id == return_id).with_for_update(of=ReturnRecord))
    if not row:
        raise ApiError(404, "RETURN_NOT_FOUND", "Không tìm thấy phiếu hàng trả.")
    if row.approval_idempotency_key == idempotency_key and row.status in ("APPROVED", "CREDITED"):
        return return_dict(row, db)
    if row.status != "NEW":
        raise ApiError(409, "RETURN_ALREADY_APPROVED", "Phiếu hàng trả đã được duyệt hoặc hủy.")
    if row.version != version:
        raise ApiError(409, "VERSION_CONFLICT", "Phiếu đã thay đổi, vui lòng tải lại.", {"current_version": row.version})
    if not restock and not credit:
        raise ApiError(422, "RETURN_ACTION_REQUIRED", "Cần chọn nhập lại tồn hoặc ghi giảm công nợ.")
    if credit and row.total_credit_amount <= 0:
        raise ApiError(422, "RETURN_CREDIT_ZERO", "Phiếu không có giá trị để ghi giảm công nợ.")
    items = list(db.scalars(select(ReturnItem).where(ReturnItem.return_id == row.id).order_by(ReturnItem.id)))
    if restock:
        for item in items:
            if not item.restock or not item.product_variant_id:
                continue
            balance = db.scalar(select(InventoryBalance).where(
                InventoryBalance.variant_id == item.product_variant_id,
                InventoryBalance.warehouse_id == row.warehouse_id,
                InventoryBalance.location_id.is_(None),
            ).with_for_update(of=InventoryBalance))
            if not balance:
                balance = InventoryBalance(variant_id=item.product_variant_id, warehouse_id=row.warehouse_id,
                                           location_id=None, on_hand=0, reserved=0, available=0,
                                           pending_finish=0, cut_separated=0, defective=0)
                db.add(balance); db.flush()
            balance.on_hand += item.quantity
            balance.available = balance.on_hand - balance.reserved
            balance.version += 1
            db.add(InventoryTransaction(
                transaction_no=_number("STK"), transaction_type="RETURN_RESTOCK",
                reference_type="RETURN", reference_id=row.id, variant_id=item.product_variant_id,
                warehouse_id=row.warehouse_id, location_id=None, quantity_delta=item.quantity,
                reservation_delta=0, balance_after=balance.on_hand, actor_user_id=user.id,
                notes=f"Nhập hàng trả {row.return_no}",
                idempotency_key=f"{idempotency_key}:stock:{item.id}",
            ))
        row.restock_posted = True
    if credit:
        payment = Payment(
            payment_no=_number("PAY"), party_type="CUSTOMER", customer_id=row.customer_id,
            paid_at=datetime.now(timezone.utc), amount=row.total_credit_amount, method="RETURN_CREDIT",
            direction="RECEIPT", received_or_paid_by=user.id, note=f"Hàng trả {row.return_no}",
            status="POSTED", idempotency_key=f"{idempotency_key}:payment",
        )
        db.add(payment); db.flush()
        db.add(DebtLedgerEntry(
            party_type="CUSTOMER", party_id=row.customer_id, entry_type="RETURN_CREDIT",
            amount_delta=-row.total_credit_amount, reference_type="RETURN", reference_id=row.id,
            description=f"Duyệt hàng trả {row.return_no}", actor_user_id=user.id,
            idempotency_key=f"{idempotency_key}:debt",
        ))
        row.credit_posted = True
    row.status = "CREDITED" if credit else "APPROVED"
    row.approved_by = user.id
    row.approved_at = datetime.now(timezone.utc)
    row.approval_idempotency_key = idempotency_key
    row.version += 1
    db.flush()
    if credit:
        refresh_debt_projection(db, row.customer_id)
    audit(db, module="RETURNS", action="APPROVE", entity_type="RETURN", entity_id=row.id,
          actor=user, after={"restock": restock, "credit": credit}, request_id=idempotency_key)
    db.commit()
    return return_dict(row, db)


def cancel_return(db: Session, *, return_id: uuid.UUID, version: int,
                  idempotency_key: str, user: User) -> dict:
    row = db.scalar(select(ReturnRecord).where(ReturnRecord.id == return_id).with_for_update(of=ReturnRecord))
    if not row:
        raise ApiError(404, "RETURN_NOT_FOUND", "Không tìm thấy phiếu hàng trả.")
    if row.cancel_idempotency_key == idempotency_key and row.status == "CANCELLED":
        return return_dict(row, db)
    if row.status == "CANCELLED":
        raise ApiError(409, "RETURN_ALREADY_CANCELLED", "Phiếu đã được hủy.")
    if row.version != version:
        raise ApiError(409, "VERSION_CONFLICT", "Phiếu đã thay đổi, vui lòng tải lại.", {"current_version": row.version})
    if row.restock_posted:
        originals = list(db.scalars(select(InventoryTransaction).where(
            InventoryTransaction.reference_type == "RETURN", InventoryTransaction.reference_id == row.id,
            InventoryTransaction.transaction_type == "RETURN_RESTOCK",
        ).order_by(InventoryTransaction.id)))
        for original in originals:
            balance = db.scalar(select(InventoryBalance).where(
                InventoryBalance.variant_id == original.variant_id,
                InventoryBalance.warehouse_id == original.warehouse_id,
                InventoryBalance.location_id.is_(None) if original.location_id is None else InventoryBalance.location_id == original.location_id,
            ).with_for_update(of=InventoryBalance))
            if not balance or balance.on_hand - balance.reserved < original.quantity_delta:
                raise ApiError(409, "RETURN_STOCK_ALREADY_USED", "Hàng đã được dùng/giữ, không thể đảo phiếu trả.")
            balance.on_hand -= original.quantity_delta
            balance.available = balance.on_hand - balance.reserved
            balance.version += 1
            db.add(InventoryTransaction(
                transaction_no=_number("STK"), transaction_type="RETURN_CANCEL_REVERSAL",
                reference_type="RETURN", reference_id=row.id, variant_id=original.variant_id,
                warehouse_id=original.warehouse_id, location_id=original.location_id,
                quantity_delta=-original.quantity_delta, reservation_delta=0,
                balance_after=balance.on_hand, actor_user_id=user.id,
                reversal_of_id=original.id, notes=f"Đảo phiếu {row.return_no}",
                idempotency_key=f"{idempotency_key}:stock:{original.id}",
            ))
    if row.credit_posted:
        original_debt = db.scalar(select(DebtLedgerEntry).where(
            DebtLedgerEntry.reference_type == "RETURN", DebtLedgerEntry.reference_id == row.id,
            DebtLedgerEntry.entry_type == "RETURN_CREDIT",
        ))
        if original_debt:
            db.add(DebtLedgerEntry(
                party_type="CUSTOMER", party_id=row.customer_id, entry_type="RETURN_CREDIT_REVERSAL",
                amount_delta=-original_debt.amount_delta, reference_type="RETURN", reference_id=row.id,
                description=f"Đảo hàng trả {row.return_no}", reversal_of_id=original_debt.id,
                actor_user_id=user.id, idempotency_key=f"{idempotency_key}:debt",
            ))
    row.status = "CANCELLED"
    row.cancelled_by = user.id
    row.cancelled_at = datetime.now(timezone.utc)
    row.cancel_idempotency_key = idempotency_key
    row.version += 1
    db.flush()
    if row.credit_posted:
        refresh_debt_projection(db, row.customer_id)
    audit(db, module="RETURNS", action="CANCEL", entity_type="RETURN", entity_id=row.id,
          actor=user, after={"status": "CANCELLED"}, request_id=idempotency_key)
    db.commit()
    return return_dict(row, db)
