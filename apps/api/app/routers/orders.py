import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.deps import current_user, require_owner
from ..core.errors import ApiError
from ..models import Order, User, Warehouse
from ..services import orders as svc
from ..services import inventory as inventory_svc

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


@router.post("/orders/{order_id}/finish-picking")
def finish_picking(order_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.order_to_dict(inventory_svc.finish_picking_compat(db, order_id=order_id, user=user))}


@router.get("/orders/{order_id}")
def order_detail(order_id: uuid.UUID, db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": inventory_svc.order_detail(db, order_id=order_id)}


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
    tab: str = "NEW", q: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)
):
    return {"data": svc.work_queue(db, tab=tab, q=q, user=user)}


@router.get("/order-work-queue/customers/{customer_id}")
def customer_queue(
    customer_id: uuid.UUID,
    warehouse_id: uuid.UUID,
    tab: str = "NEW",
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    return {
        "data": svc.customer_orders(db, customer_id=customer_id, warehouse_id=warehouse_id, tab=tab, user=user)
    }


@router.get("/picker-statistics")
def picker_statistics(month: str | None = None, warehouse_id: uuid.UUID | None = None,
                      db: Session = Depends(get_db), _=Depends(require_owner)):
    """OWNER only. Đã soạn tính theo picked_at, Đang soạn theo updated_at."""
    today = datetime.now(svc.TZ).date()
    try:
        y, m = (int(x) for x in month.split("-")) if month else (today.year, today.month)
        start = datetime(y, m, 1, tzinfo=svc.TZ)
    except ValueError as exc:
        raise ApiError(422, "INVALID_MONTH", "Tháng phải có dạng YYYY-MM.") from exc
    end = datetime(y + (m == 12), m % 12 + 1, 1, tzinfo=svc.TZ)

    def in_month(dt: datetime | None) -> bool:
        if dt is None:
            return False
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return start <= dt < end

    pickers: dict[str, dict] = {}
    stmt = select(Order).where(Order.claimed_by.is_not(None))
    if warehouse_id:
        stmt = stmt.where(Order.warehouse_id == warehouse_id)
    for o in db.scalars(stmt).unique():
        picked = in_month(o.picked_at)
        picking = o.status == "PICKING" and in_month(o.updated_at)
        if not (picked or picking):
            continue
        p = pickers.setdefault(
            str(o.claimed_by),
            {"user_id": str(o.claimed_by), "name": o.claimer.display_name, "picked": 0, "picking": 0,
             "by_warehouse": {}, "orders": []},
        )
        p["picked" if picked else "picking"] += 1
        p["by_warehouse"][o.warehouse.name] = p["by_warehouse"].get(o.warehouse.name, 0) + 1
        p["orders"].append(svc.order_to_dict(o))
    rows = sorted(pickers.values(), key=lambda p: -(p["picked"] + p["picking"]))
    return {
        "data": {
            "month": f"{y:04d}-{m:02d}",
            "total": sum(p["picked"] + p["picking"] for p in rows),
            "picked": sum(p["picked"] for p in rows),
            "picking": sum(p["picking"] for p in rows),
            "pickers": rows,
        }
    }
