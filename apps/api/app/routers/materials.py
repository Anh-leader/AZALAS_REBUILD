import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.deps import current_user, require_permission
from ..models import User
from ..services import materials as svc

router = APIRouter(tags=["materials"], dependencies=[Depends(require_permission("materials.view"))])


class PartnerIn(BaseModel):
    partner_code: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=250)
    partner_type: str = Field(min_length=2, max_length=40)
    phone: str | None = Field(None, max_length=30)
    address: str | None = None
    notes: str | None = None


class PartnerPatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=250)
    partner_type: str | None = Field(None, min_length=2, max_length=40)
    phone: str | None = Field(None, max_length=30)
    address: str | None = None
    status: str | None = None
    notes: str | None = None


@router.get("/partners")
def partners(q: str | None = None, partner_type: str | None = None, status: str | None = None,
             db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.list_partners(db, q, partner_type, status)}


@router.post("/partners", status_code=201, dependencies=[Depends(require_permission("materials.manage"))])
def create_partner(body: PartnerIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.create_partner(db, data=body.model_dump(), user=user)}


@router.patch("/partners/{partner_id}", dependencies=[Depends(require_permission("materials.manage"))])
def patch_partner(partner_id: uuid.UUID, body: PartnerPatch, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.update_partner(db, partner_id, values=body.model_dump(exclude_unset=True), user=user)}


class VariantIn(BaseModel):
    color_id: uuid.UUID | None = None
    size: str | None = Field(None, max_length=80)
    display_name: str = Field(min_length=1, max_length=300)


class MaterialIn(BaseModel):
    material_code: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=250)
    category: str = Field(min_length=2, max_length=40)
    unit: str = Field(min_length=1, max_length=30)
    notes: str | None = None
    variants: list[VariantIn] = Field(default_factory=list, max_length=100)


class MaterialPatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=250)
    category: str | None = Field(None, min_length=2, max_length=40)
    unit: str | None = Field(None, min_length=1, max_length=30)
    status: str | None = None
    notes: str | None = None


@router.get("/materials")
def materials(q: str | None = None, category: str | None = None,
              db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.list_materials(db, q, category)}


@router.post("/materials", status_code=201, dependencies=[Depends(require_permission("materials.manage"))])
def create_material(body: MaterialIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    data = body.model_dump(); data["variants"] = [row.model_dump() for row in body.variants]
    return {"data": svc.create_material(db, data=data, user=user)}


@router.patch("/materials/{material_id}", dependencies=[Depends(require_permission("materials.manage"))])
def patch_material(material_id: uuid.UUID, body: MaterialPatch,
                   db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.update_material(db, material_id, values=body.model_dump(exclude_unset=True), user=user)}


class ReceiptLineIn(BaseModel):
    material_variant_id: uuid.UUID
    quantity: float = Field(gt=0)
    weight: float | None = Field(None, ge=0)
    unit_price_amount: int = Field(gt=0)
    notes: str | None = None


class ReceiptIn(BaseModel):
    receipt_date: date
    partner_id: uuid.UUID
    category: str = Field(min_length=2, max_length=40)
    freight_amount: int = Field(0, ge=0)
    paid_amount: int = Field(0, ge=0)
    payment_method: str | None = None
    notes: str | None = None
    lines: list[ReceiptLineIn] = Field(min_length=1, max_length=200)


@router.post("/material-receipts", status_code=201, dependencies=[Depends(require_permission("materials.manage"))])
def create_receipt(body: ReceiptIn, idempotency_key: str = Header(..., alias="Idempotency-Key"),
                   db: Session = Depends(get_db), user: User = Depends(current_user)):
    data = body.model_dump(); data["lines"] = [row.model_dump() for row in body.lines]
    return {"data": svc.create_receipt(db, data=data, idempotency_key=idempotency_key, user=user)}


@router.get("/material-receipts")
def receipts(partner_id: uuid.UUID | None = None, category: str | None = None,
             date_from: date | None = None, date_to: date | None = None,
             db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.list_receipts(db, partner_id, category, date_from, date_to)}


class TransactionIn(BaseModel):
    partner_id: uuid.UUID
    transaction_type: str = Field(min_length=2, max_length=40)
    direction: str
    amount: int = Field(gt=0)
    occurred_at: datetime | None = None
    description: str | None = None


@router.post("/partner-transactions", status_code=201, dependencies=[Depends(require_permission("materials.manage"))])
def transaction(body: TransactionIn, idempotency_key: str = Header(..., alias="Idempotency-Key"),
                db: Session = Depends(get_db), user: User = Depends(current_user)):
    values = body.model_dump(); values["occurred_at"] = values["occurred_at"] or datetime.now(timezone.utc)
    return {"data": svc.create_transaction(db, **values, idempotency_key=idempotency_key, user=user)}


@router.get("/partner-transactions")
def transactions(partner_id: uuid.UUID | None = None, transaction_type: str | None = None, unsettled: bool = False,
                 db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.list_transactions(db, partner_id, transaction_type, unsettled)}


class AdvanceIn(BaseModel):
    partner_id: uuid.UUID
    advance_date: date
    amount: int = Field(gt=0)
    method: str
    note: str | None = None


@router.post("/partner-advances", status_code=201, dependencies=[Depends(require_permission("materials.settle"))])
def advance(body: AdvanceIn, idempotency_key: str = Header(..., alias="Idempotency-Key"),
            db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.partner_payment(db, partner_id=body.partner_id, amount=body.amount, method=body.method,
        allocations=[], note=body.note or f"Ứng trước ngày {body.advance_date.isoformat()}",
        idempotency_key=idempotency_key, user=user)}


class SettlementIn(BaseModel):
    partner_id: uuid.UUID
    period_month: date
    settlement_type: str = Field(min_length=2, max_length=40)
    transaction_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)
    notes: str | None = None


@router.post("/partner-settlements", status_code=201, dependencies=[Depends(require_permission("materials.settle"))])
def settlement(body: SettlementIn, idempotency_key: str = Header(..., alias="Idempotency-Key"),
               db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.create_settlement(db, **body.model_dump(), idempotency_key=idempotency_key, user=user)}


@router.get("/partner-settlements")
def settlements(partner_id: uuid.UUID | None = None, settlement_type: str | None = None,
                period_month: date | None = None, status: str | None = None,
                db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.list_settlements(db, partner_id, settlement_type, period_month, status)}


class AllocationIn(BaseModel):
    target_type: str
    target_id: uuid.UUID
    allocated_amount: int = Field(gt=0)


class PaymentIn(BaseModel):
    partner_id: uuid.UUID
    amount: int = Field(gt=0)
    method: str
    allocations: list[AllocationIn] = Field(default_factory=list)
    note: str | None = None


@router.post("/partner-payments", status_code=201, dependencies=[Depends(require_permission("materials.settle"))])
def payment(body: PaymentIn, idempotency_key: str = Header(..., alias="Idempotency-Key"),
            db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.partner_payment(db, partner_id=body.partner_id, amount=body.amount, method=body.method,
        allocations=[row.model_dump() for row in body.allocations], note=body.note,
        idempotency_key=idempotency_key, user=user)}


@router.get("/partners/{partner_id}/debt-ledger")
def partner_debt(partner_id: uuid.UUID, db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.debt_statement(db, partner_id)}


class PartnerFileIn(BaseModel):
    media_id: uuid.UUID
    transaction_id: uuid.UUID | None = None
    purpose: str = Field(min_length=1, max_length=80)


@router.post("/partners/{partner_id}/files", status_code=201, dependencies=[Depends(require_permission("materials.manage"))])
def partner_file(partner_id: uuid.UUID, body: PartnerFileIn,
                 db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.attach_file(db, partner_id=partner_id, **body.model_dump(), user=user)}
