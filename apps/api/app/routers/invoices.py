import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Header
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.deps import current_user, require_permission
from ..core.errors import ApiError
from ..models import Invoice, Order, User
from ..services.orders import order_to_dict
from ..services import finance as svc

router = APIRouter(prefix="/invoices", tags=["invoices"])


class PreviewIn(BaseModel):
    customer_id: uuid.UUID
    order_ids: list[uuid.UUID] = Field(min_length=1)
    surcharge_amount: int = Field(0, ge=0)
    return_ids: list[uuid.UUID] = Field(default_factory=list)
    expected_debt_amount: int | None = None


class PaymentLineIn(BaseModel):
    amount: int = Field(gt=0)
    method: Literal["CASH", "BANK_TRANSFER", "OTHER"]
    note: str | None = Field(None, max_length=1000)


class CloseIn(PreviewIn):
    payments: list[PaymentLineIn] = Field(default_factory=list)
    note: str | None = Field(None, max_length=2000)
    captured_media_id: uuid.UUID | None = None


class CaptureIn(BaseModel):
    customer_id: uuid.UUID
    order_ids: list[uuid.UUID] = Field(min_length=1)
    media_id: uuid.UUID


class OrdersIn(BaseModel):
    order_ids: list[uuid.UUID] = Field(min_length=1)


class VoidIn(BaseModel):
    version: int = Field(ge=1)
    reason: str = Field(min_length=1, max_length=2000)


class DraftCreateIn(BaseModel):
    customer_id: uuid.UUID
    order_ids: list[uuid.UUID] = Field(min_length=1)


class DraftItemIn(BaseModel):
    order_id: uuid.UUID
    item_id: uuid.UUID
    quantity: float | None = None
    unit_price_amount: int | None = None


class DraftUpdateIn(BaseModel):
    items: list[DraftItemIn] | None = None
    old_debt_override: int | None = None
    surcharge_amount: int | None = None
    note: str | None = None
    payments: list[PaymentLineIn] | None = None


class DraftCaptureIn(BaseModel):
    media_id: uuid.UUID


@router.get("")
def list_invoices(status: str | None = None, customer_id: uuid.UUID | None = None,
                  db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.list_invoices(db, status=status, customer_id=customer_id)}


@router.post("/preview")
def preview(body: PreviewIn, db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.preview_invoice(db, **body.model_dump())}


@router.get("/eligible-orders")
def eligible_orders(db: Session = Depends(get_db), _=Depends(current_user)):
    rows = list(db.scalars(select(Order).where(
        Order.status.in_(svc.ELIGIBLE_ORDER_STATUSES),
        Order.billing_status.in_(svc.OPEN_BILLING_STATUSES),
    ).order_by(Order.customer_id, Order.created_at)).unique())
    return {"data": [order_to_dict(row) for row in rows]}


@router.get("/work-queue")
def work_queue(status: str = "PENDING", q: str | None = None,
               db: Session = Depends(get_db), _=Depends(current_user)):
    if status not in ("PENDING", "SENT", "DELETED"):
        raise ApiError(422, "INVALID_STATUS", "Trạng thái hóa đơn không hợp lệ.")
    return {"data": svc.invoice_work_queue(db, status=status, q=q)}


@router.post("/capture-image", status_code=201)
def capture_image(body: CaptureIn, db: Session = Depends(get_db),
                  user: User = Depends(require_permission("sales.invoice"))):
    return {"data": svc.capture_invoice_image(db, customer_id=body.customer_id,
                                              order_ids=body.order_ids, media_id=body.media_id, user=user)}


@router.get("/capture-image")
def get_capture_image(customer_id: uuid.UUID, order_ids: str,
                      db: Session = Depends(get_db), _=Depends(require_permission("sales.invoice"))):
    try:
        parsed_order_ids = [uuid.UUID(value) for value in order_ids.split(",") if value]
    except ValueError as exc:
        raise ApiError(422, "ORDER_IDS_REQUIRED", "Danh sách đơn hàng không hợp lệ.") from exc
    return {"data": svc.get_invoice_capture(db, customer_id=customer_id, order_ids=parsed_order_ids)}


@router.post("/orders/delete")
def delete_pending(body: OrdersIn, db: Session = Depends(get_db),
                   user: User = Depends(require_permission("sales.invoice"))):
    return {"data": svc.delete_pending_orders(db, order_ids=body.order_ids, user=user)}


@router.post("/orders/restore")
def restore_deleted(body: OrdersIn, db: Session = Depends(get_db),
                    user: User = Depends(require_permission("sales.invoice"))):
    return {"data": svc.restore_deleted_orders(db, order_ids=body.order_ids, user=user)}


@router.post("/close", status_code=201)
def close(body: CloseIn, idempotency_key: str = Header(..., alias="Idempotency-Key"),
          db: Session = Depends(get_db), user: User = Depends(require_permission("sales.invoice"))):
    data = body.model_dump()
    data["payments"] = [row.model_dump() for row in body.payments]
    return {"data": svc.close_invoice(db, **data, idempotency_key=idempotency_key, user=user)}


@router.get("/customers/{customer_id}/pending-orders")
def customer_pending_orders(customer_id: uuid.UUID, db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.customer_pending_orders(db, customer_id=customer_id)}


@router.post("/drafts", status_code=201)
def create_draft(body: DraftCreateIn, db: Session = Depends(get_db),
                 user: User = Depends(require_permission("sales.invoice"))):
    return {"data": svc.draft_invoice(db, customer_id=body.customer_id,
                                      order_ids=body.order_ids, user=user)}


@router.get("/drafts/{draft_id}")
def get_draft(draft_id: uuid.UUID, db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.get_invoice_draft(db, draft_id=draft_id)}


@router.patch("/drafts/{draft_id}")
def update_draft(draft_id: uuid.UUID, body: DraftUpdateIn, db: Session = Depends(get_db),
                 user: User = Depends(require_permission("sales.invoice"))):
    data = body.model_dump(exclude_unset=True)
    items = [row.model_dump() for row in body.items] if body.items is not None else None
    payments = [row.model_dump() for row in body.payments] if body.payments is not None else None
    return {"data": svc.update_invoice_draft(
        db, draft_id=draft_id, user=user, items=items,
        old_debt_override=data.get("old_debt_override"),
        old_debt_set="old_debt_override" in data,
        surcharge_amount=data.get("surcharge_amount"),
        note=data.get("note"),
        payments=payments,
    )}


@router.post("/drafts/{draft_id}/capture", status_code=201)
def capture_draft(draft_id: uuid.UUID, body: DraftCaptureIn, db: Session = Depends(get_db),
                  user: User = Depends(require_permission("sales.invoice"))):
    return {"data": svc.capture_invoice_draft(db, draft_id=draft_id, media_id=body.media_id, user=user)}


@router.post("/drafts/{draft_id}/finalize", status_code=201)
def finalize_draft(draft_id: uuid.UUID, idempotency_key: str = Header(..., alias="Idempotency-Key"),
                   db: Session = Depends(get_db), user: User = Depends(require_permission("sales.invoice"))):
    return {"data": svc.finalize_invoice_draft(db, draft_id=draft_id,
                                               idempotency_key=idempotency_key, user=user)}


@router.get("/{invoice_id}")
def detail(invoice_id: uuid.UUID, db: Session = Depends(get_db), _=Depends(current_user)):
    invoice = db.get(Invoice, invoice_id)
    if not invoice:
        raise ApiError(404, "INVOICE_NOT_FOUND", "Không tìm thấy hóa đơn.")
    return {"data": svc._invoice_dict(invoice, db)}


@router.get("/{invoice_id}/print", response_class=HTMLResponse)
def print_invoice(invoice_id: uuid.UUID, db: Session = Depends(get_db), _=Depends(current_user)):
    invoice = db.get(Invoice, invoice_id)
    if not invoice:
        raise ApiError(404, "INVOICE_NOT_FOUND", "Không tìm thấy hóa đơn.")
    return HTMLResponse(svc.invoice_print_html(invoice))


@router.post("/{invoice_id}/void")
def void(invoice_id: uuid.UUID, body: VoidIn,
         idempotency_key: str = Header(..., alias="Idempotency-Key"),
         db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.void_invoice(db, invoice_id=invoice_id, version=body.version,
                                    reason=body.reason, idempotency_key=idempotency_key, user=user)}
