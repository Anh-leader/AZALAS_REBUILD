"""Nghiệp vụ riêng cho Phụ liệu → Thêu, dùng chung debt ledger / partner."""
from __future__ import annotations

import re
import uuid
from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.errors import ApiError
from ..models import (DebtLedgerEntry, EmbroideryMonthTransaction, Partner,
                      PartnerSettlement, PartnerTransaction, User)
from .production import add_audit, number, refresh_party

EMBROIDERY_PARTNER_TYPE = "EMBROIDERY"
EMBROIDERY_PARTNER_CODE = "EMBROIDERY-DEFAULT"
EMBROIDERY_PARTNER_NAME = "THÊU"
EMBROIDERY_SETTLEMENT_TYPE = "EMBROIDERY"


def _month_key(value: str) -> str:
    m = (value or "").strip()
    if not re.fullmatch(r"\d{4}-\d{2}", m):
        raise ApiError(422, "MONTH_INVALID", "Tháng phải có dạng YYYY-MM.")
    return m


def _default_partner(db: Session) -> Partner:
    row = db.scalar(select(Partner).where(Partner.partner_code == EMBROIDERY_PARTNER_CODE))
    if row:
        return row
    row = Partner(partner_code=EMBROIDERY_PARTNER_CODE, name=EMBROIDERY_PARTNER_NAME,
                  partner_type=EMBROIDERY_PARTNER_TYPE, status="ACTIVE")
    db.add(row)
    db.flush()
    return row


def _settle_dict(row: PartnerSettlement, db: Session) -> dict:
    return {"id": str(row.id), "settlement_no": row.settlement_no,
            "period_month": row.period_month.strftime("%Y-%m"), "total_amount": row.total_amount,
            "paid_amount": row.paid_amount, "balance_amount": row.balance_amount,
            "status": row.status, "notes": row.notes, "version": row.version,
            "created_at": row.created_at.isoformat() if row.created_at else None}


def settle_month(db: Session, *, period_month: str, amount: int, note: str | None,
                 idempotency_key: str, user: User) -> dict:
    """Chốt tổng tiền thêu của một tháng. Tháng đã chốt thì điều chỉnh (đảo nợ cũ, ghi nợ mới)."""
    month = _month_key(period_month)
    if amount <= 0:
        raise ApiError(422, "AMOUNT_INVALID", "Tổng số tiền thêu phải lớn hơn 0.")
    existing = db.scalar(select(PartnerSettlement).where(PartnerSettlement.idempotency_key == idempotency_key))
    if existing:
        return _settle_dict(existing, db)
    partner = _default_partner(db)
    month_start = date(int(month[:4]), int(month[5:7]), 1)
    settlement = db.scalar(select(PartnerSettlement).where(
        PartnerSettlement.partner_id == partner.id,
        PartnerSettlement.period_month == month_start,
        PartnerSettlement.settlement_type == EMBROIDERY_SETTLEMENT_TYPE,
    ).with_for_update(of=PartnerSettlement))
    if settlement:
        old_amount = settlement.total_amount
        settlement.total_amount = amount
        settlement.balance_amount = amount - settlement.paid_amount
        settlement.notes = note
        settlement.version += 1
        db.add(DebtLedgerEntry(party_type="PARTNER", party_id=partner.id,
                               entry_type="EMBROIDERY_SETTLEMENT_REVERSAL", amount_delta=-old_amount,
                               reference_type="PARTNER_SETTLEMENT", reference_id=settlement.id,
                               description=f"Điều chỉnh chốt thêu tháng {month}",
                               actor_user_id=user.id, idempotency_key=f"{idempotency_key}:reversal"))
    else:
        settlement = PartnerSettlement(settlement_no=number("THEU"), partner_id=partner.id,
                                       period_month=month_start, settlement_type=EMBROIDERY_SETTLEMENT_TYPE,
                                       total_amount=amount, paid_amount=0, balance_amount=amount,
                                       status="UNPAID", notes=note, created_by=user.id,
                                       idempotency_key=idempotency_key)
        db.add(settlement)
        db.flush()
    db.add(DebtLedgerEntry(party_type="PARTNER", party_id=partner.id,
                           entry_type="EMBROIDERY_SETTLEMENT", amount_delta=amount,
                           reference_type="PARTNER_SETTLEMENT", reference_id=settlement.id,
                           description=f"Chốt tiền thêu tháng {month}",
                           actor_user_id=user.id, idempotency_key=f"{idempotency_key}:debt"))
    db.flush()
    refresh_party(db, "PARTNER", partner.id)
    add_audit(db, user, "MATERIALS", "EMBROIDERY_SETTLE", "PARTNER_SETTLEMENT", settlement.id,
              idempotency_key, after={"period_month": month, "amount": amount})
    db.commit()
    return _settle_dict(settlement, db)


def list_settlements(db: Session) -> list[dict]:
    partner = _default_partner(db)
    rows = list(db.scalars(select(PartnerSettlement).where(
        PartnerSettlement.partner_id == partner.id,
        PartnerSettlement.settlement_type == EMBROIDERY_SETTLEMENT_TYPE,
    ).order_by(PartnerSettlement.period_month.desc(), PartnerSettlement.created_at.desc())))
    return [_settle_dict(row, db) for row in rows]


def monthly_settlements(db: Session, month: str) -> list[dict]:
    month = _month_key(month)
    month_start = date(int(month[:4]), int(month[5:7]), 1)
    partner = _default_partner(db)
    rows = list(db.scalars(select(PartnerSettlement).where(
        PartnerSettlement.partner_id == partner.id,
        PartnerSettlement.settlement_type == EMBROIDERY_SETTLEMENT_TYPE,
        PartnerSettlement.period_month == month_start,
    ).order_by(PartnerSettlement.created_at)))
    return [_settle_dict(row, db) for row in rows]


def _settlements_by_month(db: Session) -> dict[str, int]:
    partner = _default_partner(db)
    rows = list(db.scalars(select(PartnerSettlement).where(
        PartnerSettlement.partner_id == partner.id,
        PartnerSettlement.settlement_type == EMBROIDERY_SETTLEMENT_TYPE)))
    out: dict[str, int] = {}
    for row in rows:
        key = row.period_month.strftime("%Y-%m")
        out[key] = out.get(key, 0) + row.total_amount
    return out


def _month_txns(db: Session) -> list[EmbroideryMonthTransaction]:
    return list(db.scalars(select(EmbroideryMonthTransaction).order_by(EmbroideryMonthTransaction.created_at)))


def debt_summary(db: Session) -> dict:
    buy_by_month = _settlements_by_month(db)
    txns = _month_txns(db)
    months: dict[str, dict] = {}
    for month, buy in buy_by_month.items():
        months.setdefault(month, {"month": month, "buy": 0, "advance": 0, "paid": 0,
                                  "receipt_count": 0, "transaction_count": 0})
        months[month]["buy"] += buy
        months[month]["receipt_count"] += 1
    for row in txns:
        months.setdefault(row.month, {"month": row.month, "buy": 0, "advance": 0, "paid": 0,
                                      "receipt_count": 0, "transaction_count": 0})
        months[row.month]["transaction_count"] += 1
        if row.transaction_type == "ADVANCE":
            months[row.month]["advance"] += row.amount
        else:
            months[row.month]["paid"] += row.amount

    grouped = []
    for month in sorted(months, reverse=True):
        d = months[month]
        remaining = d["buy"] - d["advance"] - d["paid"]
        if d["buy"] == 0 and d["advance"] > 0:
            group = "ADVANCE"
        elif d["buy"] > 0 and remaining <= 0:
            group = "SETTLED"
        else:
            group = "PENDING"
        grouped.append({**d, "remaining": remaining, "group": group})

    total_remaining = sum(max(d["remaining"], 0) for d in grouped)
    unallocated_advance = sum(d["advance"] for d in grouped if d["buy"] == 0)
    return {"total_remaining": total_remaining, "unallocated_advance": unallocated_advance, "months": grouped}


def month_payments(db: Session, month: str) -> list[dict]:
    month = _month_key(month)
    rows = list(db.scalars(select(EmbroideryMonthTransaction)
                           .where(EmbroideryMonthTransaction.month == month)
                           .order_by(EmbroideryMonthTransaction.occurred_date, EmbroideryMonthTransaction.created_at)))
    return [{"id": str(row.id), "month": row.month, "transaction_type": row.transaction_type,
             "amount": row.amount, "occurred_date": row.occurred_date.isoformat(),
             "note": row.note, "created_at": row.created_at.isoformat() if row.created_at else None} for row in rows]


def _post_money(db: Session, *, month: str, transaction_type: str, amount: int,
                occurred_date: date, note: str | None, idempotency_key: str, user: User) -> dict:
    month = _month_key(month)
    existing = db.scalar(select(EmbroideryMonthTransaction).where(EmbroideryMonthTransaction.idempotency_key == idempotency_key))
    if existing:
        return {"id": str(existing.id), "month": existing.month, "transaction_type": existing.transaction_type,
                "amount": existing.amount, "occurred_date": existing.occurred_date.isoformat(), "note": existing.note}
    partner = _default_partner(db)
    if amount <= 0:
        raise ApiError(422, "MONEY_INVALID", "Số tiền phải lớn hơn 0.")
    if transaction_type == "PAYMENT":
        buy = _settlements_by_month(db).get(month, 0)
        paid = sum(row.amount for row in _month_txns(db) if row.month == month)
        remaining = buy - paid
        if remaining <= 0:
            raise ApiError(422, "MONTH_FULLY_SETTLED", "Tháng này không còn công nợ để thanh toán.")
        if amount - remaining > 1:
            raise ApiError(422, "PAYMENT_EXCEEDS_REMAINING", "Số tiền thanh toán lớn hơn số còn lại của tháng.")
    transaction_type_name = "Trừ Nợ" if transaction_type == "PAYMENT" else "Ứng"
    db_transaction = PartnerTransaction(
        transaction_no=number("PGD"), partner_id=partner.id, direction="CREDIT",
        transaction_type=f"EMBROIDERY_{transaction_type}", amount=amount,
        reference_type="EMBROIDERY_MONTH", occurred_at=datetime.combine(occurred_date, datetime.min.time(), tzinfo=timezone.utc),
        description=note or f"{transaction_type_name} thêu tháng {month}",
        created_by=user.id, idempotency_key=f"{idempotency_key}:transaction")
    db.add(db_transaction); db.flush()
    row = EmbroideryMonthTransaction(month=month, transaction_type=transaction_type, amount=amount,
                                     occurred_date=occurred_date, note=note,
                                     partner_transaction_id=db_transaction.id,
                                     created_by=user.id, idempotency_key=idempotency_key)
    db.add(row)
    db.add(DebtLedgerEntry(party_type="PARTNER", party_id=partner.id,
                           entry_type=f"EMBROIDERY_{transaction_type}", amount_delta=-amount,
                           reference_type="EMBROIDERY_MONTH_TRANSACTION", reference_id=row.id,
                           description=note or f"{transaction_type_name} thêu tháng {month}",
                           actor_user_id=user.id, idempotency_key=f"{idempotency_key}:debt"))
    db.flush(); refresh_party(db, "PARTNER", partner.id)
    add_audit(db, user, "MATERIALS", transaction_type, "EMBROIDERY_MONTH_TRANSACTION", row.id, idempotency_key,
              after={"month": month, "amount": amount, "transaction_type": transaction_type})
    db.commit()
    return {"id": str(row.id), "month": row.month, "transaction_type": row.transaction_type,
            "amount": row.amount, "occurred_date": row.occurred_date.isoformat(), "note": row.note}


def payment(db: Session, *, month: str, amount: int, payment_date: date, note: str | None,
            idempotency_key: str, user: User) -> dict:
    return _post_money(db, month=month, transaction_type="PAYMENT", amount=amount,
                       occurred_date=payment_date, note=note, idempotency_key=idempotency_key, user=user)


def advance(db: Session, *, month: str, amount: int, advance_date: date, note: str | None,
            idempotency_key: str, user: User) -> dict:
    return _post_money(db, month=month, transaction_type="ADVANCE", amount=amount,
                       occurred_date=advance_date, note=note, idempotency_key=idempotency_key, user=user)


def ledger(db: Session) -> list[dict]:
    partner = _default_partner(db)
    rows = list(db.scalars(select(DebtLedgerEntry).where(
        DebtLedgerEntry.party_type == "PARTNER", DebtLedgerEntry.party_id == partner.id)
        .order_by(DebtLedgerEntry.occurred_at, DebtLedgerEntry.created_at, DebtLedgerEntry.id)))
    balance = 0
    out = []
    for row in rows:
        balance += row.amount_delta
        out.append({"id": str(row.id), "occurred_at": row.occurred_at.isoformat(),
                    "entry_type": row.entry_type, "debit": max(row.amount_delta, 0),
                    "credit": max(-row.amount_delta, 0), "balance": balance,
                    "description": row.description})
    out.reverse()
    return out
