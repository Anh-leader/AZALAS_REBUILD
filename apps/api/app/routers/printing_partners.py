import uuid
from datetime import date

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.deps import current_user, require_permission
from ..models import User
from ..services import printing_partners as svc

router = APIRouter(
    prefix="/materials/printing/{partner_key}",
    tags=["materials-printing-partners"],
    dependencies=[Depends(require_permission("materials.view"))],
)


class SettlementIn(BaseModel):
    period_month: str = Field(min_length=7, max_length=7)
    amount: int = Field(strict=True, gt=0)
    note: str | None = Field(None, max_length=500)
    media_id: uuid.UUID | None = None


class MoneyIn(BaseModel):
    month: str = Field(min_length=7, max_length=7)
    amount: int = Field(strict=True, gt=0)
    date: date
    note: str | None = Field(None, max_length=500)


@router.post("/monthly-settlements", status_code=201,
             dependencies=[Depends(require_permission("materials.settle"))])
def create_settlement(partner_key: str, body: SettlementIn,
                      idempotency_key: str = Header(..., alias="Idempotency-Key"),
                      db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.settle_month(
        db, partner_key=partner_key, period_month=body.period_month, amount=body.amount,
        note=body.note, media_id=body.media_id, idempotency_key=idempotency_key, user=user,
    )}


@router.get("/monthly-settlements")
def settlements(partner_key: str, db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.list_settlements(db, partner_key)}


@router.get("/monthly/{month}/settlements")
def monthly(partner_key: str, month: str, db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.monthly_settlements(db, partner_key, month)}


@router.get("/debt-summary")
def debt_summary(partner_key: str, db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.debt_summary(db, partner_key)}


@router.get("/monthly/{month}/payments")
def monthly_payments(partner_key: str, month: str, db: Session = Depends(get_db),
                     _=Depends(current_user)):
    return {"data": svc.month_payments(db, partner_key, month)}


@router.get("/ledger")
def ledger(partner_key: str, db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.ledger(db, partner_key)}


@router.post("/payments", status_code=201,
             dependencies=[Depends(require_permission("materials.settle"))])
def payment(partner_key: str, body: MoneyIn,
            idempotency_key: str = Header(..., alias="Idempotency-Key"),
            db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.payment(
        db, partner_key=partner_key, month=body.month, amount=body.amount,
        payment_date=body.date, note=body.note, idempotency_key=idempotency_key, user=user,
    )}


@router.post("/advances", status_code=201,
             dependencies=[Depends(require_permission("materials.settle"))])
def advance(partner_key: str, body: MoneyIn,
            idempotency_key: str = Header(..., alias="Idempotency-Key"),
            db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.advance(
        db, partner_key=partner_key, month=body.month, amount=body.amount,
        advance_date=body.date, note=body.note, idempotency_key=idempotency_key, user=user,
    )}
