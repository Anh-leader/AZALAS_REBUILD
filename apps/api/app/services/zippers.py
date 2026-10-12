"""Nghiệp vụ riêng cho Phụ liệu → Dây kéo, dùng chung hệ materials/partners/debt ledger."""
from __future__ import annotations

import re
import uuid
from datetime import date, datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core.errors import ApiError
from ..models import (DebtLedgerEntry, Material, MaterialPriceHistory, MaterialReceipt,
                      MaterialReceiptLine, MaterialVariant, Partner, PartnerTransaction,
                      User, ZipperMonthTransaction)
from .materials import create_receipt, list_receipts, receipt_dict
from .production import add_audit, number, refresh_party

ZIPPER_CATEGORY = "ZIPPER"
ZIPPER_PARTNER_TYPE = "ZIPPER_SUPPLIER"
ZIPPER_PARTNER_CODE = "ZIPPER-DEFAULT"
ZIPPER_PARTNER_NAME = "Nhà cung cấp dây kéo"


def _slug(value: str) -> str:
    text = value.strip().upper()
    text = "".join(ch for ch in text if ch.isalnum() or ch in " -")
    # Bỏ dấu tiếng Việt để mã gọn và đọc được: "DÂY KÉO" -> "DAY-KEO".
    text = text.replace("Đ", "D").replace("đ", "D")
    import unicodedata
    text = "".join(ch for ch in unicodedata.normalize("NFD", text) if unicodedata.category(ch) != "Mn")
    text = re.sub(r"[^A-Z0-9]+", "-", text).strip("-")
    return text or f"DK-{uuid.uuid4().hex[:6].upper()}"


def _unique_code(db: Session, base: str) -> str:
    if not db.scalar(select(Material.id).where(Material.material_code == base)):
        return base
    return f"{base}-{uuid.uuid4().hex[:4].upper()}"


def _default_partner(db: Session) -> Partner:
    row = db.scalar(select(Partner).where(Partner.partner_code == ZIPPER_PARTNER_CODE))
    if row:
        return row
    row = Partner(partner_code=ZIPPER_PARTNER_CODE, name=ZIPPER_PARTNER_NAME,
                  partner_type=ZIPPER_PARTNER_TYPE, status="ACTIVE")
    db.add(row)
    db.flush()
    return row


def zipper_item_dict(row: Material, db: Session) -> dict:
    history_count = db.scalar(select(func.count()).select_from(MaterialPriceHistory)
                              .where(MaterialPriceHistory.material_id == row.id)) or 0
    return {"id": str(row.id), "material_code": row.material_code, "name": row.name,
            "unit": row.unit, "unit_price_amount": row.unit_price_amount,
            "status": row.status, "price_history_count": int(history_count)}


def zipper_catalog(db: Session, q: str | None = None) -> list[dict]:
    stmt = select(Material).where(Material.category == ZIPPER_CATEGORY, Material.status == "ACTIVE").order_by(Material.name)
    rows = list(db.scalars(stmt))
    needle = (q or "").strip().casefold()
    if needle:
        rows = [row for row in rows if needle in row.name.casefold() or needle in row.material_code.casefold()]
    return [zipper_item_dict(row, db) for row in rows]


def save_zipper_item(db: Session, *, name: str, unit_price_amount: int, effective_date: date, user: User) -> dict:
    clean_name = (name or "").strip()
    if not clean_name:
        raise ApiError(422, "ZIPPER_NAME_REQUIRED", "Tên dây kéo là bắt buộc.")
    if unit_price_amount <= 0:
        raise ApiError(422, "ZIPPER_PRICE_INVALID", "Giá áp dụng phải lớn hơn 0.")
    row = db.scalar(select(Material).where(Material.category == ZIPPER_CATEGORY,
                                           func.lower(Material.name) == clean_name.lower()).with_for_update(of=Material))
    previous = None
    action = "CREATE"
    if row:
        previous = row.unit_price_amount
        row.unit_price_amount = unit_price_amount
        action = "UPDATE"
    else:
        row = Material(material_code=_unique_code(db, _slug(clean_name)), name=clean_name,
                       category=ZIPPER_CATEGORY, unit="SỢI", unit_price_amount=unit_price_amount)
        db.add(row)
        db.flush()
    if not db.scalar(select(MaterialVariant.id).where(MaterialVariant.material_id == row.id).limit(1)):
        db.add(MaterialVariant(material_id=row.id, color_id=None, size=None, display_name=row.name))
    db.add(MaterialPriceHistory(material_id=row.id, effective_date=effective_date,
                                unit_price_amount=unit_price_amount, previous_unit_price_amount=previous,
                                changed_by=user.id))
    add_audit(db, user, "MATERIALS", action, "MATERIAL", row.id,
              after={"name": clean_name, "unit_price_amount": unit_price_amount, "effective_date": effective_date.isoformat()})
    db.commit()
    return zipper_item_dict(row, db)


def zipper_price_history(db: Session, material_id: uuid.UUID) -> list[dict]:
    row = db.get(Material, material_id)
    if not row or row.category != ZIPPER_CATEGORY:
        raise ApiError(404, "ZIPPER_NOT_FOUND", "Không tìm thấy dây kéo.")
    rows = list(db.scalars(select(MaterialPriceHistory)
                           .where(MaterialPriceHistory.material_id == material_id)
                           .order_by(MaterialPriceHistory.effective_date.desc(), MaterialPriceHistory.created_at.desc())))
    return [{"id": str(h.id), "effective_date": h.effective_date.isoformat(),
             "unit_price_amount": h.unit_price_amount,
             "previous_unit_price_amount": h.previous_unit_price_amount,
             "changed_by": str(h.changed_by) if h.changed_by else None,
             "created_at": h.created_at.isoformat() if h.created_at else None} for h in rows]


def _resolve_variant(db: Session, material: Material) -> MaterialVariant:
    variant = db.scalar(select(MaterialVariant).where(MaterialVariant.material_id == material.id)
                        .order_by(MaterialVariant.display_name).limit(1))
    if variant:
        return variant
    variant = MaterialVariant(material_id=material.id, color_id=None, size=None, display_name=material.name)
    db.add(variant)
    db.flush()
    return variant


def create_zipper_receipt(db: Session, *, receipt_date: date, lines: list[dict],
                          idempotency_key: str, user: User) -> dict:
    if not lines:
        raise ApiError(422, "ZIPPER_LINES_REQUIRED", "Chưa có dòng sản phẩm để nhập.")
    partner = _default_partner(db)
    prepared = []
    for item in lines:
        material_id = item.get("material_id")
        material = db.get(Material, material_id)
        if not material or material.category != ZIPPER_CATEGORY or material.status != "ACTIVE":
            raise ApiError(422, "ZIPPER_INVALID", "Có dây kéo không hợp lệ trong phiếu nhập.")
        variant = _resolve_variant(db, material)
        prepared.append({"material_variant_id": variant.id, "quantity": item.get("quantity"),
                         "unit_price_amount": int(item.get("unit_price_amount") or 0),
                         "weight": None, "notes": None})
    data = {
        "receipt_date": receipt_date, "partner_id": partner.id, "category": ZIPPER_CATEGORY,
        "freight_amount": 0, "paid_amount": 0, "payment_method": None, "notes": None,
        "lines": prepared,
    }
    return create_receipt(db, data=data, idempotency_key=idempotency_key, user=user)


def list_zipper_receipts(db: Session, *, date_from: date | None = None, date_to: date | None = None) -> list[dict]:
    return list_receipts(db, partner_id=None, category=ZIPPER_CATEGORY, date_from=date_from, date_to=date_to)


def _month_key(d: date) -> str:
    return d.strftime("%Y-%m")


def _month_from_str(month: str) -> str:
    m = (month or "").strip()
    if not re.fullmatch(r"\d{4}-\d{2}", m):
        raise ApiError(422, "MONTH_INVALID", "Tháng phải có dạng YYYY-MM.")
    return m


def _zipper_receipts_by_month(db: Session) -> dict[str, int]:
    rows = list(db.scalars(select(MaterialReceipt).where(MaterialReceipt.category == ZIPPER_CATEGORY)))
    out: dict[str, int] = {}
    for row in rows:
        key = _month_key(row.receipt_date)
        out[key] = out.get(key, 0) + row.total_amount
    return out


def _zipper_month_txns(db: Session) -> list[ZipperMonthTransaction]:
    return list(db.scalars(select(ZipperMonthTransaction).order_by(ZipperMonthTransaction.created_at)))


def zipper_debt_summary(db: Session) -> dict:
    buy_by_month = _zipper_receipts_by_month(db)
    txns = _zipper_month_txns(db)
    months: dict[str, dict] = {}
    for month, buy in buy_by_month.items():
        months.setdefault(month, {"month": month, "buy": 0, "advance": 0, "paid": 0,
                                  "receipt_count": 0, "transaction_count": 0})
        months[month]["buy"] += buy
    for row in txns:
        months.setdefault(row.month, {"month": row.month, "buy": 0, "advance": 0, "paid": 0,
                                      "receipt_count": 0, "transaction_count": 0})
        months[row.month]["transaction_count"] += 1
        if row.transaction_type == "ADVANCE":
            months[row.month]["advance"] += row.amount
        else:
            months[row.month]["paid"] += row.amount
    # Đếm số phiếu mua theo tháng.
    receipts = list(db.scalars(select(MaterialReceipt).where(MaterialReceipt.category == ZIPPER_CATEGORY)))
    for row in receipts:
        key = _month_key(row.receipt_date)
        if key in months:
            months[key]["receipt_count"] += 1

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


def zipper_month_receipts(db: Session, month: str) -> list[dict]:
    month = _month_from_str(month)
    year, mon = int(month[:4]), int(month[5:7])
    start = date(year, mon, 1)
    end = date(year + 1, 1, 1) if mon == 12 else date(year, mon + 1, 1)
    rows = list(db.scalars(select(MaterialReceipt).where(
        MaterialReceipt.category == ZIPPER_CATEGORY, MaterialReceipt.receipt_date >= start,
        MaterialReceipt.receipt_date < end).order_by(MaterialReceipt.receipt_date, MaterialReceipt.created_at)))
    return [receipt_dict(row, db) for row in rows]


def zipper_month_payments(db: Session, month: str) -> list[dict]:
    month = _month_from_str(month)
    rows = list(db.scalars(select(ZipperMonthTransaction)
                           .where(ZipperMonthTransaction.month == month)
                           .order_by(ZipperMonthTransaction.occurred_date, ZipperMonthTransaction.created_at)))
    return [{"id": str(row.id), "month": row.month, "transaction_type": row.transaction_type,
             "amount": row.amount, "occurred_date": row.occurred_date.isoformat(),
             "note": row.note, "created_at": row.created_at.isoformat() if row.created_at else None} for row in rows]


def _post_zipper_money(db: Session, *, month: str, transaction_type: str, amount: int,
                       occurred_date: date, note: str | None, idempotency_key: str, user: User) -> dict:
    month = _month_from_str(month)
    existing = db.scalar(select(ZipperMonthTransaction).where(ZipperMonthTransaction.idempotency_key == idempotency_key))
    if existing:
        return {"id": str(existing.id), "month": existing.month, "transaction_type": existing.transaction_type,
                "amount": existing.amount, "occurred_date": existing.occurred_date.isoformat(), "note": existing.note}
    partner = _default_partner(db)
    if amount <= 0:
        raise ApiError(422, "MONEY_INVALID", "Số tiền phải lớn hơn 0.")
    if transaction_type == "PAYMENT":
        buy = _zipper_receipts_by_month(db).get(month, 0)
        paid = sum(row.amount for row in _zipper_month_txns(db) if row.month == month)
        remaining = buy - paid
        if remaining <= 0:
            raise ApiError(422, "MONTH_FULLY_SETTLED", "Tháng này không còn công nợ để thanh toán.")
        if amount - remaining > 1:
            raise ApiError(422, "PAYMENT_EXCEEDS_REMAINING", "Số tiền thanh toán lớn hơn số còn lại của tháng.")
    transaction_type_name = "Trừ Nợ" if transaction_type == "PAYMENT" else "Ứng"
    db_transaction = PartnerTransaction(
        transaction_no=number("PGD"), partner_id=partner.id, direction="CREDIT",
        transaction_type=f"ZIPPER_{transaction_type}", amount=amount,
        reference_type="ZIPPER_MONTH", occurred_at=datetime.combine(occurred_date, datetime.min.time(), tzinfo=timezone.utc),
        description=note or f"{transaction_type_name} dây kéo tháng {month}",
        created_by=user.id, idempotency_key=f"{idempotency_key}:transaction")
    db.add(db_transaction); db.flush()
    row = ZipperMonthTransaction(month=month, transaction_type=transaction_type, amount=amount,
                                 occurred_date=occurred_date, note=note,
                                 partner_transaction_id=db_transaction.id,
                                 created_by=user.id, idempotency_key=idempotency_key)
    db.add(row)
    db.add(DebtLedgerEntry(party_type="PARTNER", party_id=partner.id,
                           entry_type=f"ZIPPER_{transaction_type}", amount_delta=-amount,
                           reference_type="ZIPPER_MONTH_TRANSACTION", reference_id=row.id,
                           description=note or f"{transaction_type_name} dây kéo tháng {month}",
                           actor_user_id=user.id, idempotency_key=f"{idempotency_key}:debt"))
    db.flush(); refresh_party(db, "PARTNER", partner.id)
    add_audit(db, user, "MATERIALS", transaction_type, "ZIPPER_MONTH_TRANSACTION", row.id, idempotency_key,
              after={"month": month, "amount": amount, "transaction_type": transaction_type})
    db.commit()
    return {"id": str(row.id), "month": row.month, "transaction_type": row.transaction_type,
            "amount": row.amount, "occurred_date": row.occurred_date.isoformat(), "note": row.note}


def zipper_payment(db: Session, *, month: str, amount: int, payment_date: date, note: str | None,
                   idempotency_key: str, user: User) -> dict:
    return _post_zipper_money(db, month=month, transaction_type="PAYMENT", amount=amount,
                              occurred_date=payment_date, note=note, idempotency_key=idempotency_key, user=user)


def zipper_advance(db: Session, *, month: str, amount: int, advance_date: date, note: str | None,
                   idempotency_key: str, user: User) -> dict:
    return _post_zipper_money(db, month=month, transaction_type="ADVANCE", amount=amount,
                              occurred_date=advance_date, note=note, idempotency_key=idempotency_key, user=user)


def zipper_ledger(db: Session) -> list[dict]:
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

