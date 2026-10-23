import uuid
from datetime import date as date_type, datetime, time, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.deps import current_user, require_accounting, require_permission
from ..core.errors import ApiError
from ..models import AuditLog, Customer, DebtLedgerEntry, PartyDebtBalance, User
from ..services.finance import debt_total, refresh_debt_projection

router = APIRouter(tags=["debt"])

TZ = timezone(timedelta(hours=7))


def _ledger(db: Session, customer_id: uuid.UUID) -> dict:
    customer = db.get(Customer, customer_id)
    if not customer:
        raise ApiError(404, "CUSTOMER_NOT_FOUND", "Không tìm thấy khách hàng.")
    entries = list(db.scalars(select(DebtLedgerEntry).where(
        DebtLedgerEntry.party_type == "CUSTOMER", DebtLedgerEntry.party_id == customer_id
    ).order_by(DebtLedgerEntry.occurred_at, DebtLedgerEntry.created_at, DebtLedgerEntry.id)))
    running = 0
    rows = []
    for entry in entries:
        running += entry.amount_delta
        rows.append({"id": str(entry.id), "occurred_at": entry.occurred_at.isoformat(),
                     "entry_type": entry.entry_type, "debit": max(entry.amount_delta, 0),
                     "credit": max(-entry.amount_delta, 0), "amount_delta": entry.amount_delta,
                     "balance": running, "reference_type": entry.reference_type,
                     "reference_id": str(entry.reference_id) if entry.reference_id else None,
                     "description": entry.description,
                     "reversal_of_id": str(entry.reversal_of_id) if entry.reversal_of_id else None})
    return {"customer": {"id": str(customer.id), "name": customer.name},
            "opening": sum(e.amount_delta for e in entries if e.entry_type == "OPENING"),
            "debit": sum(max(e.amount_delta, 0) for e in entries if e.entry_type != "OPENING"),
            "credit": sum(max(-e.amount_delta, 0) for e in entries), "closing": running, "entries": rows}


@router.get("/customers/{customer_id}/debt-ledger")
def customer_ledger(customer_id: uuid.UUID, db: Session = Depends(get_db), _=Depends(require_permission("customer_debt.view"))):
    return {"data": _ledger(db, customer_id)}


@router.get("/debt/customers/{customer_id}")
def customer_debt(customer_id: uuid.UUID, db: Session = Depends(get_db), _=Depends(require_permission("customer_debt.view"))):
    return {"data": _ledger(db, customer_id)}


@router.get("/debt/summary")
def summary(db: Session = Depends(get_db), _=Depends(require_permission("customer_debt.view"))):
    rows = db.execute(select(
        DebtLedgerEntry.party_id, func.sum(DebtLedgerEntry.amount_delta)
    ).where(DebtLedgerEntry.party_type == "CUSTOMER").group_by(DebtLedgerEntry.party_id)).all()
    data = []
    for party_id, current in rows:
        customer = db.get(Customer, party_id)
        if customer:
            data.append({"customer_id": str(party_id), "customer_name": customer.name, "current": int(current or 0)})
    data.sort(key=lambda row: row["current"], reverse=True)
    return {"data": data, "meta": {"total_receivable": sum(max(row["current"], 0) for row in data),
                                     "total_credit": sum(max(-row["current"], 0) for row in data)}}


class DebtAdjustmentItem(BaseModel):
    type: Literal["INCREASE", "DECREASE"]
    date: date_type | None = None
    amount: int = Field(gt=0)
    note: str | None = Field(None, max_length=500)


class AdjustmentIn(BaseModel):
    items: list[DebtAdjustmentItem] = Field(default_factory=list)
    # Backward-compat với schema cũ (1 dòng amount_delta/reason)
    amount_delta: int | None = None
    reason: str | None = Field(None, max_length=2000)


def _normalize_items(body: AdjustmentIn) -> list[dict]:
    """Chuẩn hóa request về danh sách dòng, giữ tương thích schema cũ."""
    if body.items:
        return [{
            "type": item.type,
            "date": item.date,
            "amount": item.amount,
            "note": (item.note or "").strip() or None,
        } for item in body.items]
    if body.amount_delta is not None:
        if body.amount_delta == 0:
            raise ApiError(422, "ADJUSTMENT_ZERO", "Điều chỉnh công nợ phải khác 0.")
        return [{
            "type": "INCREASE" if body.amount_delta > 0 else "DECREASE",
            "date": None,
            "amount": abs(body.amount_delta),
            "note": (body.reason or "").strip() or None,
        }]
    raise ApiError(422, "ADJUSTMENT_EMPTY", "Phiếu công nợ không có dòng nào.")


@router.post("/customers/{customer_id}/debt-adjustments", status_code=201)
def adjustment(customer_id: uuid.UUID, body: AdjustmentIn,
               idempotency_key: str = Header(..., alias="Idempotency-Key"),
               db: Session = Depends(get_db), user: User = Depends(require_accounting)):
    items = _normalize_items(body)
    if not idempotency_key:
        raise ApiError(422, "IDEMPOTENCY_KEY_REQUIRED", "Thiếu Idempotency-Key.")

    # Idempotency: nếu đã có dòng đầu của phiếu này thì trả ledger hiện có.
    first_key = f"{idempotency_key}:0"
    if db.scalar(select(DebtLedgerEntry.id).where(DebtLedgerEntry.idempotency_key == first_key)):
        return {"data": _ledger(db, customer_id)}

    customer = db.scalar(select(Customer).where(Customer.id == customer_id).with_for_update(of=Customer))
    if not customer:
        raise ApiError(404, "CUSTOMER_NOT_FOUND", "Không tìm thấy khách hàng.")

    before = debt_total(db, customer_id)
    entries: list[DebtLedgerEntry] = []
    for index, item in enumerate(items):
        delta = item["amount"] if item["type"] == "INCREASE" else -item["amount"]
        occurred_at = datetime.combine(item["date"], time(0, 0, tzinfo=TZ)) if item["date"] else datetime.now(TZ)
        entry = DebtLedgerEntry(
            party_type="CUSTOMER", party_id=customer_id, entry_type="CUSTOMER_DEBT_ADJUSTMENT",
            amount_delta=delta, reference_type="CUSTOMER_DEBT_ADJUSTMENT", reference_id=customer_id,
            description=item["note"], actor_user_id=user.id,
            idempotency_key=f"{idempotency_key}:{index}", occurred_at=occurred_at,
        )
        db.add(entry)
        entries.append(entry)

    db.flush()
    refresh_debt_projection(db, customer_id)
    after = debt_total(db, customer_id)
    db.add(AuditLog(module="DEBT", entity_type="CUSTOMER", entity_id=customer_id,
                    action="DEBT_ADJUSTMENT", actor_user_id=user.id, request_id=idempotency_key,
                    before_data={"balance": before},
                    after_data={"balance": after,
                                "items": [{"type": i["type"], "amount": i["amount"], "note": i["note"]}
                                          for i in items]}))
    db.commit()
    return {"data": _ledger(db, customer_id)}
