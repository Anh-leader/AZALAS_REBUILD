import uuid
from datetime import date

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.deps import current_user, require_permission
from ..models import User
from ..services import fabric as svc

router = APIRouter(
    prefix="/materials/fabric",
    tags=["materials-fabric"],
    dependencies=[Depends(require_permission("materials.view"))],
)


class SupplierIn(BaseModel):
    name: str = Field(min_length=1, max_length=250)
    phone: str | None = Field(None, max_length=30)


class FabricReceiptLineIn(BaseModel):
    entry_type: str = Field(pattern="^(PURCHASE|RETURN)$")
    receipt_date: date
    fabric_name: str = Field(min_length=1, max_length=250)
    unit: str = Field(pattern="^(KG|METER)$")
    roll_count: float = Field(ge=0, le=1_000_000)
    gross_quantity: float = Field(gt=0, le=1_000_000_000)
    deduction_enabled: bool = True
    unit_price_amount: int = Field(ge=0, le=9_000_000_000_000_000)
    transport_amount: int = Field(default=0, ge=-9_000_000_000_000_000, le=9_000_000_000_000_000)


class FabricReceiptIn(BaseModel):
    supplier_id: uuid.UUID
    lines: list[FabricReceiptLineIn] = Field(min_length=1, max_length=200)


class FabricPaymentLineIn(BaseModel):
    payment_date: date
    amount: int = Field(gt=0, le=9_000_000_000_000_000)
    note: str | None = Field(None, max_length=500)
    method: str = Field(default="OTHER", pattern="^(CASH|BANK_TRANSFER|OTHER)$")


class FabricPaymentsIn(BaseModel):
    supplier_id: uuid.UUID
    payments: list[FabricPaymentLineIn] = Field(min_length=1, max_length=100)


@router.get("/suppliers")
def suppliers(db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.list_suppliers(db)}


@router.get("/debt-summary")
def debt_summary(db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.debt_summary(db)}


@router.get("/suppliers/{supplier_id}/statement")
def supplier_statement(supplier_id: uuid.UUID, db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.supplier_statement(db, supplier_id)}


@router.post(
    "/suppliers",
    status_code=201,
    dependencies=[Depends(require_permission("materials.manage"))],
)
def create_supplier(body: SupplierIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.create_supplier(db, name=body.name, phone=body.phone, user=user)}


@router.post(
    "/receipts",
    status_code=201,
    dependencies=[Depends(require_permission("materials.manage"))],
)
def create_receipt(
    body: FabricReceiptIn,
    idempotency_key: str = Header(..., alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    return {
        "data": svc.create_receipt(
            db,
            supplier_id=body.supplier_id,
            lines=[line.model_dump() for line in body.lines],
            idempotency_key=idempotency_key,
            user=user,
        )
    }


@router.post(
    "/payments",
    status_code=201,
    dependencies=[Depends(require_permission("materials.settle"))],
)
def create_payments(
    body: FabricPaymentsIn,
    idempotency_key: str = Header(..., alias="Idempotency-Key", max_length=77),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    return {
        "data": svc.create_payments(
            db,
            supplier_id=body.supplier_id,
            payments=[payment.model_dump() for payment in body.payments],
            idempotency_key=idempotency_key,
            user=user,
        )
    }
