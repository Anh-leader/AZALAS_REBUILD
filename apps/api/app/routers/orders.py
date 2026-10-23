import uuid
from datetime import date
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.deps import current_user, require_owner, require_permission
from ..core.errors import ApiError
from ..models import Order, User, Warehouse
from ..services import orders as svc
from ..services import inventory as inventory_svc
from ..services import order_metrics as order_metrics_svc

router = APIRouter(tags=["orders"])


class OrderCreate(BaseModel):
    customer_id: uuid.UUID
    warehouse_mode: Literal["TAN_XUAN", "CA_KOI", "BOTH", "CUSTOMER_ORDER"]
    created_date: date
    delivery_date: date | None = None
    is_urgent: bool = False
    customer_note: str | None = Field(None, max_length=2000)
    media_ids: list[uuid.UUID] = Field(default_factory=list, max_length=20)


class BulkCustomerOrderInput(BaseModel):
    customer_id: uuid.UUID
    note: str | None = Field(None, max_length=2000)
    media_ids: list[uuid.UUID] = Field(default_factory=list, max_length=20)


class BulkOrderCreate(BaseModel):
    warehouse_mode: Literal["TAN_XUAN", "CA_KOI", "BOTH", "CUSTOMER_ORDER"]
    created_date: date
    delivery_date: date | None = None
    is_urgent: bool = False
    common_note: str | None = Field(None, max_length=2000)
    customers: list[BulkCustomerOrderInput] = Field(min_length=1, max_length=100)


class OrderItemInput(BaseModel):
    product_variant_id: uuid.UUID | None = None
    product_name: str | None = Field(None, max_length=300)
    sales_code: str | None = Field(None, max_length=100)
    internal_code: str | None = Field(None, max_length=100)
    color: str | None = Field(None, max_length=150)
    size: str | None = Field(None, max_length=30)
    warehouse_id: uuid.UUID
    quantity: Decimal = Decimal(0)
    unit_price_amount: int = 0
    sale_type: str | None = Field(None, max_length=50)
    product_image_url: str | None = None
    note: str | None = None


class PickSaveRequest(BaseModel):
    order_id: uuid.UUID
    items: list[OrderItemInput] = Field(min_length=1, max_length=500)
    staff_note: str | None = Field(None, max_length=2000)
    version: int = Field(ge=1)


@router.post("/orders", status_code=201)
def create_order(
    body: OrderCreate,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    orders = svc.create_order(db, user=user, idempotency_key=idempotency_key, **body.model_dump())
    return {"data": [svc.order_to_dict(o) for o in orders]}


@router.post("/orders/bulk", status_code=201)
def create_orders_bulk(
    body: BulkOrderCreate,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    if not idempotency_key:
        raise ApiError(422, "IDEMPOTENCY_KEY_REQUIRED", "Thiếu Idempotency-Key cho yêu cầu tạo nhiều khách.")
    rows = svc.create_orders_bulk(
        db,
        user=user,
        idempotency_key=idempotency_key,
        **body.model_dump(),
    )
    return {"data": rows}


@router.get("/orders/next-number")
def next_number(_=Depends(current_user)):
    return {"data": {"order_no": svc.generate_order_no()}}


@router.post("/orders/{order_id}/claim")
def claim_order(order_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.order_to_dict(svc.claim_order(db, order_id=order_id, user=user))}


class ReleaseClaimRequest(BaseModel):
    reason: str | None = Field(None, max_length=500)


@router.post("/orders/{order_id}/release-claim")
def release_claim(
    order_id: uuid.UUID,
    body: ReleaseClaimRequest,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    return {"data": svc.order_to_dict(svc.release_claim(db, order_id=order_id, user=user, reason=body.reason))}


@router.post("/orders/{order_id}/finish-picking")
def finish_picking(order_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.order_to_dict(inventory_svc.finish_picking_compat(db, order_id=order_id, user=user))}


@router.get("/orders/{order_id}")
def order_detail(order_id: uuid.UUID, db: Session = Depends(get_db), _=Depends(require_permission("order_detail.view"))):
    return {"data": inventory_svc.order_detail(db, order_id=order_id)}


@router.get("/orders/{order_id}/deleted-detail")
def deleted_order_detail(order_id: uuid.UUID, db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.deleted_order_detail(db, order_id=order_id)}


class DeleteOrderRequest(BaseModel):
    reason: str | None = Field(None, max_length=500)


@router.delete("/orders/{order_id}")
def delete_order(
    order_id: uuid.UUID,
    body: DeleteOrderRequest | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("order.delete")),
):
    return {"data": svc.delete_order(db, order_id=order_id, user=user, reason=body.reason if body else None)}


@router.put("/orders/{order_id}/pick")
def save_pick(order_id: uuid.UUID, body: PickSaveRequest,
              db: Session = Depends(get_db), user: User = Depends(current_user)):
    if body.order_id != order_id:
        raise ApiError(422, "ORDER_ID_MISMATCH", "Mã đơn trong URL và body không khớp.")
    return {"data": inventory_svc.save_pick(
        db, order_id=order_id, user=user,
        items=[item.model_dump() for item in body.items],
        staff_note=body.staff_note, version=body.version,
    )}


@router.get("/warehouses")
def warehouses(db: Session = Depends(get_db), _=Depends(current_user)):
    rows = db.scalars(select(Warehouse).where(Warehouse.active).order_by(Warehouse.sort_order))
    return {"data": [{"id": str(w.id), "code": w.code, "name": w.name} for w in rows]}


@router.get("/order-work-queue")
def work_queue(
    tab: str = "NEW", q: str | None = None, db: Session = Depends(get_db), user: User = Depends(require_permission("order_detail.view"))
):
    return {"data": svc.work_queue(db, tab=tab, q=q, user=user)}


@router.get("/order-work-queue/customers/{customer_id}")
def customer_queue(
    customer_id: uuid.UUID,
    warehouse_id: uuid.UUID,
    tab: str = "NEW",
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("order_detail.view")),
):
    return {
        "data": svc.customer_orders(db, customer_id=customer_id, warehouse_id=warehouse_id, tab=tab, user=user)
    }


@router.get("/picker-statistics")
def picker_statistics(month: str | None = None, warehouse_id: uuid.UUID | None = None,
                      db: Session = Depends(get_db), _=Depends(require_owner)):
    """OWNER only. Dùng chung order_metrics (created_date + classification chuẩn)."""
    return {"data": order_metrics_svc.picker_statistics(db, month=month, warehouse_id=warehouse_id)}
