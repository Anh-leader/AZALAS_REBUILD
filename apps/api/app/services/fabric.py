from __future__ import annotations

import uuid
from datetime import datetime, time, timezone
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core.errors import ApiError
from ..models import (
    DebtLedgerEntry,
    FabricReceipt,
    FabricReceiptLine,
    Partner,
    PartnerTransaction,
    Payment,
    User as AppUser,
    User,
)
from .materials import partner_dict
from .production import add_audit, decimal, number, refresh_party, serial


def list_suppliers(db: Session) -> list[dict]:
    rows = db.scalars(
        select(Partner)
        .where(Partner.partner_type == "FABRIC_SUPPLIER", Partner.status == "ACTIVE")
        .order_by(Partner.name)
    )
    return [partner_dict(row, db) for row in rows]


def debt_summary(db: Session) -> dict:
    suppliers = list(
        db.scalars(
            select(Partner)
            .where(Partner.partner_type == "FABRIC_SUPPLIER", Partner.status == "ACTIVE")
            .order_by(Partner.name)
        )
    )
    rows = []
    for supplier in suppliers:
        balance = int(
            db.scalar(
                select(func.coalesce(func.sum(DebtLedgerEntry.amount_delta), 0)).where(
                    DebtLedgerEntry.party_type == "PARTNER",
                    DebtLedgerEntry.party_id == supplier.id,
                )
            )
            or 0
        )
        rows.append({"supplier_id": str(supplier.id), "name": supplier.name, "balance": balance})
    return {
        "total_debt": sum(max(row["balance"], 0) for row in rows),
        "net_balance": sum(row["balance"] for row in rows),
        "supplier_count": len(rows),
        "suppliers": rows,
    }


def supplier_statement(db: Session, supplier_id: uuid.UUID) -> dict:
    supplier = db.scalar(
        select(Partner).where(
            Partner.id == supplier_id,
            Partner.partner_type == "FABRIC_SUPPLIER",
        )
    )
    if not supplier:
        raise ApiError(404, "FABRIC_SUPPLIER_NOT_FOUND", "Không tìm thấy nhà vải.")

    ledger_rows = list(
        db.scalars(
            select(DebtLedgerEntry)
            .where(
                DebtLedgerEntry.party_type == "PARTNER",
                DebtLedgerEntry.party_id == supplier_id,
            )
            .order_by(
                DebtLedgerEntry.occurred_at,
                DebtLedgerEntry.created_at,
                DebtLedgerEntry.id,
            )
        )
    )
    transaction_rows = list(
        db.scalars(
            select(PartnerTransaction)
            .where(PartnerTransaction.partner_id == supplier_id)
            .order_by(PartnerTransaction.created_at.desc())
        )
    )
    transactions_by_reference = {
        (row.reference_type, row.reference_id): row for row in transaction_rows if row.reference_id
    }
    user_ids = {row.actor_user_id for row in ledger_rows if row.actor_user_id}
    users = {
        row.id: row.display_name
        for row in db.scalars(select(AppUser).where(AppUser.id.in_(user_ids)))
    } if user_ids else {}
    receipts = list(
        db.scalars(
            select(FabricReceipt)
            .where(FabricReceipt.partner_id == supplier_id, FabricReceipt.status == "POSTED")
            .order_by(FabricReceipt.created_at.desc())
        )
    )
    receipt_creator_ids = {row.created_by for row in receipts if row.created_by}
    if receipt_creator_ids:
        users.update(
            {
                row.id: row.display_name
                for row in db.scalars(select(AppUser).where(AppUser.id.in_(receipt_creator_ids)))
            }
        )
    balance = 0
    entries = []
    for row in ledger_rows:
        balance += row.amount_delta
        transaction = transactions_by_reference.get((row.reference_type, row.reference_id))
        entries.append(
            {
                "id": str(row.id),
                "occurred_at": row.occurred_at.isoformat(),
                "entry_type": row.entry_type,
                "debit": max(row.amount_delta, 0),
                "credit": max(-row.amount_delta, 0),
                "balance": balance,
                "reference_type": row.reference_type,
                "reference_id": str(row.reference_id) if row.reference_id else None,
                "transaction_no": transaction.transaction_no if transaction else None,
                "description": row.description,
                "actor_name": users.get(row.actor_user_id),
            }
        )
    receipt_history = []
    for receipt in receipts:
        data = fabric_receipt_dict(receipt, db)
        data["created_by_name"] = users.get(receipt.created_by)
        receipt_history.append(data)
    return {
        "supplier": {
            "id": str(supplier.id),
            "name": supplier.name,
            "phone": supplier.phone,
        },
        "opening": sum(row.amount_delta for row in ledger_rows if row.entry_type == "OPENING"),
        "debit": sum(max(row.amount_delta, 0) for row in ledger_rows if row.entry_type != "OPENING"),
        "credit": sum(max(-row.amount_delta, 0) for row in ledger_rows),
        "closing": balance,
        "receipts": receipt_history,
        "entries": entries,
    }


def create_supplier(db: Session, *, name: str, phone: str | None, user: User) -> dict:
    clean_name = name.strip()
    if not clean_name:
        raise ApiError(422, "FABRIC_SUPPLIER_NAME_REQUIRED", "Tên nhà vải là bắt buộc.")
    existing = db.scalar(
        select(Partner.id).where(
            Partner.partner_type == "FABRIC_SUPPLIER",
            func.lower(Partner.name) == clean_name.lower(),
        )
    )
    if existing:
        raise ApiError(409, "FABRIC_SUPPLIER_EXISTS", "Nhà vải này đã tồn tại.")
    partner = Partner(
        partner_code=f"FABRIC-{uuid.uuid4().hex.upper()}",
        name=clean_name,
        partner_type="FABRIC_SUPPLIER",
        phone=phone.strip() if phone else None,
        status="ACTIVE",
    )
    db.add(partner)
    db.flush()
    add_audit(db, user, "MATERIALS", "CREATE", "FABRIC_SUPPLIER", partner.id,
              after={"name": clean_name, "phone": partner.phone})
    db.commit()
    return partner_dict(partner, db)


def fabric_receipt_dict(row: FabricReceipt, db: Session) -> dict:
    lines = db.scalars(
        select(FabricReceiptLine)
        .where(FabricReceiptLine.receipt_id == row.id)
        .order_by(FabricReceiptLine.line_number)
    )
    return {
        "id": str(row.id),
        "receipt_no": row.receipt_no,
        "supplier_id": str(row.partner_id),
        "total_amount": row.total_amount,
        "status": row.status,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "lines": [
            {
                "id": str(line.id),
                "entry_type": line.entry_type,
                "receipt_date": line.receipt_date.isoformat(),
                "fabric_name": line.fabric_name,
                "unit": line.unit,
                "roll_count": serial(line.roll_count),
                "gross_quantity": serial(line.gross_quantity),
                "wastage_quantity": serial(line.wastage_quantity),
                "net_quantity": serial(line.net_quantity),
                "deduction_enabled": line.deduction_enabled,
                "unit_price_amount": line.unit_price_amount,
                "transport_amount": line.transport_amount,
                "amount": line.amount,
            }
            for line in lines
        ],
    }


def create_receipt(
    db: Session, *, supplier_id: uuid.UUID, lines: list[dict], idempotency_key: str, user: User
) -> dict:
    existing = db.scalar(
        select(FabricReceipt).where(FabricReceipt.idempotency_key == idempotency_key)
    )
    if existing:
        return fabric_receipt_dict(existing, db)

    supplier = db.scalar(
        select(Partner)
        .where(
            Partner.id == supplier_id,
            Partner.partner_type == "FABRIC_SUPPLIER",
            Partner.status == "ACTIVE",
        )
        .with_for_update()
    )
    if not supplier:
        raise ApiError(422, "FABRIC_SUPPLIER_INVALID", "Nhà vải không hợp lệ hoặc đã ngừng hoạt động.")
    if not lines:
        raise ApiError(422, "FABRIC_RECEIPT_EMPTY", "Phiếu phải có ít nhất một dòng nhập hoặc trả vải.")

    prepared: list[dict] = []
    total = 0
    for line_number, item in enumerate(lines, start=1):
        entry_type = item["entry_type"]
        unit = item["unit"]
        if entry_type not in ("PURCHASE", "RETURN") or unit not in ("KG", "METER"):
            raise ApiError(422, "FABRIC_LINE_INVALID", "Loại giao dịch hoặc đơn vị vải không hợp lệ.")

        fabric_name = str(item["fabric_name"]).strip()
        if not fabric_name:
            raise ApiError(422, "FABRIC_NAME_REQUIRED", "Tên vải là bắt buộc.")
        rolls = decimal(item["roll_count"])
        gross = decimal(item["gross_quantity"], positive=True)
        price = int(item["unit_price_amount"])
        transport = int(item.get("transport_amount") or 0)
        if rolls < 0 or price < 0:
            raise ApiError(422, "FABRIC_LINE_INVALID", "Số cây và đơn giá không được âm.")
        if entry_type == "RETURN" and transport:
            raise ApiError(422, "FABRIC_RETURN_TRANSPORT_INVALID", "Hàng trả không được có tiền xe.")

        deduction_enabled = (
            entry_type == "PURCHASE"
            and unit == "KG"
            and bool(item.get("deduction_enabled", True))
        )
        wastage = rolls * Decimal("0.3") if deduction_enabled else Decimal(0)
        net = gross - wastage
        if net < 0:
            raise ApiError(422, "FABRIC_WASTAGE_EXCEEDS_QUANTITY", "Khấu hao không thể lớn hơn số kg nhập.")
        fabric_amount = int((net * price).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        if entry_type == "RETURN":
            fabric_amount = -fabric_amount
        amount = fabric_amount + transport
        total += amount
        if abs(amount) > 9_223_372_036_854_775_807 or abs(total) > 9_223_372_036_854_775_807:
            raise ApiError(422, "FABRIC_AMOUNT_TOO_LARGE", "Tổng tiền phiếu vượt giới hạn lưu trữ.")
        prepared.append(
            {
                "line_number": line_number,
                "entry_type": entry_type,
                "receipt_date": item["receipt_date"],
                "fabric_name": fabric_name,
                "unit": unit,
                "roll_count": rolls,
                "gross_quantity": gross,
                "wastage_quantity": wastage,
                "net_quantity": net,
                "deduction_enabled": deduction_enabled,
                "unit_price_amount": price,
                "transport_amount": transport,
                "amount": amount,
            }
        )

    receipt = FabricReceipt(
        receipt_no=number("VAI"),
        partner_id=supplier.id,
        total_amount=total,
        created_by=user.id,
        idempotency_key=idempotency_key,
    )
    db.add(receipt)
    db.flush()
    for item in prepared:
        db.add(FabricReceiptLine(receipt_id=receipt.id, **item))

    if total:
        occurred_at = datetime.combine(
            max(item["receipt_date"] for item in prepared), time.min, tzinfo=timezone.utc
        )
        direction = "DEBIT" if total > 0 else "CREDIT"
        transaction = PartnerTransaction(
            transaction_no=number("PGD"),
            partner_id=supplier.id,
            direction=direction,
            transaction_type="FABRIC_RECEIPT",
            amount=abs(total),
            reference_type="FABRIC_RECEIPT",
            reference_id=receipt.id,
            occurred_at=occurred_at,
            description=f"Phiếu nhập vải {receipt.receipt_no}",
            created_by=user.id,
            idempotency_key=f"{idempotency_key}:transaction",
        )
        db.add(transaction)
        db.add(
            DebtLedgerEntry(
                party_type="PARTNER",
                party_id=supplier.id,
                occurred_at=occurred_at,
                entry_type="FABRIC_RECEIPT",
                amount_delta=total,
                reference_type="FABRIC_RECEIPT",
                reference_id=receipt.id,
                description=f"Phiếu nhập vải {receipt.receipt_no}",
                actor_user_id=user.id,
                idempotency_key=f"{idempotency_key}:debt",
            )
        )

    db.flush()
    refresh_party(db, "PARTNER", supplier.id)
    add_audit(
        db,
        user,
        "MATERIALS",
        "FABRIC_RECEIPT",
        "FABRIC_RECEIPT",
        receipt.id,
        idempotency_key,
        after={"supplier_id": str(supplier.id), "total_amount": total, "line_count": len(prepared)},
    )
    db.commit()
    return fabric_receipt_dict(receipt, db)


def create_payments(
    db: Session,
    *,
    supplier_id: uuid.UUID,
    payments: list[dict],
    idempotency_key: str,
    user: User,
) -> list[dict]:
    if not idempotency_key.strip() or len(idempotency_key) > 77:
        raise ApiError(422, "IDEMPOTENCY_KEY_INVALID", "Mã chống ghi trùng giao dịch không hợp lệ.")
    supplier = db.scalar(
        select(Partner)
        .where(
            Partner.id == supplier_id,
            Partner.partner_type == "FABRIC_SUPPLIER",
            Partner.status == "ACTIVE",
        )
        .with_for_update()
    )
    if not supplier:
        raise ApiError(422, "FABRIC_SUPPLIER_INVALID", "Nhà vải không hợp lệ hoặc đã ngừng hoạt động.")
    if not payments:
        raise ApiError(422, "FABRIC_PAYMENT_EMPTY", "Cần ít nhất một dòng thanh toán.")

    key_prefix = f"{idempotency_key}:payment:"
    payment_keys = [f"{key_prefix}{index}" for index in range(len(payments))]
    prepared = []
    for index, item in enumerate(payments):
        amount = int(item["amount"])
        method = item["method"]
        if amount <= 0 or method not in ("CASH", "BANK_TRANSFER", "OTHER"):
            raise ApiError(422, "FABRIC_PAYMENT_INVALID", "Ngày, phương thức hoặc số tiền thanh toán không hợp lệ.")
        prepared.append(
            {
                "idempotency_key": payment_keys[index],
                "payment_date": item["payment_date"],
                "paid_at": datetime.combine(item["payment_date"], time.min, tzinfo=timezone.utc),
                "amount": amount,
                "method": method,
                "note": (item.get("note") or "").strip() or None,
            }
        )
    existing = list(
        db.scalars(
            select(Payment).where(Payment.idempotency_key.in_(payment_keys))
        )
    )
    if existing:
        existing_by_key = {row.idempotency_key: row for row in existing}
        if len(existing) != len(payments):
            raise ApiError(409, "FABRIC_PAYMENT_IDEMPOTENCY_CONFLICT", "Mã yêu cầu đã được dùng cho nội dung thanh toán khác.")
        for item in prepared:
            row = existing_by_key.get(item["idempotency_key"])
            if (
                row is None
                or row.supplier_id != supplier_id
                or row.paid_at.date() != item["payment_date"]
                or row.amount != item["amount"]
                or row.method != item["method"]
                or row.note != item["note"]
            ):
                raise ApiError(409, "FABRIC_PAYMENT_IDEMPOTENCY_CONFLICT", "Mã yêu cầu đã được dùng cho nội dung thanh toán khác.")
        return [fabric_payment_dict(existing_by_key[key]) for key in payment_keys]

    created = []
    for item in prepared:
        amount = item["amount"]
        payment_key = item["idempotency_key"]
        paid_at = item["paid_at"]
        payment = Payment(
            payment_no=number("PAY"),
            party_type="PARTNER",
            supplier_id=supplier.id,
            paid_at=paid_at,
            amount=amount,
            method=item["method"],
            direction="PAYMENT",
            received_or_paid_by=user.id,
            note=item["note"],
            status="POSTED",
            idempotency_key=payment_key,
        )
        db.add(payment)
        db.flush()
        transaction = PartnerTransaction(
            transaction_no=number("PGD"),
            partner_id=supplier.id,
            direction="CREDIT",
            transaction_type="FABRIC_PAYMENT",
            amount=amount,
            reference_type="PAYMENT",
            reference_id=payment.id,
            occurred_at=paid_at,
            description=item["note"] or f"Thanh toán vải {payment.payment_no}",
            created_by=user.id,
            idempotency_key=f"{payment_key}:transaction",
        )
        db.add(transaction)
        db.add(
            DebtLedgerEntry(
                party_type="PARTNER",
                party_id=supplier.id,
                occurred_at=paid_at,
                entry_type="FABRIC_PAYMENT",
                amount_delta=-amount,
                reference_type="PAYMENT",
                reference_id=payment.id,
                description=item["note"] or f"Thanh toán vải {payment.payment_no}",
                actor_user_id=user.id,
                idempotency_key=f"{payment_key}:debt",
            )
        )
        created.append(payment)

    db.flush()
    refresh_party(db, "PARTNER", supplier.id)
    add_audit(
        db,
        user,
        "MATERIALS",
        "FABRIC_PAYMENT",
        "PARTNER",
        supplier.id,
        idempotency_key,
        after={
            "payment_count": len(created),
            "total_amount": sum(row.amount for row in created),
        },
    )
    db.commit()
    return [fabric_payment_dict(row) for row in created]


def fabric_payment_dict(row: Payment) -> dict:
    return {
        "id": str(row.id),
        "payment_no": row.payment_no,
        "supplier_id": str(row.supplier_id),
        "payment_date": row.paid_at.date().isoformat(),
        "amount": row.amount,
        "method": row.method,
        "note": row.note,
        "status": row.status,
    }
