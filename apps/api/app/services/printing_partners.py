"""Shared debt, settlement, and payment logic for printing partners."""
from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.errors import ApiError
from ..models import (DebtLedgerEntry, MediaObject, NhatInMonthTransaction, Partner,
                      PartnerSettlement, PartnerTransaction, User)
from .production import add_audit, number, refresh_party
from .storage import media_view_url


@dataclass(frozen=True)
class PrintingPartner:
    route_key: str
    code: str
    name: str
    settlement_prefix: str
    number_prefix: str


PRINTING_PARTNERS = {
    "nhat": PrintingPartner("nhat", "NHAT_IN", "NHẬT - IN", "NHAT_IN", "NHI"),
    "tung": PrintingPartner("tung", "TUNG_IN", "TÙNG - IN", "TUNG_IN", "TGI"),
}


def printing_partner(value: str) -> PrintingPartner:
    config = PRINTING_PARTNERS.get((value or "").strip().lower())
    if not config:
        raise ApiError(404, "PRINTING_PARTNER_NOT_FOUND", "Không tìm thấy đối tác in.")
    return config


def _month_key(value: str) -> str:
    month = (value or "").strip()
    if not re.fullmatch(r"\d{4}-\d{2}", month) or not 1 <= int(month[5:7]) <= 12:
        raise ApiError(422, "MONTH_INVALID", "Tháng phải có dạng YYYY-MM và nằm trong khoảng 01 đến 12.")
    return month


def _partner(db: Session, config: PrintingPartner, *, lock: bool = False) -> Partner:
    statement = select(Partner).where(Partner.partner_code == config.code)
    if lock:
        statement = statement.with_for_update()
    row = db.scalar(statement)
    if row:
        return row
    row = Partner(partner_code=config.code, name=config.name, partner_type="PRINTING", status="ACTIVE")
    db.add(row)
    db.flush()
    return row


def _scoped_key(config: PrintingPartner, idempotency_key: str) -> str:
    return f"{config.code}:{idempotency_key}"


def _settlement_dict(row: PartnerSettlement, db: Session) -> dict:
    media = db.get(MediaObject, row.media_id) if row.media_id else None
    creator = db.get(User, row.created_by) if row.created_by else None
    return {
        "id": str(row.id),
        "settlement_no": row.settlement_no,
        "period_month": row.period_month.strftime("%Y-%m"),
        "total_amount": row.total_amount,
        "paid_amount": row.paid_amount,
        "balance_amount": row.balance_amount,
        "status": row.status,
        "notes": row.notes,
        "version": row.version,
        "media": {
            "id": str(media.id),
            "url": media_view_url(media.id),
            "original_name": media.original_name,
            "content_type": media.content_type,
        } if media else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "created_by_name": creator.display_name if creator else None,
    }


def settle_month(db: Session, *, partner_key: str, period_month: str, amount: int,
                 note: str | None, media_id: uuid.UUID | None, idempotency_key: str,
                 user: User) -> dict:
    """Append a partner-specific monthly settlement and its debt-ledger entry."""
    config = printing_partner(partner_key)
    month = _month_key(period_month)
    if amount <= 0:
        raise ApiError(422, "AMOUNT_INVALID", "Số tiền phải lớn hơn 0.")

    partner = _partner(db, config, lock=True)
    scoped_key = _scoped_key(config, idempotency_key)
    existing = db.scalar(select(PartnerSettlement).where(
        PartnerSettlement.partner_id == partner.id,
        PartnerSettlement.idempotency_key.in_((scoped_key, idempotency_key)),
    ))
    if existing:
        return _settlement_dict(existing, db)

    media = db.get(MediaObject, media_id) if media_id else None
    if media_id and not media:
        raise ApiError(422, "MEDIA_NOT_FOUND", "File đối chiếu không tồn tại.")
    if media and media.content_type != "application/pdf":
        raise ApiError(422, "MEDIA_TYPE_INVALID", "File đối chiếu phải là PDF.")
    if media and not media.object_key.startswith(f"private-media/{config.code}/"):
        raise ApiError(422, "MEDIA_PARTNER_INVALID", "File PDF không thuộc đúng sổ đối tác.")

    settlement = PartnerSettlement(
        settlement_no=number(config.number_prefix),
        partner_id=partner.id,
        period_month=date(int(month[:4]), int(month[5:7]), 1),
        settlement_type=config.settlement_prefix,
        total_amount=amount,
        paid_amount=0,
        balance_amount=amount,
        status="UNPAID",
        media_id=media.id if media else None,
        notes=note,
        created_by=user.id,
        idempotency_key=scoped_key,
    )
    db.add(settlement)
    db.flush()
    db.add(DebtLedgerEntry(
        party_type="PARTNER",
        party_id=partner.id,
        entry_type=f"{config.code}_SETTLEMENT",
        amount_delta=amount,
        reference_type="PARTNER_SETTLEMENT",
        reference_id=settlement.id,
        description=f"Chốt tiền {config.name} tháng {month}",
        actor_user_id=user.id,
        idempotency_key=f"{scoped_key}:debt",
    ))
    db.flush()
    refresh_party(db, "PARTNER", partner.id)
    add_audit(db, user, "MATERIALS", f"{config.code}_SETTLE", "PARTNER_SETTLEMENT",
              settlement.id, scoped_key, after={
                  "partner_code": config.code,
                  "period_month": month,
                  "amount": amount,
                  "media_id": str(media.id) if media else None,
              })
    db.commit()
    return _settlement_dict(settlement, db)


def list_settlements(db: Session, partner_key: str) -> list[dict]:
    config = printing_partner(partner_key)
    partner = _partner(db, config)
    rows = db.scalars(select(PartnerSettlement).where(
        PartnerSettlement.partner_id == partner.id,
        PartnerSettlement.settlement_type == config.settlement_prefix,
    ).order_by(PartnerSettlement.period_month.desc(), PartnerSettlement.created_at.desc()))
    return [_settlement_dict(row, db) for row in rows]


def monthly_settlements(db: Session, partner_key: str, month: str) -> list[dict]:
    config = printing_partner(partner_key)
    month = _month_key(month)
    partner = _partner(db, config)
    rows = db.scalars(select(PartnerSettlement).where(
        PartnerSettlement.partner_id == partner.id,
        PartnerSettlement.settlement_type == config.settlement_prefix,
        PartnerSettlement.period_month == date(int(month[:4]), int(month[5:7]), 1),
    ).order_by(PartnerSettlement.created_at))
    return [_settlement_dict(row, db) for row in rows]


def _settlements_by_month(db: Session, partner: Partner, config: PrintingPartner) -> dict[str, int]:
    rows = db.scalars(select(PartnerSettlement).where(
        PartnerSettlement.partner_id == partner.id,
        PartnerSettlement.settlement_type == config.settlement_prefix,
    ))
    result: dict[str, int] = {}
    for row in rows:
        month = row.period_month.strftime("%Y-%m")
        result[month] = result.get(month, 0) + row.total_amount
    return result


def _month_transactions(db: Session, partner: Partner) -> list[NhatInMonthTransaction]:
    return list(db.scalars(select(NhatInMonthTransaction).where(
        NhatInMonthTransaction.partner_id == partner.id,
    ).order_by(NhatInMonthTransaction.created_at)))


def debt_summary(db: Session, partner_key: str) -> dict:
    config = printing_partner(partner_key)
    partner = _partner(db, config)
    buy_by_month = _settlements_by_month(db, partner, config)
    transactions = _month_transactions(db, partner)
    months: dict[str, dict] = {}
    for month, buy in buy_by_month.items():
        months[month] = {
            "month": month, "buy": buy, "advance": 0, "paid": 0,
            "receipt_count": 0, "transaction_count": 0,
        }
    for row in db.scalars(select(PartnerSettlement).where(
        PartnerSettlement.partner_id == partner.id,
        PartnerSettlement.settlement_type == config.settlement_prefix,
    )):
        months[row.period_month.strftime("%Y-%m")]["receipt_count"] += 1
    for row in transactions:
        months.setdefault(row.month, {
            "month": row.month, "buy": 0, "advance": 0, "paid": 0,
            "receipt_count": 0, "transaction_count": 0,
        })
        months[row.month]["transaction_count"] += 1
        months[row.month]["advance" if row.transaction_type == "ADVANCE" else "paid"] += row.amount

    grouped = []
    for month in sorted(months, reverse=True):
        values = months[month]
        remaining = values["buy"] - values["advance"] - values["paid"]
        if values["buy"] == 0 and values["advance"] > 0:
            group = "ADVANCE"
        elif values["buy"] > 0 and remaining <= 0:
            group = "SETTLED"
        else:
            group = "PENDING"
        grouped.append({**values, "remaining": remaining, "group": group})

    return {
        "total_remaining": sum(max(row["remaining"], 0) for row in grouped),
        "unallocated_advance": sum(row["advance"] for row in grouped if row["buy"] == 0),
        "months": grouped,
    }


def month_payments(db: Session, partner_key: str, month: str) -> list[dict]:
    config = printing_partner(partner_key)
    partner = _partner(db, config)
    month = _month_key(month)
    rows = db.scalars(select(NhatInMonthTransaction).where(
        NhatInMonthTransaction.partner_id == partner.id,
        NhatInMonthTransaction.month == month,
    ).order_by(NhatInMonthTransaction.occurred_date, NhatInMonthTransaction.created_at))
    result = []
    for row in rows:
        creator = db.get(User, row.created_by) if row.created_by else None
        transaction = db.get(PartnerTransaction, row.partner_transaction_id) if row.partner_transaction_id else None
        result.append({
            "id": str(row.id),
            "month": row.month,
            "transaction_type": row.transaction_type,
            "amount": row.amount,
            "occurred_date": row.occurred_date.isoformat(),
            "note": row.note,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "created_by_name": creator.display_name if creator else None,
            "transaction_no": transaction.transaction_no if transaction else None,
        })
    return result


def _post_money(db: Session, *, partner_key: str, month: str, transaction_type: str,
                amount: int, occurred_date: date, note: str | None,
                idempotency_key: str, user: User) -> dict:
    config = printing_partner(partner_key)
    month = _month_key(month)
    if amount <= 0:
        raise ApiError(422, "MONEY_INVALID", "Số tiền phải lớn hơn 0.")
    partner = _partner(db, config, lock=True)
    scoped_key = _scoped_key(config, idempotency_key)
    existing = db.scalar(select(NhatInMonthTransaction).where(
        NhatInMonthTransaction.partner_id == partner.id,
        NhatInMonthTransaction.idempotency_key.in_((scoped_key, idempotency_key)),
    ))
    if existing:
        return {
            "id": str(existing.id), "month": existing.month,
            "transaction_type": existing.transaction_type, "amount": existing.amount,
            "occurred_date": existing.occurred_date.isoformat(), "note": existing.note,
        }

    if transaction_type == "PAYMENT":
        buy = _settlements_by_month(db, partner, config).get(month, 0)
        paid = sum(row.amount for row in _month_transactions(db, partner) if row.month == month)
        remaining = buy - paid
        if remaining <= 0:
            raise ApiError(422, "MONTH_FULLY_SETTLED", "Tháng này không còn công nợ để thanh toán.")
        if amount > remaining:
            raise ApiError(422, "PAYMENT_EXCEEDS_REMAINING", "Số tiền thanh toán lớn hơn số còn lại của tháng.")

    transaction_label = "Trừ Nợ" if transaction_type == "PAYMENT" else "Ứng"
    transaction = PartnerTransaction(
        transaction_no=number(config.number_prefix),
        partner_id=partner.id,
        direction="CREDIT",
        transaction_type=f"{config.code}_{transaction_type}",
        amount=amount,
        reference_type=f"{config.code}_MONTH",
        occurred_at=datetime.combine(occurred_date, datetime.min.time(), tzinfo=timezone.utc),
        description=note or f"{transaction_label} {config.name} tháng {month}",
        created_by=user.id,
        idempotency_key=f"{scoped_key}:transaction",
    )
    db.add(transaction)
    db.flush()
    row = NhatInMonthTransaction(
        partner_id=partner.id,
        month=month,
        transaction_type=transaction_type,
        amount=amount,
        occurred_date=occurred_date,
        note=note,
        partner_transaction_id=transaction.id,
        created_by=user.id,
        idempotency_key=scoped_key,
    )
    db.add(row)
    db.flush()
    db.add(DebtLedgerEntry(
        party_type="PARTNER",
        party_id=partner.id,
        entry_type=f"{config.code}_{transaction_type}",
        amount_delta=-amount,
        reference_type=f"{config.code}_MONTH_TRANSACTION",
        reference_id=row.id,
        description=note or f"{transaction_label} {config.name} tháng {month}",
        actor_user_id=user.id,
        idempotency_key=f"{scoped_key}:debt",
    ))
    db.flush()
    refresh_party(db, "PARTNER", partner.id)
    add_audit(db, user, "MATERIALS", f"{config.code}_{transaction_type}",
              f"{config.code}_MONTH_TRANSACTION", row.id, scoped_key, after={
                  "partner_code": config.code,
                  "month": month,
                  "amount": amount,
                  "transaction_type": transaction_type,
              })
    db.commit()
    return {
        "id": str(row.id), "month": row.month,
        "transaction_type": row.transaction_type, "amount": row.amount,
        "occurred_date": row.occurred_date.isoformat(), "note": row.note,
    }


def payment(db: Session, *, partner_key: str, month: str, amount: int, payment_date: date,
            note: str | None, idempotency_key: str, user: User) -> dict:
    return _post_money(
        db, partner_key=partner_key, month=month, transaction_type="PAYMENT",
        amount=amount, occurred_date=payment_date, note=note,
        idempotency_key=idempotency_key, user=user,
    )


def advance(db: Session, *, partner_key: str, month: str, amount: int, advance_date: date,
            note: str | None, idempotency_key: str, user: User) -> dict:
    return _post_money(
        db, partner_key=partner_key, month=month, transaction_type="ADVANCE",
        amount=amount, occurred_date=advance_date, note=note,
        idempotency_key=idempotency_key, user=user,
    )


def ledger(db: Session, partner_key: str) -> list[dict]:
    config = printing_partner(partner_key)
    partner = _partner(db, config)
    rows = db.scalars(select(DebtLedgerEntry).where(
        DebtLedgerEntry.party_type == "PARTNER",
        DebtLedgerEntry.party_id == partner.id,
    ).order_by(DebtLedgerEntry.occurred_at, DebtLedgerEntry.created_at, DebtLedgerEntry.id))
    balance = 0
    result = []
    for row in rows:
        balance += row.amount_delta
        actor = db.get(User, row.actor_user_id) if row.actor_user_id else None
        settlement_no = None
        transaction_no = None
        month = None
        if row.reference_type == "PARTNER_SETTLEMENT" and row.reference_id:
            settlement = db.get(PartnerSettlement, row.reference_id)
            if settlement:
                settlement_no = settlement.settlement_no
                month = settlement.period_month.strftime("%Y-%m")
        elif row.reference_id:
            month_transaction = db.get(NhatInMonthTransaction, row.reference_id)
            if month_transaction:
                month = month_transaction.month
                transaction = db.get(PartnerTransaction, month_transaction.partner_transaction_id) if month_transaction.partner_transaction_id else None
                transaction_no = transaction.transaction_no if transaction else None
        result.append({
            "id": str(row.id),
            "occurred_at": row.occurred_at.isoformat(),
            "entry_type": row.entry_type,
            "month": month,
            "transaction_no": settlement_no or transaction_no,
            "debit": max(row.amount_delta, 0),
            "credit": max(-row.amount_delta, 0),
            "balance": balance,
            "description": row.description,
            "actor_name": actor.display_name if actor else None,
        })
    result.reverse()
    return result
