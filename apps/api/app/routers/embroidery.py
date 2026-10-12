from datetime import date

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.deps import current_user, require_permission
from ..models import User
from ..services import embroidery as svc

router = APIRouter(prefix="/materials/embroidery", tags=["materials-embroidery"],
                   dependencies=[Depends(require_permission("materials.view"))])


class SettlementIn(BaseModel):
    period_month: str = Field(min_length=7, max_length=7)
    amount: int = Field(gt=0)
    note: str | None = Field(None, max_length=500)


class MoneyIn(BaseModel):
    month: str = Field(min_length=7, max_length=7)
    amount: int = Field(gt=0)
    date: date
    note: str | None = Field(None, max_length=500)


@router.post("/monthly-settlements", status_code=201, dependencies=[Depends(require_permission("materials.settle"))])
def create_settlement(body: SettlementIn, idempotency_key: str = Header(..., alias="Idempotency-Key"),
                      db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.settle_month(db, period_month=body.period_month, amount=body.amount,
                                     note=body.note, idempotency_key=idempotency_key, user=user)}


@router.get("/monthly-settlements")
def settlements(db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.list_settlements(db)}


@router.get("/monthly/{month}/settlements")
def monthly(month: str, db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.monthly_settlements(db, month)}


@router.get("/debt-summary")
def debt_summary(db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.debt_summary(db)}


@router.get("/monthly/{month}/payments")
def monthly_payments(month: str, db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.month_payments(db, month)}


@router.get("/ledger")
def ledger(db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.ledger(db)}


@router.post("/payments", status_code=201, dependencies=[Depends(require_permission("materials.settle"))])
def payment(body: MoneyIn, idempotency_key: str = Header(..., alias="Idempotency-Key"),
            db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.payment(db, month=body.month, amount=body.amount,
                                payment_date=body.date, note=body.note,
                                idempotency_key=idempotency_key, user=user)}


@router.post("/advances", status_code=201, dependencies=[Depends(require_permission("materials.settle"))])
def advance(body: MoneyIn, idempotency_key: str = Header(..., alias="Idempotency-Key"),
            db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.advance(db, month=body.month, amount=body.amount,
                                advance_date=body.date, note=body.note,
                                idempotency_key=idempotency_key, user=user)}
