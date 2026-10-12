import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.deps import current_user
from ..services import inventory as svc

router = APIRouter(tags=["inventory"])


@router.get("/products")
def products(q: str | None = None, db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.list_products(db, q=q)}


@router.get("/product-variants")
def variants(q: str | None = None, warehouse_id: uuid.UUID | None = None,
             db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.list_variants(db, q=q, warehouse_id=warehouse_id)}


@router.get("/inventory/balances")
def balances(q: str | None = None, warehouse_id: uuid.UUID | None = None,
             db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.list_balances(db, q=q, warehouse_id=warehouse_id)}
