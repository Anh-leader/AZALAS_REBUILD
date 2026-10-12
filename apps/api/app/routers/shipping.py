import uuid
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.deps import current_user
from ..models import User
from ..services import shipping as svc

router = APIRouter(tags=["shipping"])


class ShippingEventIn(BaseModel):
    event: Literal["START_SHIPPING", "COMPLETE", "RETURN"]
    version: int = Field(ge=1)
    note: str | None = Field(None, max_length=1000)


@router.get("/shipments/work-queue")
def work_queue(tab: str = "WAITING", q: str | None = None,
               db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.work_queue(db, tab=tab, q=q)}


@router.post("/orders/{order_id}/shipping-events")
def shipping_event(order_id: uuid.UUID, body: ShippingEventIn,
                   db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.transition(db, order_id=order_id, event=body.event,
                                   version=body.version, note=body.note, user=user)}
