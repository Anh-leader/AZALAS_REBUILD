import uuid
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.deps import current_user
from ..models import User
from ..services import finance as svc

router = APIRouter(prefix="/payments", tags=["payments"])


class AllocationIn(BaseModel):
    target_type: Literal["INVOICE"]
    target_id: uuid.UUID
    allocated_amount: int = Field(gt=0)


class PaymentIn(BaseModel):
    customer_id: uuid.UUID
    paid_at: datetime | None = None
    amount: int = Field(gt=0)
    method: Literal["CASH", "BANK_TRANSFER", "RETURN_CREDIT", "OTHER"]
    note: str | None = Field(None, max_length=2000)
    allocations: list[AllocationIn] = Field(default_factory=list)


@router.post("", status_code=201)
def create(body: PaymentIn, idempotency_key: str = Header(..., alias="Idempotency-Key"),
           db: Session = Depends(get_db), user: User = Depends(current_user)):
    data = body.model_dump()
    data["allocations"] = [row.model_dump() for row in body.allocations]
    return {"data": svc.create_payment(db, **data, idempotency_key=idempotency_key, user=user)}


@router.get("")
def list_rows(customer_id: uuid.UUID | None = None, db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.list_payments(db, customer_id=customer_id)}
