import uuid
from datetime import date

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.deps import current_user, require_permission
from ..models import User
from ..services import zippers as svc

router = APIRouter(prefix="/materials/zippers", tags=["materials-zippers"],
                   dependencies=[Depends(require_permission("materials.view"))])


class ZipperCatalogIn(BaseModel):
    name: str = Field(min_length=1, max_length=250)
    unit_price_amount: int = Field(gt=0)
    effective_date: date


class ZipperReceiptLineIn(BaseModel):
    material_id: uuid.UUID
    quantity: float = Field(gt=0)
    unit_price_amount: int = Field(gt=0)


class ZipperReceiptIn(BaseModel):
    receipt_date: date
    lines: list[ZipperReceiptLineIn] = Field(min_length=1, max_length=200)


class ZipperMoneyIn(BaseModel):
    month: str = Field(min_length=7, max_length=7)
    amount: int = Field(gt=0)
    date: date
    note: str | None = Field(None, max_length=500)


@router.get("/catalog")
def catalog(q: str | None = None, db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.zipper_catalog(db, q)}


@router.post("/catalog", status_code=201, dependencies=[Depends(require_permission("materials.manage"))])
def save_catalog(body: ZipperCatalogIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.save_zipper_item(db, name=body.name, unit_price_amount=body.unit_price_amount,
                                         effective_date=body.effective_date, user=user)}


@router.get("/{material_id}/price-history")
def price_history(material_id: uuid.UUID, db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.zipper_price_history(db, material_id)}


@router.post("/receipts", status_code=201, dependencies=[Depends(require_permission("materials.manage"))])
def create_receipt(body: ZipperReceiptIn, idempotency_key: str = Header(..., alias="Idempotency-Key"),
                   db: Session = Depends(get_db), user: User = Depends(current_user)):
    lines = [row.model_dump() for row in body.lines]
    return {"data": svc.create_zipper_receipt(db, receipt_date=body.receipt_date, lines=lines,
                                              idempotency_key=idempotency_key, user=user)}


@router.get("/receipts")
def receipts(date_from: date | None = None, date_to: date | None = None,
             db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.list_zipper_receipts(db, date_from=date_from, date_to=date_to)}


@router.get("/debt-summary")
def debt_summary(db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.zipper_debt_summary(db)}


@router.get("/monthly/{month}/receipts")
def monthly_receipts(month: str, db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.zipper_month_receipts(db, month)}


@router.get("/monthly/{month}/payments")
def monthly_payments(month: str, db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.zipper_month_payments(db, month)}


@router.get("/ledger")
def ledger(db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.zipper_ledger(db)}


@router.post("/payments", status_code=201, dependencies=[Depends(require_permission("materials.settle"))])
def payment(body: ZipperMoneyIn, idempotency_key: str = Header(..., alias="Idempotency-Key"),
            db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.zipper_payment(db, month=body.month, amount=body.amount,
                                       payment_date=body.date, note=body.note,
                                       idempotency_key=idempotency_key, user=user)}


@router.post("/advances", status_code=201, dependencies=[Depends(require_permission("materials.settle"))])
def advance(body: ZipperMoneyIn, idempotency_key: str = Header(..., alias="Idempotency-Key"),
            db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.zipper_advance(db, month=body.month, amount=body.amount,
                                       advance_date=body.date, note=body.note,
                                       idempotency_key=idempotency_key, user=user)}
