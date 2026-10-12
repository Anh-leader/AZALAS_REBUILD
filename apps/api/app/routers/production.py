import uuid
from datetime import date, datetime

from fastapi import APIRouter, Body, Depends, Header
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.deps import current_user, require_owner, require_permission
from ..core.errors import ApiError
from ..models import CuttingTeam, FabricType, Product, ProductionBatch, User, Workshop, WorkshopSettlement
from ..services import production as svc

router = APIRouter(tags=["production"], dependencies=[Depends(require_permission("production.view"))])


class SizePlanIn(BaseModel):
    color_id: uuid.UUID | None = None
    color: str | None = Field(None, max_length=150)
    variant_code: str | None = Field(None, max_length=80)
    size: str = Field(min_length=1, max_length=30)
    layers: float = Field(ge=0)
    ratio: float = Field(ge=0)
    planned_quantity: float = Field(ge=0)
    product_variant_id: uuid.UUID | None = None
    planned_warehouse_id: uuid.UUID | None = None
    notes: str | None = None


class BatchIn(BaseModel):
    mode: str
    cut_date: date
    workshop_id: uuid.UUID
    cutting_team_id: uuid.UUID
    pattern_code: str
    product_id: uuid.UUID | None = None
    product_name: str
    size_expression: str | None = None
    ratio_expression: str | None = None
    layer_expression: str
    expected_delivery_date: date | None = None
    customer_id: uuid.UUID | None = None
    workshop_unit_price_amount: int = Field(0, ge=0)
    planned_warehouse_id: uuid.UUID
    fabric_type_id: uuid.UUID | None = None
    notes: str | None = None
    media_ids: list[uuid.UUID] = Field(default_factory=list, max_length=30)
    size_plans: list[SizePlanIn] = Field(default_factory=list)


class BatchPatchIn(BaseModel):
    version: int = Field(ge=1)
    expected_delivery_date: date | None = None
    production_status: str | None = Field(None, max_length=40)
    notes: str | None = Field(None, max_length=2000)
    product_name: str | None = Field(None, max_length=300)
    pattern_code: str | None = Field(None, max_length=100)
    layer_expression: str | None = Field(None, max_length=200)
    workshop_id: uuid.UUID | None = None
    cutting_team_id: uuid.UUID | None = None
    cut_date: date | None = None
    workshop_unit_price_amount: int | None = Field(None, ge=0)


class ForceCloseIn(BaseModel):
    reason: str = Field(min_length=3, max_length=2000)


class ReceiptLineIn(BaseModel):
    batch_size_plan_id: uuid.UUID | None = None
    product_variant_id: uuid.UUID | None = None
    received_now: float
    import_to_stock: bool = False
    notes: str | None = None


class ReceiptIn(BaseModel):
    receipt_date: date
    warehouse_id: uuid.UUID
    color_id: uuid.UUID | None = None
    lines: list[ReceiptLineIn] = Field(min_length=1, max_length=200)
    notes: str | None = None


class MaterialLineIn(BaseModel):
    material_id: uuid.UUID | None = None
    name: str = Field(min_length=1, max_length=120)
    total_required: float = Field(gt=0)
    quantity: float | None = None
    deliver_full: bool = False
    notes: str | None = None


class MaterialDeliveryIn(BaseModel):
    delivery_date: date
    received_by: str | None = Field(None, max_length=200)
    notes: str | None = Field(None, max_length=500)
    items: list[MaterialLineIn] = Field(min_length=1, max_length=100)


@router.get("/production/master-data")
def master_data(db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.master_data(db)}


@router.post("/production/batches", status_code=201, dependencies=[Depends(require_permission("production.manage"))])
def create_batch(body: BatchIn, idempotency_key: str = Header(..., alias="Idempotency-Key"),
                 db: Session = Depends(get_db), user: User = Depends(current_user)):
    data = body.model_dump(); data["size_plans"] = [row.model_dump() for row in body.size_plans]
    return {"data": svc.create_batch(db, data=data, user=user, idempotency_key=idempotency_key)}


@router.get("/production/batches")
def list_batches(q: str | None = None, workshop_id: uuid.UUID | None = None,
                 production_status: str | None = None, receipt_status: str | None = None,
                 settlement_status: str | None = None, batch_type: str | None = None,
                 payment_status: str | None = None,
                 db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.list_batches(db, q=q, workshop_id=workshop_id, production_status=production_status,
                                     receipt_status=receipt_status, settlement_status=settlement_status,
                                     batch_type=batch_type, payment_status=payment_status)}


@router.get("/production/batches/summary")
def batches_summary(db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.batch_summary(db)}


@router.get("/production/batches/{batch_id}")
def batch_detail(batch_id: uuid.UUID, db: Session = Depends(get_db), _=Depends(current_user)):
    row = db.get(ProductionBatch, batch_id)
    if not row: raise ApiError(404, "BATCH_NOT_FOUND", "Không tìm thấy mâm.")
    return {"data": svc.batch_dict(row, db, full=True)}


@router.post("/production/customer-orders/{batch_id}/start-picking", dependencies=[Depends(require_permission("production.manage"))])
def start_customer_order_picking(batch_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.start_customer_order_picking(db, batch_id, user=user)}


@router.post("/production/customer-orders/{batch_id}/mark-debt-order", dependencies=[Depends(require_permission("production.manage"))])
def mark_customer_order_debt(batch_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.mark_customer_order_debt(db, batch_id, user=user)}


@router.post("/production/customer-orders/{batch_id}/delete", dependencies=[Depends(require_owner)])
def delete_customer_order(batch_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.delete_customer_order(db, batch_id, user=user)}


@router.patch("/production/batches/{batch_id}", dependencies=[Depends(require_permission("production.manage"))])
def patch_batch(batch_id: uuid.UUID, body: BatchPatchIn,
                db: Session = Depends(get_db), user: User = Depends(current_user)):
    values = body.model_dump(exclude={"version"}, exclude_unset=True)
    return {"data": svc.update_batch(db, batch_id, version=body.version, values=values, user=user)}


@router.post("/production/batches/{batch_id}/force-close")
def force_close(batch_id: uuid.UUID, body: ForceCloseIn,
                db: Session = Depends(get_db), user: User = Depends(require_owner)):
    return {"data": svc.force_close(db, batch_id, reason=body.reason, user=user)}


@router.post("/production/batches/{batch_id}/receipts", status_code=201, dependencies=[Depends(require_permission("production.manage"))])
def create_receipt(batch_id: uuid.UUID, body: ReceiptIn,
                   idempotency_key: str = Header(..., alias="Idempotency-Key"),
                   db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.create_receipt(db, batch_id, receipt_date=body.receipt_date,
        warehouse_id=body.warehouse_id, color_id=body.color_id,
        lines=[row.model_dump() for row in body.lines], notes=body.notes,
        idempotency_key=idempotency_key, user=user)}


@router.get("/production/batches/{batch_id}/receipts")
def receipts(batch_id: uuid.UUID, db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.list_receipts(db, batch_id)}


class ImportToInventoryIn(BaseModel):
    quantity: float = Field(gt=0)
    notes: str | None = Field(None, max_length=1000)


@router.post("/production/batches/{batch_id}/import-to-inventory", status_code=201, dependencies=[Depends(require_permission("production.manage"))])
def import_to_inventory(batch_id: uuid.UUID, body: ImportToInventoryIn,
                        idempotency_key: str = Header(..., alias="Idempotency-Key"),
                        db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.import_to_inventory(db, batch_id, quantity=body.quantity, notes=body.notes,
                                             idempotency_key=idempotency_key, user=user)}


@router.post("/production/batches/{batch_id}/material-deliveries", status_code=201, dependencies=[Depends(require_permission("production.manage"))])
def material_delivery(batch_id: uuid.UUID, body: MaterialDeliveryIn,
                      idempotency_key: str = Header(..., alias="Idempotency-Key"),
                      db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.create_material_delivery(db, batch_id, delivery_date=body.delivery_date,
        received_by=body.received_by, notes=body.notes,
        items=[row.model_dump() for row in body.items], idempotency_key=idempotency_key, user=user)}


@router.get("/production/batches/{batch_id}/material-deliveries")
def material_deliveries(batch_id: uuid.UUID, db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.material_delivery_history(db, batch_id)}


class WorkshopIn(BaseModel):
    workshop_code: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=250)
    phone: str | None = Field(None, max_length=30)
    address: str | None = None
    notes: str | None = None


@router.get("/workshops")
def workshops(q: str | None = None, status: str | None = None,
              db: Session = Depends(get_db), _=Depends(current_user)):
    rows = list(db.scalars(select(Workshop).order_by(Workshop.name)))
    needle = (q or "").casefold()
    if needle: rows = [row for row in rows if needle in row.name.casefold() or needle in row.workshop_code.casefold()]
    if status: rows = [row for row in rows if row.status == status]
    return {"data": [svc.workshop_dict(row, db) for row in rows]}


@router.post("/workshops", status_code=201, dependencies=[Depends(require_permission("production.manage"))])
def create_workshop(body: WorkshopIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.create_workshop(db, **body.model_dump(), user=user)}


@router.get("/workshops/{workshop_id}/settlement-candidates")
def candidates(workshop_id: uuid.UUID, db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.settlement_candidates(db, workshop_id)}


class SettlementIn(BaseModel):
    workshop_id: uuid.UUID
    batch_ids: list[uuid.UUID] = Field(default_factory=list)
    supplemental_ids: list[uuid.UUID] = Field(default_factory=list)
    settlement_date: date
    notes: str | None = None


@router.post("/workshop-settlements", status_code=201, dependencies=[Depends(require_permission("production.settle"))])
def create_settlement(body: SettlementIn, idempotency_key: str = Header(..., alias="Idempotency-Key"),
                      db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.create_settlement(db, **body.model_dump(), idempotency_key=idempotency_key, user=user)}


@router.get("/workshop-settlements")
def settlements(workshop_id: uuid.UUID | None = None, status: str | None = None,
                db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.list_settlements(db, workshop_id, status)}


@router.get("/workshop-settlements/{settlement_id}")
def settlement_detail(settlement_id: uuid.UUID, db: Session = Depends(get_db), _=Depends(current_user)):
    row = db.get(WorkshopSettlement, settlement_id)
    if not row: raise ApiError(404, "SETTLEMENT_NOT_FOUND", "Không tìm thấy bảng kê.")
    return {"data": svc.settlement_dict(row, db)}


class AllocationIn(BaseModel):
    target_id: uuid.UUID
    allocated_amount: int = Field(gt=0)


class PartyPaymentIn(BaseModel):
    workshop_id: uuid.UUID | None = None
    cutting_team_id: uuid.UUID | None = None
    amount: int = Field(gt=0)
    method: str
    allocations: list[AllocationIn] = Field(default_factory=list)
    note: str | None = None
    paid_at: datetime | None = None


@router.post("/workshop-payments", status_code=201, dependencies=[Depends(require_permission("production.settle"))])
def workshop_payment(body: PartyPaymentIn, idempotency_key: str = Header(..., alias="Idempotency-Key"),
                     db: Session = Depends(get_db), user: User = Depends(current_user)):
    if not body.workshop_id: raise ApiError(422, "WORKSHOP_REQUIRED", "Thiếu nhà may.")
    return {"data": svc.create_party_payment(db, party_type="WORKSHOP", party_id=body.workshop_id,
        amount=body.amount, method=body.method, allocations=[row.model_dump() for row in body.allocations],
        note=body.note, idempotency_key=idempotency_key, user=user, paid_at=body.paid_at)}


@router.get("/workshops/{workshop_id}/debt-ledger")
def workshop_debt(workshop_id: uuid.UUID, db: Session = Depends(get_db), _=Depends(current_user)):
    if not db.get(Workshop, workshop_id): raise ApiError(404, "WORKSHOP_NOT_FOUND", "Không tìm thấy nhà may.")
    return {"data": svc.debt_statement(db, "WORKSHOP", workshop_id)}


@router.get("/workshops/{workshop_id}/settled-batches")
def workshop_settled_batches(workshop_id: uuid.UUID, q: str | None = None,
                             db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.settled_batches(db, workshop_id, q)}


class SupplementalIn(BaseModel):
    batch_id: uuid.UUID
    delivery_date: date
    quantity: float = Field(gt=0)
    unit_price_amount: int = Field(gt=0)
    notes: str | None = None
    expected_batch_version: int = Field(ge=1)


@router.post("/supplemental-workshop-deliveries", status_code=201, dependencies=[Depends(require_permission("production.manage"))])
def supplemental(body: SupplementalIn, idempotency_key: str = Header(..., alias="Idempotency-Key"),
                 db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.create_supplemental(db, **body.model_dump(), idempotency_key=idempotency_key, user=user)}


@router.post("/supplemental-workshop-settlements", status_code=201, dependencies=[Depends(require_permission("production.settle"))])
def supplemental_settlement(body: SettlementIn, idempotency_key: str = Header(..., alias="Idempotency-Key"),
                            db: Session = Depends(get_db), user: User = Depends(current_user)):
    if body.batch_ids: raise ApiError(422, "SUPPLEMENTAL_ONLY", "Bảng kê bổ sung chỉ nhận phiếu hàng vét.")
    return {"data": svc.create_settlement(db, **body.model_dump(), idempotency_key=idempotency_key, user=user)}


class CuttingTeamIn(BaseModel):
    team_code: str
    name: str
    phone: str | None = None
    default_unit_price_amount: int = Field(0, ge=0)
    notes: str | None = None


@router.get("/cutting-teams")
def cutting_teams(q: str | None = None, db: Session = Depends(get_db), _=Depends(current_user)):
    rows = list(db.scalars(select(CuttingTeam).order_by(CuttingTeam.name)))
    needle = (q or "").casefold()
    if needle: rows = [row for row in rows if needle in row.name.casefold() or needle in row.team_code.casefold()]
    return {"data": [svc.cutting_team_dict(row) for row in rows]}


@router.post("/cutting-teams", status_code=201, dependencies=[Depends(require_permission("production.manage"))])
def create_cutting_team(body: CuttingTeamIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.create_cutting_team(db, **body.model_dump(), user=user)}


class FabricTypeIn(BaseModel):
    code: str | None = Field(None, max_length=80)
    name: str = Field(min_length=1, max_length=200)
    notes: str | None = None


@router.get("/fabric-types")
def fabric_types(q: str | None = None, db: Session = Depends(get_db), _=Depends(current_user)):
    rows = list(db.scalars(select(FabricType).where(FabricType.status == "ACTIVE").order_by(FabricType.name)))
    needle = (q or "").casefold()
    if needle: rows = [row for row in rows if needle in row.name.casefold() or needle in row.code.casefold()]
    return {"data": [{"id": str(row.id), "code": row.code, "name": row.name} for row in rows]}


@router.post("/fabric-types", status_code=201, dependencies=[Depends(require_permission("production.manage"))])
def create_fabric_type(body: FabricTypeIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.create_fabric_type(db, code=body.code or "", name=body.name, notes=body.notes, user=user)}


class PatternIn(BaseModel):
    pattern_code: str | None = Field(None, max_length=100)
    name: str = Field(min_length=1, max_length=300)
    brand: str | None = Field(None, max_length=100)
    category: str | None = Field(None, max_length=100)
    notes: str | None = None


@router.get("/patterns")
def patterns(q: str | None = None, db: Session = Depends(get_db), _=Depends(current_user)):
    rows = list(db.scalars(select(Product).where(Product.status == "ACTIVE").order_by(Product.pattern_code)))
    needle = (q or "").casefold()
    if needle:
        rows = [row for row in rows if needle in (row.pattern_code or "").casefold() or needle in row.name.casefold()]
    return {"data": [{"id": str(row.id), "product_code": row.product_code, "pattern_code": row.pattern_code,
                      "brand": row.brand, "name": row.name, "category": row.category} for row in rows]}


@router.post("/patterns", status_code=201, dependencies=[Depends(require_permission("production.manage"))])
def create_pattern(body: PatternIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    name = body.name.strip()
    if not name:
        raise ApiError(422, "PATTERN_NAME_REQUIRED", "Tên mã rập là bắt buộc.")
    pattern_code = (body.pattern_code or "").strip().upper() or svc.slug(name)
    if db.scalar(select(Product.id).where(Product.product_code == pattern_code)):
        raise ApiError(409, "PATTERN_EXISTS", "Mã rập đã tồn tại.")
    row = Product(product_code=pattern_code, pattern_code=pattern_code, brand=(body.brand or "").strip() or None,
                  name=name, category=(body.category or "").strip() or None,
                  notes=(body.notes or "").strip() or None)
    db.add(row); db.flush()
    svc.add_audit(db, user, "PRODUCTION", "CREATE", "PATTERN", row.id, after={"pattern_code": pattern_code, "name": name})
    db.commit()
    return {"data": {"id": str(row.id), "product_code": row.product_code, "pattern_code": row.pattern_code,
                     "brand": row.brand, "name": row.name, "category": row.category}}


class CuttingReportIn(BaseModel):
    batch_id: uuid.UUID
    report_date: date
    quantity: float = Field(gt=0)
    unit_price_amount: int = Field(gt=0)
    color: str | None = None
    layers: float = Field(ge=0)
    notes: str | None = None


@router.post("/cutting-reports", status_code=201, dependencies=[Depends(require_permission("production.manage"))])
def cutting_report(body: CuttingReportIn, idempotency_key: str = Header(..., alias="Idempotency-Key"),
                   db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.create_cutting_report(db, **body.model_dump(), idempotency_key=idempotency_key, user=user)}


@router.get("/cutting/monthly-report")
def cutting_monthly_report(month: str, db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.cutting_monthly_report(db, month)}


@router.get("/cutting/debt-summary")
def cutting_debt_summary(db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.cutting_debt_summary(db)}


@router.post("/cutting/monthly-settlements", status_code=201, dependencies=[Depends(require_permission("production.settle"))])
def cutting_monthly_settlement(month: str = Body(..., embed=True), db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": svc.cutting_monthly_settlement(db, month=month, user=user)}


@router.post("/cutting-payments", status_code=201, dependencies=[Depends(require_permission("production.settle"))])
def cutting_payment(body: PartyPaymentIn, idempotency_key: str = Header(..., alias="Idempotency-Key"),
                    db: Session = Depends(get_db), user: User = Depends(current_user)):
    if not body.cutting_team_id: raise ApiError(422, "CUTTING_TEAM_REQUIRED", "Thiếu thợ cắt.")
    return {"data": svc.create_party_payment(db, party_type="CUTTING_TEAM", party_id=body.cutting_team_id,
        amount=body.amount, method=body.method, allocations=[row.model_dump() for row in body.allocations],
        note=body.note, idempotency_key=idempotency_key, user=user, paid_at=body.paid_at)}


@router.get("/cutting/monthly-reports")
def cutting_monthly_reports(month: str | None = None, db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.cutting_reports(db, month)}


@router.get("/cutting/monthly-payments")
def cutting_monthly_payments(month: str | None = None, db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.cutting_payment_history(db, month)}


@router.get("/cutting/monthly-debt")
def cutting_monthly_debt(db: Session = Depends(get_db), _=Depends(current_user)):
    return {"data": svc.cutting_monthly_debt(db)}


class PatternNoteIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    content: str = Field(default="", max_length=10000)
    media_ids: list[uuid.UUID] = Field(default_factory=list, max_length=20)
    client_token: str = Field(min_length=8, max_length=100)


@router.get("/pattern-notes")
def pattern_notes(q: str | None = None, db: Session = Depends(get_db), _=Depends(require_owner)):
    return {"data": svc.list_pattern_notes(db, q)}


@router.get("/pattern-notes/{note_id}")
def pattern_note_detail(note_id: uuid.UUID, db: Session = Depends(get_db), _=Depends(require_owner)):
    return {"data": svc.pattern_note_detail(db, note_id)}


@router.post("/pattern-notes", status_code=201)
def pattern_note(body: PatternNoteIn, db: Session = Depends(get_db), user: User = Depends(require_owner)):
    return {"data": svc.create_pattern_note(db, **body.model_dump(), user=user)}
