from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core.errors import ApiError
from ..models import (DebtLedgerEntry, Material, MaterialReceipt, MaterialReceiptLine, MaterialVariant,
                      MediaObject, Partner, PartnerFile, PartnerSettlement, PartnerSettlementLine,
                      PartnerTransaction, Payment, PaymentAllocation, User)
from .production import add_audit, decimal, number, refresh_party, serial


def partner_dict(row: Partner, db: Session) -> dict:
    debt = int(db.scalar(select(func.coalesce(func.sum(DebtLedgerEntry.amount_delta), 0)).where(
        DebtLedgerEntry.party_type == "PARTNER", DebtLedgerEntry.party_id == row.id)) or 0)
    return {"id": str(row.id), "partner_code": row.partner_code, "name": row.name,
            "partner_type": row.partner_type, "phone": row.phone, "address": row.address,
            "status": row.status, "notes": row.notes, "debt_amount": debt}


def list_partners(db: Session, q: str | None, partner_type: str | None, status: str | None) -> list[dict]:
    stmt = select(Partner).order_by(Partner.name)
    if partner_type: stmt = stmt.where(Partner.partner_type == partner_type)
    if status: stmt = stmt.where(Partner.status == status)
    rows = list(db.scalars(stmt)); needle = (q or "").strip().casefold()
    if needle: rows = [row for row in rows if needle in row.name.casefold() or needle in row.partner_code.casefold()]
    return [partner_dict(row, db) for row in rows]


def create_partner(db: Session, *, data: dict, user: User) -> dict:
    code = str(data.get("partner_code") or "").strip(); name = str(data.get("name") or "").strip()
    if not code or not name: raise ApiError(422, "PARTNER_FIELDS_REQUIRED", "Mã và tên đối tác là bắt buộc.")
    if db.scalar(select(Partner.id).where((Partner.partner_code == code) | (func.lower(Partner.name) == name.lower()))):
        raise ApiError(409, "PARTNER_EXISTS", "Mã hoặc tên đối tác đã tồn tại.")
    row = Partner(partner_code=code, name=name, partner_type=data["partner_type"], phone=data.get("phone"),
                  address=data.get("address"), notes=data.get("notes"), status="ACTIVE")
    db.add(row); db.flush(); add_audit(db, user, "MATERIALS", "CREATE", "PARTNER", row.id, after={"code": code, "name": name}); db.commit()
    return partner_dict(row, db)


def update_partner(db: Session, partner_id: uuid.UUID, *, values: dict, user: User) -> dict:
    row = db.scalar(select(Partner).where(Partner.id == partner_id).with_for_update(of=Partner))
    if not row: raise ApiError(404, "PARTNER_NOT_FOUND", "Không tìm thấy đối tác.")
    before = {key: getattr(row, key) for key in values}
    for key, value in values.items(): setattr(row, key, value.strip() if isinstance(value, str) else value)
    add_audit(db, user, "MATERIALS", "UPDATE", "PARTNER", row.id, before=before, after=values); db.commit()
    return partner_dict(row, db)


def material_dict(row: Material, db: Session) -> dict:
    variants = list(db.scalars(select(MaterialVariant).where(MaterialVariant.material_id == row.id).order_by(MaterialVariant.display_name)))
    return {"id": str(row.id), "material_code": row.material_code, "name": row.name, "category": row.category,
            "unit": row.unit, "status": row.status, "notes": row.notes,
            "variants": [{"id": str(v.id), "color_id": str(v.color_id) if v.color_id else None,
                          "size": v.size, "display_name": v.display_name, "status": v.status} for v in variants]}


def create_material(db: Session, *, data: dict, user: User) -> dict:
    code = data["material_code"].strip()
    if db.scalar(select(Material.id).where(Material.material_code == code)):
        raise ApiError(409, "MATERIAL_EXISTS", "Mã vật tư đã tồn tại.")
    row = Material(material_code=code, name=data["name"].strip(), category=data["category"], unit=data["unit"], notes=data.get("notes"))
    db.add(row); db.flush()
    variants = data.get("variants") or [{"display_name": row.name, "color_id": None, "size": None}]
    for item in variants:
        db.add(MaterialVariant(material_id=row.id, color_id=item.get("color_id"), size=item.get("size"),
                               display_name=str(item.get("display_name") or row.name).strip()))
    add_audit(db, user, "MATERIALS", "CREATE", "MATERIAL", row.id, after={"code": code, "variant_count": len(variants)}); db.commit()
    return material_dict(row, db)


def update_material(db: Session, material_id: uuid.UUID, *, values: dict, user: User) -> dict:
    row = db.scalar(select(Material).where(Material.id == material_id).with_for_update(of=Material))
    if not row: raise ApiError(404, "MATERIAL_NOT_FOUND", "Không tìm thấy vật tư.")
    before = {key: getattr(row, key) for key in values}
    for key, value in values.items(): setattr(row, key, value.strip() if isinstance(value, str) else value)
    add_audit(db, user, "MATERIALS", "UPDATE", "MATERIAL", row.id, before=before, after=values); db.commit()
    return material_dict(row, db)


def list_materials(db: Session, q: str | None, category: str | None) -> list[dict]:
    stmt = select(Material).order_by(Material.name)
    if category: stmt = stmt.where(Material.category == category)
    rows = list(db.scalars(stmt)); needle = (q or "").strip().casefold()
    if needle: rows = [row for row in rows if needle in row.name.casefold() or needle in row.material_code.casefold()]
    return [material_dict(row, db) for row in rows]


def receipt_dict(row: MaterialReceipt, db: Session) -> dict:
    lines = list(db.scalars(select(MaterialReceiptLine).where(MaterialReceiptLine.receipt_id == row.id)))
    return {"id": str(row.id), "receipt_no": row.receipt_no, "receipt_date": row.receipt_date.isoformat(),
            "partner_id": str(row.partner_id), "category": row.category, "freight_amount": row.freight_amount,
            "subtotal_amount": row.subtotal_amount, "total_amount": row.total_amount, "paid_amount": row.paid_amount,
            "balance_amount": row.balance_amount, "status": row.status, "notes": row.notes, "version": row.version,
            "lines": [{"id": str(line.id), "material_variant_id": str(line.material_variant_id),
                       "quantity": serial(line.quantity), "weight": serial(line.weight) if line.weight is not None else None,
                       "unit_price_amount": line.unit_price_amount, "amount": line.amount, "notes": line.notes} for line in lines]}


def create_receipt(db: Session, *, data: dict, idempotency_key: str, user: User) -> dict:
    existing = db.scalar(select(MaterialReceipt).where(MaterialReceipt.idempotency_key == idempotency_key))
    if existing: return receipt_dict(existing, db)
    partner = db.get(Partner, data["partner_id"])
    if not partner or partner.status != "ACTIVE": raise ApiError(422, "PARTNER_INVALID", "Đối tác không hợp lệ.")
    freight = int(data.get("freight_amount") or 0); paid = int(data.get("paid_amount") or 0)
    if freight < 0 or paid < 0: raise ApiError(422, "MONEY_INVALID", "Cước và số đã trả không được âm.")
    prepared = []
    for item in data["lines"]:
        variant = db.get(MaterialVariant, item["material_variant_id"])
        if not variant or variant.status != "ACTIVE": raise ApiError(422, "MATERIAL_VARIANT_INVALID", "Có biến thể vật tư không hợp lệ.")
        qty = decimal(item["quantity"], positive=True); price = int(item["unit_price_amount"])
        amount = qty * price
        if price <= 0 or amount != amount.to_integral_value(): raise ApiError(422, "MATERIAL_LINE_MONEY_INVALID", "Thành tiền vật tư phải là VND nguyên dương.")
        prepared.append((item, qty, int(amount)))
    subtotal = sum(item[2] for item in prepared); total = subtotal + freight
    row = MaterialReceipt(receipt_no=number("NVT"), receipt_date=data["receipt_date"], partner_id=partner.id,
                          category=data["category"], freight_amount=freight, subtotal_amount=subtotal, total_amount=total,
                          paid_amount=paid, balance_amount=max(total - paid, 0), received_by=user.id,
                          notes=data.get("notes"), idempotency_key=idempotency_key)
    db.add(row); db.flush()
    for item, qty, amount in prepared:
        db.add(MaterialReceiptLine(receipt_id=row.id, material_variant_id=item["material_variant_id"], quantity=qty,
                                   weight=decimal(item["weight"]) if item.get("weight") is not None else None,
                                   unit_price_amount=int(item["unit_price_amount"]), amount=amount, notes=item.get("notes")))
    transaction = PartnerTransaction(transaction_no=number("PGD"), partner_id=partner.id, direction="DEBIT",
        transaction_type="MATERIAL_RECEIPT", amount=total, reference_type="MATERIAL_RECEIPT", reference_id=row.id,
        occurred_at=datetime.combine(data["receipt_date"], datetime.min.time(), tzinfo=timezone.utc),
        description=f"Phiếu nhập {row.receipt_no}", created_by=user.id, idempotency_key=f"{idempotency_key}:transaction")
    db.add(transaction)
    db.add(DebtLedgerEntry(party_type="PARTNER", party_id=partner.id, entry_type="MATERIAL_RECEIPT", amount_delta=total,
        reference_type="MATERIAL_RECEIPT", reference_id=row.id, description=f"Phiếu nhập {row.receipt_no}",
        actor_user_id=user.id, idempotency_key=f"{idempotency_key}:debit"))
    if paid:
        payment = Payment(payment_no=number("PAY"), party_type="PARTNER", supplier_id=partner.id, paid_at=datetime.now(timezone.utc),
            amount=paid, method=data.get("payment_method") or "OTHER", direction="PAYMENT", received_or_paid_by=user.id,
            note=f"Thanh toán khi nhập {row.receipt_no}", status="POSTED", idempotency_key=f"{idempotency_key}:payment")
        db.add(payment); db.flush()
        allocated = min(paid, total)
        if allocated: db.add(PaymentAllocation(payment_id=payment.id, target_type="MATERIAL_RECEIPT", target_id=row.id, allocated_amount=allocated))
        db.add(DebtLedgerEntry(party_type="PARTNER", party_id=partner.id, entry_type="PARTNER_PAYMENT", amount_delta=-paid,
            reference_type="PAYMENT", reference_id=payment.id, description=payment.note, actor_user_id=user.id,
            idempotency_key=f"{idempotency_key}:credit"))
    db.flush(); refresh_party(db, "PARTNER", partner.id)
    add_audit(db, user, "MATERIALS", "RECEIPT", "MATERIAL_RECEIPT", row.id, idempotency_key,
              after={"subtotal_amount": subtotal, "freight_amount": freight, "total_amount": total, "paid_amount": paid})
    db.commit(); return receipt_dict(row, db)


def list_receipts(db: Session, partner_id: uuid.UUID | None, category: str | None, date_from: date | None, date_to: date | None) -> list[dict]:
    stmt = select(MaterialReceipt).order_by(MaterialReceipt.receipt_date.desc(), MaterialReceipt.created_at.desc())
    if partner_id: stmt = stmt.where(MaterialReceipt.partner_id == partner_id)
    if category: stmt = stmt.where(MaterialReceipt.category == category)
    if date_from: stmt = stmt.where(MaterialReceipt.receipt_date >= date_from)
    if date_to: stmt = stmt.where(MaterialReceipt.receipt_date <= date_to)
    return [receipt_dict(row, db) for row in db.scalars(stmt)]


def create_transaction(db: Session, *, partner_id: uuid.UUID, transaction_type: str, direction: str,
                       amount: int, occurred_at: datetime, description: str | None,
                       idempotency_key: str, user: User) -> dict:
    existing = db.scalar(select(PartnerTransaction).where(PartnerTransaction.idempotency_key == idempotency_key))
    if existing: return transaction_dict(existing)
    if not db.get(Partner, partner_id): raise ApiError(404, "PARTNER_NOT_FOUND", "Không tìm thấy đối tác.")
    if direction not in ("DEBIT", "CREDIT") or amount <= 0: raise ApiError(422, "TRANSACTION_INVALID", "Chiều và số tiền giao dịch không hợp lệ.")
    row = PartnerTransaction(transaction_no=number("PGD"), partner_id=partner_id, direction=direction,
        transaction_type=transaction_type, amount=amount, occurred_at=occurred_at, description=description,
        status="POSTED", created_by=user.id, idempotency_key=idempotency_key)
    db.add(row); db.flush()
    delta = amount if direction == "DEBIT" else -amount
    db.add(DebtLedgerEntry(party_type="PARTNER", party_id=partner_id, entry_type=transaction_type, amount_delta=delta,
        reference_type="PARTNER_TRANSACTION", reference_id=row.id, description=description or row.transaction_no,
        actor_user_id=user.id, idempotency_key=f"{idempotency_key}:debt"))
    db.flush(); refresh_party(db, "PARTNER", partner_id); add_audit(db, user, "MATERIALS", "TRANSACTION", "PARTNER_TRANSACTION", row.id, idempotency_key, after={"direction": direction, "amount": amount}); db.commit()
    return transaction_dict(row)


def transaction_dict(row: PartnerTransaction) -> dict:
    return {"id": str(row.id), "transaction_no": row.transaction_no, "partner_id": str(row.partner_id),
            "direction": row.direction, "transaction_type": row.transaction_type, "amount": row.amount,
            "occurred_at": row.occurred_at.isoformat(), "description": row.description,
            "settlement_id": str(row.settlement_id) if row.settlement_id else None, "status": row.status}


def list_transactions(db: Session, partner_id: uuid.UUID | None, transaction_type: str | None,
                      unsettled: bool) -> list[dict]:
    stmt = select(PartnerTransaction).order_by(PartnerTransaction.occurred_at.desc(), PartnerTransaction.created_at.desc())
    if partner_id: stmt = stmt.where(PartnerTransaction.partner_id == partner_id)
    if transaction_type: stmt = stmt.where(PartnerTransaction.transaction_type == transaction_type)
    if unsettled: stmt = stmt.where(PartnerTransaction.settlement_id.is_(None), PartnerTransaction.direction == "DEBIT")
    return [transaction_dict(row) for row in db.scalars(stmt)]


def settlement_dict(row: PartnerSettlement, db: Session) -> dict:
    lines = list(db.scalars(select(PartnerSettlementLine).where(PartnerSettlementLine.settlement_id == row.id)))
    return {"id": str(row.id), "settlement_no": row.settlement_no, "partner_id": str(row.partner_id),
            "period_month": row.period_month.isoformat(), "settlement_type": row.settlement_type,
            "total_amount": row.total_amount, "paid_amount": row.paid_amount, "balance_amount": row.balance_amount,
            "status": row.status, "notes": row.notes, "version": row.version,
            "lines": [{"partner_transaction_id": str(line.partner_transaction_id), "amount": line.amount} for line in lines]}


def create_settlement(db: Session, *, partner_id: uuid.UUID, period_month: date, settlement_type: str,
                      transaction_ids: list[uuid.UUID], notes: str | None, idempotency_key: str, user: User) -> dict:
    existing = db.scalar(select(PartnerSettlement).where(PartnerSettlement.idempotency_key == idempotency_key))
    if existing: return settlement_dict(existing, db)
    if not transaction_ids: raise ApiError(422, "SETTLEMENT_LINES_REQUIRED", "Chọn ít nhất một giao dịch.")
    rows = []
    for item_id in sorted(set(transaction_ids), key=str):
        row = db.scalar(select(PartnerTransaction).where(PartnerTransaction.id == item_id).with_for_update(of=PartnerTransaction))
        if not row or row.partner_id != partner_id or row.settlement_id or row.status != "POSTED" or row.direction != "DEBIT":
            raise ApiError(409, "SETTLEMENT_TRANSACTION_INVALID", "Có giao dịch không còn đủ điều kiện chốt.")
        rows.append(row)
    total = sum(row.amount for row in rows)
    settlement = PartnerSettlement(settlement_no=number("DTC"), partner_id=partner_id,
        period_month=period_month.replace(day=1), settlement_type=settlement_type, total_amount=total,
        paid_amount=0, balance_amount=total, status="UNPAID", notes=notes, created_by=user.id, idempotency_key=idempotency_key)
    db.add(settlement); db.flush()
    for row in rows:
        row.settlement_id = settlement.id
        db.add(PartnerSettlementLine(settlement_id=settlement.id, partner_transaction_id=row.id, amount=row.amount))
    add_audit(db, user, "MATERIALS", "SETTLE", "PARTNER_SETTLEMENT", settlement.id, idempotency_key, after={"total_amount": total, "line_count": len(rows)}); db.commit()
    return settlement_dict(settlement, db)


def list_settlements(db: Session, partner_id: uuid.UUID | None, settlement_type: str | None,
                     period_month: date | None, status: str | None) -> list[dict]:
    stmt = select(PartnerSettlement).order_by(PartnerSettlement.period_month.desc(), PartnerSettlement.created_at.desc())
    if partner_id: stmt = stmt.where(PartnerSettlement.partner_id == partner_id)
    if settlement_type: stmt = stmt.where(PartnerSettlement.settlement_type == settlement_type)
    if period_month: stmt = stmt.where(PartnerSettlement.period_month == period_month.replace(day=1))
    if status: stmt = stmt.where(PartnerSettlement.status == status)
    return [settlement_dict(row, db) for row in db.scalars(stmt)]


def partner_payment(db: Session, *, partner_id: uuid.UUID, amount: int, method: str,
                    allocations: list[dict], note: str | None, idempotency_key: str, user: User) -> dict:
    existing = db.scalar(select(Payment).where(Payment.idempotency_key == idempotency_key))
    if existing: return payment_dict(existing, db)
    if amount <= 0: raise ApiError(422, "PAYMENT_INVALID", "Số tiền phải lớn hơn 0.")
    allocation_total = sum(int(item["allocated_amount"]) for item in allocations)
    if allocation_total > amount or any(int(item["allocated_amount"]) <= 0 for item in allocations):
        raise ApiError(422, "ALLOCATION_EXCEEDS_PAYMENT", "Tổng phân bổ không được vượt thanh toán.")
    payment = Payment(payment_no=number("PAY"), party_type="PARTNER", supplier_id=partner_id,
        paid_at=datetime.now(timezone.utc), amount=amount, method=method, direction="PAYMENT", received_or_paid_by=user.id,
        note=note, status="POSTED", idempotency_key=idempotency_key)
    db.add(payment); db.flush()
    for item in allocations:
        target_type = item["target_type"]; target_id = item["target_id"]; value = int(item["allocated_amount"])
        if target_type == "MATERIAL_RECEIPT":
            target = db.scalar(select(MaterialReceipt).where(MaterialReceipt.id == target_id).with_for_update(of=MaterialReceipt))
        elif target_type == "PARTNER_SETTLEMENT":
            target = db.scalar(select(PartnerSettlement).where(PartnerSettlement.id == target_id).with_for_update(of=PartnerSettlement))
        else: raise ApiError(422, "ALLOCATION_TARGET_INVALID", "Loại chứng từ phân bổ không hợp lệ.")
        if not target or target.partner_id != partner_id or target.status == "VOID" or value > target.balance_amount:
            raise ApiError(409, "ALLOCATION_TARGET_INVALID", "Chứng từ phân bổ hoặc số tiền không hợp lệ.")
        target.paid_amount += value; target.balance_amount -= value; target.status = "PAID" if target.balance_amount == 0 else "PARTIALLY_PAID"; target.version += 1
        db.add(PaymentAllocation(payment_id=payment.id, target_type=target_type, target_id=target.id, allocated_amount=value))
    db.add(DebtLedgerEntry(party_type="PARTNER", party_id=partner_id, entry_type="PARTNER_PAYMENT", amount_delta=-amount,
        reference_type="PAYMENT", reference_id=payment.id, description=note or payment.payment_no,
        actor_user_id=user.id, idempotency_key=f"{idempotency_key}:debt"))
    db.flush(); refresh_party(db, "PARTNER", partner_id); add_audit(db, user, "MATERIALS", "PAYMENT", "PAYMENT", payment.id, idempotency_key, after={"amount": amount, "allocated": allocation_total}); db.commit()
    return payment_dict(payment, db)


def payment_dict(payment: Payment, db: Session) -> dict:
    rows = list(db.scalars(select(PaymentAllocation).where(PaymentAllocation.payment_id == payment.id)))
    allocated = sum(row.allocated_amount for row in rows)
    return {"id": str(payment.id), "payment_no": payment.payment_no, "amount": payment.amount,
            "allocated_amount": allocated, "unallocated_amount": payment.amount - allocated, "status": payment.status}


def debt_statement(db: Session, partner_id: uuid.UUID) -> dict:
    if not db.get(Partner, partner_id): raise ApiError(404, "PARTNER_NOT_FOUND", "Không tìm thấy đối tác.")
    rows = list(db.scalars(select(DebtLedgerEntry).where(DebtLedgerEntry.party_type == "PARTNER",
        DebtLedgerEntry.party_id == partner_id).order_by(DebtLedgerEntry.occurred_at, DebtLedgerEntry.created_at, DebtLedgerEntry.id)))
    balance = 0; entries = []
    for row in rows:
        balance += row.amount_delta; entries.append({"id": str(row.id), "occurred_at": row.occurred_at.isoformat(),
            "entry_type": row.entry_type, "debit": max(row.amount_delta, 0), "credit": max(-row.amount_delta, 0),
            "balance": balance, "description": row.description, "reference_type": row.reference_type,
            "reference_id": str(row.reference_id) if row.reference_id else None})
    return {"opening": sum(row.amount_delta for row in rows if row.entry_type == "OPENING"),
            "debit": sum(max(row.amount_delta, 0) for row in rows if row.entry_type != "OPENING"),
            "credit": sum(max(-row.amount_delta, 0) for row in rows), "closing": balance, "entries": entries}


def attach_file(db: Session, *, partner_id: uuid.UUID, transaction_id: uuid.UUID | None, media_id: uuid.UUID,
                purpose: str, user: User) -> dict:
    if not db.get(Partner, partner_id) or not db.get(MediaObject, media_id): raise ApiError(404, "ATTACHMENT_REFERENCE_NOT_FOUND", "Đối tác hoặc file không tồn tại.")
    if transaction_id:
        transaction = db.get(PartnerTransaction, transaction_id)
        if not transaction or transaction.partner_id != partner_id: raise ApiError(409, "TRANSACTION_PARTNER_MISMATCH", "Giao dịch không thuộc đối tác.")
    existing = db.scalar(select(PartnerFile).where(PartnerFile.partner_id == partner_id, PartnerFile.media_id == media_id, PartnerFile.purpose == purpose))
    if existing: return {"id": str(existing.id), "partner_id": str(partner_id), "media_id": str(media_id), "purpose": existing.purpose}
    row = PartnerFile(partner_id=partner_id, transaction_id=transaction_id, media_id=media_id, purpose=purpose, created_by=user.id)
    db.add(row); db.flush(); add_audit(db, user, "MATERIALS", "ATTACH_FILE", "PARTNER_FILE", row.id, after={"media_id": str(media_id), "purpose": purpose}); db.commit()
    return {"id": str(row.id), "partner_id": str(partner_id), "media_id": str(media_id), "purpose": purpose}
