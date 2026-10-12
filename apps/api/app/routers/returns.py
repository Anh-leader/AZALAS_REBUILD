import uuid

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.deps import current_user
from ..core.errors import ApiError
from ..models import ReturnRecord, User
from ..services import returns as svc

router = APIRouter(prefix="/returns", tags=["returns"])


class ReturnItemIn(BaseModel):
    product_variant_id: uuid.UUID | None = None
    description: str | None = Field(None, max_length=300)
    quantity: float = Field(gt=0)
    unit_credit_amount: int = Field(ge=0)
    condition: str | None = Field(None, max_length=80)
    restock: bool = True


class ReturnCreateIn(BaseModel):
    customer_id: uuid.UUID
    warehouse_id: uuid.UUID
    items: list[ReturnItemIn] = Field(min_length=1)
    note: str | None = Field(None, max_length=2000)


class ReturnUpdateIn(BaseModel):
    version: int = Field(ge=1)
    items: list[ReturnItemIn] | None = None
    note: str | None = Field(None, max_length=2000)


class ReturnApproveIn(BaseModel):
    version: int = Field(ge=1)
    restock: bool = True
    credit: bool = True


class ReturnCancelIn(BaseModel):
    version: int = Field(ge=1)


@router.post("", status_code=201)
def create(body: ReturnCreateIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    data = body.model_dump()
    data["items"] = [row.model_dump() for row in body.items]
    return {"data": svc.create_return(db, **data, user=user)}


@router.get("")
def list_rows(status: str | None = None, customer_id: uuid.UUID | None = None,
              db: Session = Depends(get_db), _=Depends(current_user)):
    stmt = select(ReturnRecord).order_by(ReturnRecord.created_at.desc())
    if status:
        stmt = stmt.where(ReturnRecord.status == status)
    if customer_id:
        stmt = stmt.where(ReturnRecord.customer_id == customer_id)
    return {"data": [svc.return_dict(row, db) for row in db.scalars(stmt)]}


@router.get("/{return_id}")
def detail(return_id: uuid.UUID, db: Session = Depends(get_db), _=Depends(current_user)):
    row = db.get(ReturnRecord, return_id)
    if not row:
        raise ApiError(404, "RETURN_NOT_FOUND", "Không tìm thấy phiếu hàng trả.")
    return {"data": svc.return_dict(row, db)}


@router.patch("/{return_id}")
def update(return_id: uuid.UUID, body: ReturnUpdateIn,
           db: Session = Depends(get_db), user: User = Depends(current_user)):
    data = body.model_dump()
    data["items"] = [row.model_dump() for row in body.items] if body.items is not None else None
    return {"data": svc.update_return(db, return_id=return_id, **data, user=user)}


@router.post("/{return_id}/approve")
def approve(return_id: uuid.UUID, body: ReturnApproveIn,
            idempotency_key: str = Header(..., alias="Idempotency-Key"),
            db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.approve_return(db, return_id=return_id, **body.model_dump(),
                                      idempotency_key=idempotency_key, user=user)}


@router.post("/{return_id}/cancel")
def cancel(return_id: uuid.UUID, body: ReturnCancelIn,
           idempotency_key: str = Header(..., alias="Idempotency-Key"),
           db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.cancel_return(db, return_id=return_id, version=body.version,
                                     idempotency_key=idempotency_key, user=user)}
