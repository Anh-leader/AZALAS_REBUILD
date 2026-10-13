from __future__ import annotations

import re
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core.errors import ApiError
from ..models import (
    AuditLog, BatchMaterialDelivery, BatchMaterialDeliveryLine, Color, Customer,
    CuttingReport, CuttingTeam, DebtLedgerEntry, FabricType, InventoryTransaction,
    MediaObject, Order, OrderStatusEvent, PartyDebtBalance, PatternNote, Payment, PaymentAllocation,
    Product, ProductionBatch, ProductionBatchMedia, ProductionBatchSizePlan, ProductionReceipt,
    ProductionReceiptLine, SupplementalWorkshopDelivery, User, Warehouse, Workshop,
    WorkshopSettlement, WorkshopSettlementLine,
)
from .inventory import post_inventory_receipt
from .storage import media_view_url

DEFAULT_MATERIALS = ["Dây kéo", "Dây luồn", "Thun", "Sợi bún", "Nút chân", "Thêu", "Đục lỗ", "In", "Phụ liệu khác"]


def now() -> datetime:
    return datetime.now(timezone.utc)


def number(prefix: str) -> str:
    return f"{prefix}-{now():%Y%m%d%H%M%S}-{uuid.uuid4().hex[:6].upper()}"


def decimal(value, *, positive=False) -> Decimal:
    # Cho phép người dùng nhập dấu phẩy thập phân kiểu Việt: "23,3" -> "23.3".
    text = str(value).replace(",", ".")
    try:
        result = Decimal(text)
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise ApiError(422, "INVALID_NUMBER", "Giá trị số không hợp lệ.") from exc
    if not result.is_finite() or result.as_tuple().exponent < -3 or (positive and result <= 0):
        raise ApiError(422, "INVALID_NUMBER", "Giá trị phải dương và tối đa 3 chữ số thập phân.")
    return result


def serial(value: Decimal | int | float | str) -> int | float:
    number_value = Decimal(str(value))
    return int(number_value) if number_value == number_value.to_integral_value() else float(number_value)


def parse_quantity_expression(expression: str) -> Decimal:
    raw = re.sub(r"\s+", "", str(expression or ""))
    if not raw:
        raise ApiError(422, "QUANTITY_EXPRESSION_REQUIRED", "Thiếu biểu thức số lớp/số lượng.")
    multiplication = re.fullmatch(r"(\d+(?:\.\d+)?)\s*[xX×*]\s*(\d+(?:\.\d+)?)(?:=(\d+(?:\.\d+)?))?", raw)
    if multiplication:
        result = decimal(multiplication.group(1), positive=True) * decimal(multiplication.group(2), positive=True)
        stated = multiplication.group(3)
        if stated is not None and result != decimal(stated, positive=True):
            raise ApiError(422, "QUANTITY_EXPRESSION_MISMATCH", "Kết quả sau dấu = không khớp phép nhân.")
        return result
    if "+" in raw:
        parts = raw.split("+")
        if any(not re.fullmatch(r"\d+(?:\.\d+)?", part) for part in parts):
            raise ApiError(422, "INVALID_QUANTITY_EXPRESSION", "Biểu thức cộng không hợp lệ.")
        return sum((decimal(part, positive=True) for part in parts), Decimal(0))
    if re.fullmatch(r"\d+(?:\.\d+)?", raw):
        return decimal(raw, positive=True)
    bare_total = re.fullmatch(r"x=(\d+(?:\.\d+)?)", raw)
    if bare_total:
        return decimal(bare_total.group(1), positive=True)
    raise ApiError(422, "INVALID_QUANTITY_EXPRESSION", "Hỗ trợ số đơn, phép cộng, dạng 20x5=100 hoặc x=700.")


def add_audit(db: Session, user: User, module: str, action: str, entity_type: str,
              entity_id: uuid.UUID, request_id: str | None = None, before=None, after=None):
    db.add(AuditLog(module=module, action=action, entity_type=entity_type, entity_id=entity_id,
                    actor_user_id=user.id, request_id=request_id, before_data=before,
                    after_data=after, occurred_at=now()))


def party_debt(db: Session, party_type: str, party_id: uuid.UUID) -> int:
    return int(db.scalar(select(func.coalesce(func.sum(DebtLedgerEntry.amount_delta), 0)).where(
        DebtLedgerEntry.party_type == party_type, DebtLedgerEntry.party_id == party_id
    )) or 0)


def refresh_party(db: Session, party_type: str, party_id: uuid.UUID):
    entries = list(db.scalars(select(DebtLedgerEntry).where(
        DebtLedgerEntry.party_type == party_type, DebtLedgerEntry.party_id == party_id
    )))
    projection = db.scalar(select(PartyDebtBalance).where(
        PartyDebtBalance.party_type == party_type, PartyDebtBalance.party_id == party_id
    ).with_for_update(of=PartyDebtBalance))
    if not projection:
        projection = PartyDebtBalance(party_type=party_type, party_id=party_id)
        db.add(projection)
    else:
        projection.version += 1
    projection.opening = sum(row.amount_delta for row in entries if row.entry_type == "OPENING")
    projection.debit = sum(row.amount_delta for row in entries if row.amount_delta > 0 and row.entry_type != "OPENING")
    projection.credit = -sum(row.amount_delta for row in entries if row.amount_delta < 0)
    projection.current = sum(row.amount_delta for row in entries)
    projection.calculated_at = now()


def master_data(db: Session) -> dict:
    return {
        "workshops": [workshop_dict(row, db) for row in db.scalars(select(Workshop).where(Workshop.status == "ACTIVE").order_by(Workshop.name))],
        "cutting_teams": [cutting_team_dict(row) for row in db.scalars(select(CuttingTeam).where(CuttingTeam.status == "ACTIVE").order_by(CuttingTeam.name))],
        "patterns": [{"product_id": str(row.id), "pattern_code": row.pattern_code, "name": row.name}
                     for row in db.scalars(select(Product).where(Product.status == "ACTIVE").order_by(Product.pattern_code))],
        "colors": [{"id": str(row.id), "name": row.canonical_name} for row in db.scalars(select(Color).where(Color.status == "ACTIVE").order_by(Color.canonical_name))],
        "fabrics": [{"id": str(row.id), "code": row.code, "name": row.name} for row in db.scalars(select(FabricType).where(FabricType.status == "ACTIVE").order_by(FabricType.name))],
        "warehouses": [{"id": str(row.id), "code": row.code, "name": row.name} for row in db.scalars(select(Warehouse).where(Warehouse.active).order_by(Warehouse.sort_order))],
        "material_catalog": DEFAULT_MATERIALS,
    }


def workshop_dict(row: Workshop, db: Session) -> dict:
    return {"id": str(row.id), "workshop_code": row.workshop_code, "name": row.name,
            "phone": row.phone, "address": row.address, "status": row.status,
            "notes": row.notes, "debt_amount": party_debt(db, "WORKSHOP", row.id)}


def cutting_team_dict(row: CuttingTeam) -> dict:
    return {"id": str(row.id), "team_code": row.team_code, "name": row.name,
            "phone": row.phone, "status": row.status,
            "default_unit_price_amount": row.default_unit_price_amount, "notes": row.notes}


def create_workshop(db: Session, *, workshop_code: str, name: str, phone: str | None,
                    address: str | None, notes: str | None, user: User) -> dict:
    code, clean_name = workshop_code.strip(), name.strip()
    if not code or not clean_name:
        raise ApiError(422, "WORKSHOP_FIELDS_REQUIRED", "Mã và tên nhà may là bắt buộc.")
    if db.scalar(select(Workshop.id).where((Workshop.workshop_code == code) | (func.lower(Workshop.name) == clean_name.lower()))):
        raise ApiError(409, "WORKSHOP_EXISTS", "Mã hoặc tên nhà may đã tồn tại.")
    row = Workshop(workshop_code=code, name=clean_name, phone=(phone or "").strip() or None,
                   address=(address or "").strip() or None, notes=(notes or "").strip() or None)
    db.add(row); db.flush(); add_audit(db, user, "PRODUCTION", "CREATE", "WORKSHOP", row.id, after={"code": code, "name": clean_name}); db.commit()
    return workshop_dict(row, db)


def create_cutting_team(db: Session, *, team_code: str, name: str, phone: str | None,
                        default_unit_price_amount: int, notes: str | None, user: User) -> dict:
    if default_unit_price_amount < 0:
        raise ApiError(422, "INVALID_PRICE", "Đơn giá mặc định không được âm.")
    row = CuttingTeam(team_code=team_code.strip(), name=name.strip(), phone=(phone or "").strip() or None,
                      default_unit_price_amount=default_unit_price_amount, notes=(notes or "").strip() or None)
    db.add(row); db.flush(); add_audit(db, user, "PRODUCTION", "CREATE", "CUTTING_TEAM", row.id, after={"name": row.name}); db.commit()
    return cutting_team_dict(row)


def create_fabric_type(db: Session, *, code: str, name: str, notes: str | None, user: User) -> dict:
    clean_code, clean_name = (code or "").strip(), (name or "").strip()
    if not clean_name:
        raise ApiError(422, "FABRIC_NAME_REQUIRED", "Tên loại vải là bắt buộc.")
    clean_code = clean_code or slug(clean_name)
    if db.scalar(select(FabricType.id).where((FabricType.code == clean_code) | (func.lower(FabricType.name) == clean_name.lower()))):
        raise ApiError(409, "FABRIC_EXISTS", "Mã hoặc tên loại vải đã tồn tại.")
    row = FabricType(code=clean_code, name=clean_name, notes=(notes or "").strip() or None)
    db.add(row); db.flush(); add_audit(db, user, "PRODUCTION", "CREATE", "FABRIC_TYPE", row.id, after={"code": clean_code, "name": clean_name}); db.commit()
    return {"id": str(row.id), "code": row.code, "name": row.name}


def slug(value: str) -> str:
    import re as _re
    text = value.strip().upper()
    text = "".join(ch for ch in text if ch.isalnum() or ch in " -")
    text = _re.sub(r"[^A-Z0-9]+", "-", text).strip("-")
    return text or f"VT-{uuid.uuid4().hex[:6].upper()}"


def get_or_create_color(db: Session, name: str) -> Color:
    """Resolve a free-text màu to a ``Color`` row, creating it when missing."""
    clean = (name or "").strip()
    if not clean:
        raise ApiError(422, "COLOR_REQUIRED", "Màu không được để trống.")
    existing = db.scalar(select(Color).where(func.lower(Color.canonical_name) == clean.lower()))
    if existing:
        return existing
    code = slug(clean)
    if db.scalar(select(Color.id).where(Color.color_code == code)):
        code = f"{code}-{uuid.uuid4().hex[:4].upper()}"
    row = Color(color_code=code, canonical_name=clean, status="ACTIVE")
    db.add(row); db.flush()
    return row


def _media_dict(media: MediaObject) -> dict:
    return {"id": str(media.id), "url": media_view_url(media.id), "view_url": media_view_url(media.id),
            "original_name": media.original_name, "content_type": media.content_type}


def batch_images(db: Session, batch_id: uuid.UUID) -> list[dict]:
    rows = list(db.scalars(select(MediaObject).join(ProductionBatchMedia, ProductionBatchMedia.media_id == MediaObject.id)
                            .where(ProductionBatchMedia.batch_id == batch_id).order_by(MediaObject.created_at)))
    return [_media_dict(row) for row in rows if row.status == "READY"]


def batch_dict(batch: ProductionBatch, db: Session, *, full=False) -> dict:
    workshop = db.get(Workshop, batch.workshop_id); team = db.get(CuttingTeam, batch.cutting_team_id)
    customer = db.get(Customer, batch.customer_id) if batch.customer_id else None
    order = db.get(Order, batch.synced_order_id) if batch.synced_order_id else None
    result = {
        "id": str(batch.id), "batch_no": batch.batch_no, "cut_date": batch.cut_date.isoformat(),
        "workshop": {"id": str(workshop.id), "name": workshop.name} if workshop else None,
        "cutting_team": {"id": str(team.id), "name": team.name} if team else None,
        "pattern_code": batch.pattern_code, "product_id": str(batch.product_id) if batch.product_id else None,
        "product_name": batch.product_name_snapshot, "size_expression": batch.size_expression,
        "ratio_expression": batch.ratio_expression, "layer_expression": batch.layer_expression,
        "planned_quantity": serial(batch.planned_quantity), "delivered_quantity": serial(batch.delivered_quantity),
        "remaining_quantity": serial(batch.remaining_quantity), "imported_quantity": serial(batch.imported_quantity),
        "expected_delivery_date": batch.expected_delivery_date.isoformat() if batch.expected_delivery_date else None,
        "batch_type": batch.batch_type, "customer_id": str(batch.customer_id) if batch.customer_id else None,
        "customer_name": customer.name if customer else None,
        "customer_code": customer.customer_code if customer else None,
        "synced_order_id": str(batch.synced_order_id) if batch.synced_order_id else None,
        "synced_order_no": order.order_no if order else None,
        "workshop_unit_price_amount": batch.workshop_unit_price_amount, "workshop_amount": batch.workshop_amount,
        "production_status": batch.production_status, "receipt_status": batch.receipt_status,
        "settlement_status": batch.settlement_status,
        "workshop_settlement_id": str(batch.workshop_settlement_id) if batch.workshop_settlement_id else None,
        "planned_warehouse_id": str(batch.planned_warehouse_id), "fabric_type_id": str(batch.fabric_type_id) if batch.fabric_type_id else None,
        "notes": batch.notes, "version": batch.version, "created_at": batch.created_at.isoformat() if batch.created_at else None,
    }
    if full:
        plans = list(db.scalars(select(ProductionBatchSizePlan).where(ProductionBatchSizePlan.batch_id == batch.id).order_by(ProductionBatchSizePlan.size)))
        result["size_plans"] = [{"id": str(row.id), "color_id": str(row.color_id) if row.color_id else None,
                                 "color_name": db.get(Color, row.color_id).canonical_name if row.color_id else None,
                                 "variant_code": row.variant_code,
                                 "size": row.size, "layers": serial(row.layers), "ratio": serial(row.ratio),
                                 "planned_quantity": serial(row.planned_quantity),
                                 "product_variant_id": str(row.product_variant_id) if row.product_variant_id else None,
                                 "planned_warehouse_id": str(row.planned_warehouse_id), "notes": row.notes} for row in plans]
        result["receipts"] = list_receipts(db, batch.id)
        result["material_deliveries"] = material_delivery_history(db, batch.id)
        result["images"] = batch_images(db, batch.id)
    return result


def create_batch(db: Session, *, data: dict, user: User, idempotency_key: str) -> dict:
    if not idempotency_key:
        raise ApiError(422, "IDEMPOTENCY_KEY_REQUIRED", "Thiếu Idempotency-Key.")
    existing_batch = db.scalar(select(ProductionBatch).where(ProductionBatch.idempotency_key == idempotency_key))
    if existing_batch:
        return batch_dict(existing_batch, db, full=True)
    mode = str(data.get("mode") or "").upper()
    if mode not in ("CUSTOMER_ORDER", "HOUSE"):
        raise ApiError(422, "INVALID_BATCH_MODE", "Chế độ mâm phải là CUSTOMER_ORDER hoặc HOUSE.")
    workshop = db.get(Workshop, data.get("workshop_id")); team = db.get(CuttingTeam, data.get("cutting_team_id"))
    warehouse = db.get(Warehouse, data.get("planned_warehouse_id"))
    if not workshop or not team or not warehouse:
        raise ApiError(422, "PRODUCTION_MASTER_INVALID", "Nhà may, thợ cắt hoặc kho không hợp lệ.")
    pattern_code = str(data.get("pattern_code") or "").strip(); product_name = str(data.get("product_name") or "").strip()
    if not pattern_code or not product_name:
        raise ApiError(422, "BATCH_FIELDS_REQUIRED", "Mã rập và tên sản phẩm là bắt buộc.")
    unit_price = int(data.get("workshop_unit_price_amount") or 0)
    if unit_price <= 0:
        raise ApiError(422, "UNIT_PRICE_REQUIRED", "Bắt buộc nhập đơn giá nhà may (đ/chiếc).")
    planned = parse_quantity_expression(data.get("layer_expression"))
    customer = db.get(Customer, data.get("customer_id")) if data.get("customer_id") else None
    delivery_date = data.get("expected_delivery_date")
    if mode == "CUSTOMER_ORDER" and (not customer or not delivery_date):
        raise ApiError(422, "CUSTOMER_BATCH_FIELDS_REQUIRED", "Mâm khách đặt cần khách hàng và ngày giao.")
    media_ids = data.get("media_ids") or []
    if not media_ids:
        raise ApiError(422, "BATCH_MEDIA_REQUIRED", "Chưa có ảnh rập/sản phẩm. Vui lòng tải lên hoặc paste ảnh.")
    media_rows = list(db.scalars(select(MediaObject).where(MediaObject.id.in_(media_ids))))
    if len(media_rows) != len(set(media_ids)):
        raise ApiError(422, "MEDIA_INVALID", "Có ảnh không tồn tại trong kho lưu trữ.")
    workshop_amount = int((planned * Decimal(unit_price)).to_integral_value())
    batch = ProductionBatch(
        idempotency_key=idempotency_key, batch_no=number("MAM"), cut_date=data["cut_date"], workshop_id=workshop.id,
        cutting_team_id=team.id, pattern_code=pattern_code, product_id=data.get("product_id"),
        product_name_snapshot=product_name, size_expression=(data.get("size_expression") or "").strip() or None,
        ratio_expression=(data.get("ratio_expression") or "").strip() or None,
        layer_expression=str(data.get("layer_expression")).strip(), planned_quantity=planned,
        delivered_quantity=0, remaining_quantity=planned, expected_delivery_date=delivery_date,
        batch_type=mode, customer_id=customer.id if customer else None,
        workshop_unit_price_amount=unit_price, workshop_amount=workshop_amount,
        production_status="CUTTING_INCOMPLETE", receipt_status="NOT_RECEIVED", settlement_status="UNPAID",
        planned_warehouse_id=warehouse.id, fabric_type_id=data.get("fabric_type_id"),
        notes=(data.get("notes") or "").strip() or None, created_by=user.id, updated_by=user.id,
    )
    db.add(batch); db.flush()
    for media in media_rows:
        db.add(ProductionBatchMedia(batch_id=batch.id, media_id=media.id))
    for raw in data.get("size_plans") or []:
        color_id = raw.get("color_id")
        if not color_id and raw.get("color"):
            color_id = get_or_create_color(db, raw["color"]).id
        qty = decimal(raw.get("planned_quantity", 0))
        db.add(ProductionBatchSizePlan(
            batch_id=batch.id, color_id=color_id, variant_code=(raw.get("variant_code") or "").strip() or None,
            size=str(raw.get("size") or "").strip(),
            layers=decimal(raw.get("layers", 0)), ratio=decimal(raw.get("ratio", 0)), planned_quantity=qty,
            product_variant_id=raw.get("product_variant_id"),
            planned_warehouse_id=raw.get("planned_warehouse_id") or warehouse.id,
            notes=(raw.get("notes") or "").strip() or None,
        ))
    if mode == "CUSTOMER_ORDER":
        order = Order(order_no=f"RAP-{batch.batch_no}"[:40], customer_id=customer.id,
                      warehouse_id=warehouse.id, order_type="CUSTOMER_ORDER", created_date=batch.cut_date,
                      delivery_date=delivery_date, customer_note=f"Mâm {batch.batch_no} · {product_name}",
                      status="NEW", source_channel="RAP", created_by=user.id,
                      idempotency_key=idempotency_key, production_batch_id=batch.id)
        db.add(order); db.flush(); batch.synced_order_id = order.id
        db.add(OrderStatusEvent(order_id=order.id, to_status="NEW", actor_user_id=user.id,
                                reason=f"Tạo từ QL Rập {batch.batch_no}"))
    add_audit(db, user, "PRODUCTION", "CREATE", "PRODUCTION_BATCH", batch.id,
              idempotency_key, after={"batch_no": batch.batch_no, "planned_quantity": serial(planned), "mode": mode})
    db.commit()
    return batch_dict(batch, db, full=True)


def batch_thumbnails(db: Session, batch_ids: list[uuid.UUID]) -> dict[str, str]:
    """Bulk first ready image URL per batch, tránh N+1 khi render danh sách tiến độ."""
    if not batch_ids:
        return {}
    rows = db.execute(
        select(ProductionBatchMedia.batch_id, MediaObject.id)
        .join(MediaObject, MediaObject.id == ProductionBatchMedia.media_id)
        .where(ProductionBatchMedia.batch_id.in_(batch_ids), MediaObject.status == "READY")
        .order_by(ProductionBatchMedia.batch_id, MediaObject.created_at)
    ).all()
    result: dict[str, str] = {}
    for batch_id, media_id in rows:
        result.setdefault(str(batch_id), media_view_url(media_id))
    return result


def batch_images_map(db: Session, batch_ids: list[uuid.UUID]) -> dict[str, list[dict]]:
    """Bulk tất cả ảnh READY theo batch (tránh N+1 cho card Khách đặt nhiều ảnh)."""
    result: dict[str, list[dict]] = {}
    if not batch_ids:
        return result
    rows = db.execute(
        select(ProductionBatchMedia.batch_id, MediaObject)
        .join(MediaObject, MediaObject.id == ProductionBatchMedia.media_id)
        .where(ProductionBatchMedia.batch_id.in_(batch_ids), MediaObject.status == "READY")
        .order_by(ProductionBatchMedia.batch_id, MediaObject.created_at)
    ).all()
    for batch_id, media in rows:
        result.setdefault(str(batch_id), []).append(_media_dict(media))
    return result


def _paid_settlement_ids(db: Session) -> set[uuid.UUID]:
    return set(db.scalars(select(WorkshopSettlement.id).where(WorkshopSettlement.status == "PAID")))


def list_batches(db: Session, *, q: str | None = None, workshop_id: uuid.UUID | None = None,
                 production_status: str | None = None, receipt_status: str | None = None,
                 settlement_status: str | None = None, batch_type: str | None = None,
                 payment_status: str | None = None) -> list[dict]:
    stmt = select(ProductionBatch).where(ProductionBatch.production_status != "CANCELLED").order_by(ProductionBatch.created_at.desc())
    for field, value in ((ProductionBatch.workshop_id, workshop_id), (ProductionBatch.production_status, production_status),
                         (ProductionBatch.receipt_status, receipt_status), (ProductionBatch.settlement_status, settlement_status),
                         (ProductionBatch.batch_type, batch_type)):
        if value:
            stmt = stmt.where(field == value)
    rows = list(db.scalars(stmt))
    needle = (q or "").strip().casefold()
    if needle:
        workshop_names = {str(row.id): row.name for row in db.scalars(select(Workshop))}
        team_names = {str(row.id): row.name for row in db.scalars(select(CuttingTeam))}
        customer_names = {str(row.id): row.name for row in db.scalars(select(Customer))}
        order_nos = {row.id: row.order_no for row in db.scalars(select(Order))}

        def matches(row: ProductionBatch) -> bool:
            return (needle in row.batch_no.casefold()
                    or needle in row.pattern_code.casefold()
                    or needle in row.product_name_snapshot.casefold()
                    or needle in workshop_names.get(str(row.workshop_id), "").casefold()
                    or needle in team_names.get(str(row.cutting_team_id), "").casefold()
                    or needle in customer_names.get(str(row.customer_id), "").casefold()
                    or needle in (order_nos.get(row.synced_order_id, "") or "").casefold()
                    or needle in (row.layer_expression or "").casefold())
        rows = [row for row in rows if matches(row)]
    if payment_status in ("paid", "unpaid"):
        paid_ids = _paid_settlement_ids(db)
        rows = [row for row in rows if (row.workshop_settlement_id in paid_ids) == (payment_status == "paid")]
    paid_ids = _paid_settlement_ids(db)
    thumbs = batch_thumbnails(db, [row.id for row in rows])
    images_map = batch_images_map(db, [row.id for row in rows])
    result = []
    for row in rows:
        item = batch_dict(row, db)
        item["thumbnail"] = thumbs.get(str(row.id))
        item["images"] = images_map.get(str(row.id), [])
        item["payment_status"] = "paid" if row.workshop_settlement_id in paid_ids else "unpaid"
        result.append(item)
    return result


def batch_summary(db: Session) -> list[dict]:
    """Dashboard Tiến độ đơn: tổng còn phải giao (chưa thanh toán) theo từng nhà may, tách Hàng nhà / Khách đặt."""
    paid_ids = _paid_settlement_ids(db)
    workshop_names = {row.id: row.name for row in db.scalars(select(Workshop))}
    stats: dict[uuid.UUID, dict] = {}
    for row in db.scalars(select(ProductionBatch).where(ProductionBatch.production_status != "CANCELLED")):
        if row.workshop_settlement_id in paid_ids:
            continue
        remaining = max(row.remaining_quantity, Decimal(0))
        if remaining <= 0:
            continue
        entry = stats.setdefault(row.workshop_id, {"total": Decimal(0), "house": Decimal(0), "customer": Decimal(0)})
        entry["total"] += remaining
        if row.batch_type == "CUSTOMER_ORDER":
            entry["customer"] += remaining
        else:
            entry["house"] += remaining
    result = [{"workshop_id": str(wid), "workshop_name": workshop_names.get(wid, ""),
               "total": serial(values["total"]), "house": serial(values["house"]),
               "customer": serial(values["customer"])} for wid, values in stats.items()]
    known = {row["workshop_id"] for row in result}
    for workshop in db.scalars(select(Workshop).where(Workshop.status == "ACTIVE")):
        if str(workshop.id) not in known:
            result.append({"workshop_id": str(workshop.id), "workshop_name": workshop.name,
                           "total": 0, "house": 0, "customer": 0})
    result.sort(key=lambda row: row["workshop_name"].casefold())
    return result


def _batch_has_business(db: Session, batch: ProductionBatch) -> bool:
    """Đã phát sinh nghiệp vụ (nhận hàng / phụ liệu / chốt / thanh toán) hay chưa."""
    if batch.delivered_quantity > 0 or batch.workshop_settlement_id:
        return True
    if db.scalar(select(ProductionReceipt.id).where(ProductionReceipt.batch_id == batch.id).limit(1)):
        return True
    if db.scalar(select(BatchMaterialDelivery.id).where(BatchMaterialDelivery.batch_id == batch.id).limit(1)):
        return True
    if batch.synced_order_id:
        order = db.get(Order, batch.synced_order_id)
        if order and (order.billing_status != "DRAFT" or order.paid_amount > 0 or order.total_amount > 0):
            return True
    return False


def _customer_order_batch(db: Session, batch_id: uuid.UUID) -> ProductionBatch:
    batch = db.scalar(select(ProductionBatch).where(ProductionBatch.id == batch_id).with_for_update(of=ProductionBatch))
    if not batch:
        raise ApiError(404, "BATCH_NOT_FOUND", "Không tìm thấy mâm.")
    if batch.batch_type != "CUSTOMER_ORDER":
        raise ApiError(422, "NOT_CUSTOMER_ORDER", "Chỉ áp dụng cho mâm khách đặt.")
    if not batch.customer_id:
        raise ApiError(422, "CUSTOMER_REQUIRED", "Mâm khách đặt chưa có khách hàng.")
    return batch


def start_customer_order_picking(db: Session, batch_id: uuid.UUID, *, user: User) -> dict:
    """Chuyển mâm khách đặt sang luồng soạn hàng; dùng/tạo order liên kết."""
    batch = _customer_order_batch(db, batch_id)
    order = db.scalar(select(Order).where(Order.id == batch.synced_order_id).with_for_update(of=Order)) if batch.synced_order_id else None
    if not order:
        warehouse = db.get(Warehouse, batch.planned_warehouse_id)
        order = Order(order_no=f"RAP-{batch.batch_no}"[:40], customer_id=batch.customer_id,
                      warehouse_id=warehouse.id, order_type="CUSTOMER_ORDER", created_date=batch.cut_date,
                      delivery_date=batch.expected_delivery_date, customer_note=f"Mâm {batch.batch_no} · {batch.product_name_snapshot}",
                      status="NEW", source_channel="RAP", created_by=user.id,
                      idempotency_key=f"rap:{batch.batch_no}", production_batch_id=batch.id)
        db.add(order); db.flush(); batch.synced_order_id = order.id
        db.add(OrderStatusEvent(order_id=order.id, to_status="NEW", actor_user_id=user.id,
                                reason=f"Tạo từ QL Rập {batch.batch_no}"))
    old_status = order.status
    if order.status in ("NEW", "PICKING", "DEBT_ORDER"):
        order.status = "PICKING"
        order.claimed_by = order.claimed_by or user.id
        order.claimed_at = order.claimed_at or now()
        order.version += 1
        db.add(OrderStatusEvent(order_id=order.id, from_status=old_status, to_status="PICKING",
                                actor_user_id=user.id, reason="Bắt đầu soạn hàng từ QL Rập"))
    batch.version += 1; batch.updated_by = user.id
    add_audit(db, user, "PRODUCTION", "START_PICKING", "PRODUCTION_BATCH", batch.id,
              after={"order_id": str(order.id), "order_no": order.order_no})
    db.commit()
    return {"order_id": str(order.id), "order_no": order.order_no, "status": order.status}


def mark_customer_order_debt(db: Session, batch_id: uuid.UUID, *, user: User) -> dict:
    """Đánh dấu đơn khách đặt là Nợ đơn."""
    batch = _customer_order_batch(db, batch_id)
    order = db.scalar(select(Order).where(Order.id == batch.synced_order_id).with_for_update(of=Order)) if batch.synced_order_id else None
    if order:
        old_status = order.status
        order.status = "DEBT_ORDER"
        order.version += 1
        db.add(OrderStatusEvent(order_id=order.id, from_status=old_status, to_status="DEBT_ORDER",
                                actor_user_id=user.id, reason="Đánh dấu nợ đơn từ QL Rập"))
    batch.version += 1; batch.updated_by = user.id
    add_audit(db, user, "PRODUCTION", "MARK_DEBT", "PRODUCTION_BATCH", batch.id,
              after={"order_id": str(order.id) if order else None})
    db.commit()
    return batch_dict(batch, db, full=True)


def delete_customer_order(db: Session, batch_id: uuid.UUID, *, user: User) -> dict:
    """Soft delete mâm khách đặt; nếu đã phát sinh nghiệp vụ thì chuyển trạng thái hủy thay vì xóa."""
    batch = _customer_order_batch(db, batch_id)
    had_business = _batch_has_business(db, batch)
    if had_business:
        order_status = "CANCELLED"
        action = "CANCEL"
    else:
        order_status = "DELETED"
        action = "DELETE"
    order = db.scalar(select(Order).where(Order.id == batch.synced_order_id).with_for_update(of=Order)) if batch.synced_order_id else None
    if order:
        old_status = order.status
        order.status = order_status
        if order_status == "CANCELLED":
            order.cancelled_at = now(); order.cancelled_by = user.id
        order.version += 1
        db.add(OrderStatusEvent(order_id=order.id, from_status=old_status, to_status=order_status,
                                actor_user_id=user.id, reason=f"{'Hủy' if had_business else 'Xóa'} đơn khách đặt từ QL Rập"))
    batch.production_status = "CANCELLED"
    batch.version += 1; batch.updated_by = user.id
    add_audit(db, user, "PRODUCTION", action, "PRODUCTION_BATCH", batch.id,
              before={"production_status": batch.production_status},
              after={"production_status": "CANCELLED", "had_business": had_business})
    db.commit()
    return {"id": str(batch.id), "deleted": True, "action": action, "had_business": had_business}


def update_batch(db: Session, batch_id: uuid.UUID, *, version: int, values: dict, user: User) -> dict:
    batch = db.scalar(select(ProductionBatch).where(ProductionBatch.id == batch_id).with_for_update(of=ProductionBatch))
    if not batch:
        raise ApiError(404, "BATCH_NOT_FOUND", "Không tìm thấy mâm.")
    if batch.version != version:
        raise ApiError(409, "VERSION_CONFLICT", "Mâm đã thay đổi.", {"current_version": batch.version})
    protected = {"planned_quantity", "layer_expression", "workshop_unit_price_amount", "workshop_id"}
    if batch.workshop_settlement_id and any(key in values and values[key] is not None for key in protected):
        raise ApiError(409, "BATCH_ALREADY_SETTLED", "Không thể sửa số lượng/giá/nhà may của mâm đã chốt.")
    before = batch_dict(batch, db)

    # Nhà may / thợ cắt phải tồn tại trong danh mục.
    if values.get("workshop_id") is not None and not db.get(Workshop, values["workshop_id"]):
        raise ApiError(422, "WORKSHOP_NOT_FOUND", "Nhà may không hợp lệ.")
    if values.get("cutting_team_id") is not None and not db.get(CuttingTeam, values["cutting_team_id"]):
        raise ApiError(422, "CUTTING_TEAM_NOT_FOUND", "Thợ cắt không hợp lệ.")

    # Tên sản phẩm / mã rập không được trống khi sửa.
    for key, label in (("product_name", "Tên sản phẩm"), ("pattern_code", "Mã rập")):
        if values.get(key) is not None and not str(values[key]).strip():
            raise ApiError(422, "FIELD_REQUIRED", f"{label} không được để trống.")

    # Số lớp thay đổi -> tính lại tổng kế hoạch / còn thiếu / thành tiền.
    if values.get("layer_expression") is not None:
        new_planned = parse_quantity_expression(str(values["layer_expression"]))
        if new_planned != new_planned.to_integral_value() or new_planned <= 0:
            raise ApiError(422, "INVALID_LAYER_EXPRESSION", "Số lớp phải cho ra tổng kế hoạch nguyên dương.")
        if batch.delivered_quantity > new_planned:
            raise ApiError(422, "DELIVERED_EXCEEDS_PLAN", f"Số đã giao ({serial(batch.delivered_quantity)}) đang lớn hơn tổng mới ({serial(new_planned)}).")
        batch.layer_expression = str(values["layer_expression"]).strip()
        batch.planned_quantity = new_planned
        batch.remaining_quantity = new_planned - batch.delivered_quantity

    for key in ("expected_delivery_date", "production_status", "notes", "workshop_id",
                "cutting_team_id", "cut_date", "workshop_unit_price_amount"):
        if key in values and values[key] is not None:
            setattr(batch, key, values[key].strip() if isinstance(values[key], str) else values[key])

    if values.get("product_name") is not None:
        batch.product_name_snapshot = str(values["product_name"]).strip()
    if values.get("pattern_code") is not None:
        batch.pattern_code = str(values["pattern_code"]).strip().upper()

    # Thành tiền nhà may = đã giao × đơn giá (VND nguyên).
    if values.get("workshop_unit_price_amount") is not None or values.get("layer_expression") is not None:
        unit_price = int(values.get("workshop_unit_price_amount") or batch.workshop_unit_price_amount)
        if unit_price < 0:
            raise ApiError(422, "INVALID_PRICE", "Đơn giá nhà may không được âm.")
        batch.workshop_amount = int(batch.delivered_quantity * unit_price)

    batch.updated_by = user.id; batch.version += 1
    add_audit(db, user, "PRODUCTION", "UPDATE", "PRODUCTION_BATCH", batch.id, before=before, after=batch_dict(batch, db))
    db.commit(); return batch_dict(batch, db, full=True)


def force_close(db: Session, batch_id: uuid.UUID, *, reason: str, user: User) -> dict:
    batch = db.scalar(select(ProductionBatch).where(ProductionBatch.id == batch_id).with_for_update(of=ProductionBatch))
    if not batch: raise ApiError(404, "BATCH_NOT_FOUND", "Không tìm thấy mâm.")
    if not reason.strip(): raise ApiError(422, "REASON_REQUIRED", "Bắt buộc nhập lý do ép chốt.")
    before = batch.production_status; batch.production_status = "FORCE_CLOSED"; batch.version += 1; batch.updated_by = user.id
    add_audit(db, user, "PRODUCTION", "FORCE_CLOSE", "PRODUCTION_BATCH", batch.id,
              before={"status": before}, after={"status": batch.production_status, "reason": reason.strip()})
    db.commit(); return batch_dict(batch, db, full=True)


def create_receipt(db: Session, batch_id: uuid.UUID, *, receipt_date: date, warehouse_id: uuid.UUID,
                   color_id: uuid.UUID | None, lines: list[dict], notes: str | None,
                   idempotency_key: str, user: User) -> dict:
    existing = db.scalar(select(ProductionReceipt).where(ProductionReceipt.idempotency_key == idempotency_key))
    if existing: return receipt_dict(existing, db)
    batch = db.scalar(select(ProductionBatch).where(ProductionBatch.id == batch_id).with_for_update(of=ProductionBatch))
    if not batch: raise ApiError(404, "BATCH_NOT_FOUND", "Không tìm thấy mâm.")
    if not lines: raise ApiError(422, "RECEIPT_LINES_REQUIRED", "Phiếu nhận cần ít nhất một dòng.")
    warehouse = db.get(Warehouse, warehouse_id)
    if not warehouse: raise ApiError(422, "WAREHOUSE_NOT_FOUND", "Kho nhập không hợp lệ.")
    prepared = []
    total_now = Decimal(0)
    for raw in lines:
        qty = decimal(raw.get("received_now"))
        if qty == 0:
            raise ApiError(422, "RECEIPT_QUANTITY_REQUIRED", "Số lượng nhận/điều chỉnh phải khác 0.")
        if qty < 0 and raw.get("import_to_stock"):
            raise ApiError(422, "NEGATIVE_IMPORT_NOT_ALLOWED", "Điều chỉnh giảm không được nhập tồn kho.")
        plan_id = raw.get("batch_size_plan_id")
        plan = db.get(ProductionBatchSizePlan, plan_id) if plan_id else None
        if plan and plan.batch_id != batch.id: raise ApiError(422, "SIZE_PLAN_MISMATCH", "Dòng size không thuộc mâm.")
        variant_id = raw.get("product_variant_id") or (plan.product_variant_id if plan else None)
        previous = Decimal(db.scalar(select(func.coalesce(func.sum(ProductionReceiptLine.received_now), 0)).join(
            ProductionReceipt, ProductionReceipt.id == ProductionReceiptLine.receipt_id
        ).where(ProductionReceipt.batch_id == batch.id,
                ProductionReceiptLine.batch_size_plan_id == plan_id)) or 0) if plan_id else Decimal(0)
        planned = plan.planned_quantity if plan else Decimal(0)
        prepared.append((raw, plan, variant_id, qty, previous, planned)); total_now += qty
    if batch.delivered_quantity + total_now < 0:
        raise ApiError(422, "RECEIPT_WOULD_BE_NEGATIVE", "Tổng đã nhận không được âm.")
    receipt = ProductionReceipt(receipt_no=number("PNR"), receipt_date=receipt_date, batch_id=batch.id,
                                workshop_id=batch.workshop_id, color_id=color_id, warehouse_id=warehouse_id,
                                planned_quantity=batch.planned_quantity, actual_quantity=total_now,
                                difference_quantity=total_now - batch.remaining_quantity,
                                status="POSTED", receiver_id=user.id, notes=(notes or "").strip() or None,
                                idempotency_key=idempotency_key)
    db.add(receipt); db.flush(); receipt.inventory_receipt_id = receipt.id
    for index, (raw, plan, variant_id, qty, previous, planned) in enumerate(prepared):
        total = previous + qty; remaining = max(planned - total, Decimal(0)); import_stock = bool(raw.get("import_to_stock"))
        line = ProductionReceiptLine(receipt_id=receipt.id, batch_size_plan_id=plan.id if plan else None,
                                     product_variant_id=variant_id, planned_quantity=planned,
                                     previously_received=previous, received_now=qty, total_received=total,
                                     remaining_quantity=remaining, difference_quantity=total - planned,
                                     imported_to_stock=import_stock, notes=(raw.get("notes") or "").strip() or None)
        db.add(line); db.flush()
        if import_stock:
            if not variant_id: raise ApiError(422, "VARIANT_REQUIRED_FOR_STOCK", "Nhập kho cần biến thể sản phẩm.")
            post_inventory_receipt(db, variant_id=variant_id, warehouse_id=warehouse_id, quantity=qty,
                                   reference_type="PRODUCTION_RECEIPT", reference_id=receipt.id,
                                   actor_user_id=user.id, idempotency_key=f"{idempotency_key}:stock:{index}",
                                   notes=f"Nhập từ mâm {batch.batch_no}")
    batch.delivered_quantity += total_now
    batch.remaining_quantity = max(batch.planned_quantity - batch.delivered_quantity, Decimal(0))
    batch.receipt_status = "RECEIVED_FULL" if batch.remaining_quantity == 0 else "RECEIVED_PARTIAL"
    batch.production_status = "COMPLETED" if batch.remaining_quantity == 0 else batch.production_status
    batch.workshop_amount = int(batch.delivered_quantity * batch.workshop_unit_price_amount)
    batch.version += 1; batch.updated_by = user.id
    add_audit(db, user, "PRODUCTION", "RECEIPT_POST", "PRODUCTION_RECEIPT", receipt.id,
              idempotency_key, after={"batch_id": str(batch.id), "quantity": serial(total_now)})
    db.commit(); return receipt_dict(receipt, db)


def receipt_dict(receipt: ProductionReceipt, db: Session) -> dict:
    lines = list(db.scalars(select(ProductionReceiptLine).where(ProductionReceiptLine.receipt_id == receipt.id).order_by(ProductionReceiptLine.id)))
    receiver = db.get(User, receipt.receiver_id) if receipt.receiver_id else None
    return {"id": str(receipt.id), "receipt_no": receipt.receipt_no, "receipt_date": receipt.receipt_date.isoformat(),
            "batch_id": str(receipt.batch_id), "warehouse_id": str(receipt.warehouse_id),
            "planned_quantity": serial(receipt.planned_quantity), "actual_quantity": serial(receipt.actual_quantity),
            "difference_quantity": serial(receipt.difference_quantity), "status": receipt.status, "notes": receipt.notes,
            "received_by": receiver.display_name if receiver else None,
            "lines": [{"id": str(row.id), "batch_size_plan_id": str(row.batch_size_plan_id) if row.batch_size_plan_id else None,
                       "product_variant_id": str(row.product_variant_id) if row.product_variant_id else None,
                       "planned_quantity": serial(row.planned_quantity), "previously_received": serial(row.previously_received),
                       "received_now": serial(row.received_now), "total_received": serial(row.total_received),
                       "remaining_quantity": serial(row.remaining_quantity), "imported_to_stock": row.imported_to_stock,
                       "notes": row.notes} for row in lines]}


def list_receipts(db: Session, batch_id: uuid.UUID) -> list[dict]:
    return [receipt_dict(row, db) for row in db.scalars(select(ProductionReceipt).where(
        ProductionReceipt.batch_id == batch_id).order_by(ProductionReceipt.receipt_date.desc(), ProductionReceipt.created_at.desc()))]


def import_to_inventory(db: Session, batch_id: uuid.UUID, *, quantity, notes: str | None,
                        idempotency_key: str, user: User) -> dict:
    """Nhập kho thành phẩm: ghi stock ledger từ số lượng đã nhận của mâm, không vượt số đã nhận."""
    existing = db.scalar(select(InventoryTransaction).where(
        InventoryTransaction.idempotency_key == idempotency_key))
    if existing:
        batch = db.get(ProductionBatch, batch_id)
        if not batch:
            raise ApiError(404, "BATCH_NOT_FOUND", "Không tìm thấy mâm.")
        return batch_dict(batch, db, full=True)
    batch = db.scalar(select(ProductionBatch).where(ProductionBatch.id == batch_id).with_for_update(of=ProductionBatch))
    if not batch:
        raise ApiError(404, "BATCH_NOT_FOUND", "Không tìm thấy mâm.")
    qty = decimal(quantity, positive=True)
    importable = batch.delivered_quantity - batch.imported_quantity
    if qty > importable:
        raise ApiError(422, "IMPORT_EXCEEDS_RECEIVED", f"Số nhập kho ({serial(qty)}) vượt số đã nhận còn có thể nhập ({serial(importable)}).")
    plans = list(db.scalars(select(ProductionBatchSizePlan).where(ProductionBatchSizePlan.batch_id == batch.id).order_by(ProductionBatchSizePlan.id)))
    variant_plans = [plan for plan in plans if plan.product_variant_id]
    if not variant_plans:
        raise ApiError(422, "NO_VARIANT_FOR_STOCK", "Mâm chưa có biến thể sản phẩm ở kế hoạch size nên không thể nhập tồn kho.")
    total_planned = sum((plan.planned_quantity for plan in variant_plans), Decimal(0)) or Decimal(1)
    remaining = qty
    for index, plan in enumerate(variant_plans):
        if remaining <= 0:
            break
        if index == len(variant_plans) - 1:
            share = remaining
        else:
            share = (qty * plan.planned_quantity / total_planned).quantize(Decimal("0.001"))
            share = min(share, remaining)
        if share <= 0:
            continue
        post_inventory_receipt(db, variant_id=plan.product_variant_id, warehouse_id=batch.planned_warehouse_id,
                               quantity=share, reference_type="PRODUCTION_IMPORT", reference_id=batch.id,
                               actor_user_id=user.id, idempotency_key=f"{idempotency_key}:{index}",
                               notes=f"Nhập kho mâm {batch.batch_no}")
        remaining -= share
    batch.imported_quantity += qty
    batch.version += 1
    batch.updated_by = user.id
    add_audit(db, user, "PRODUCTION", "IMPORT_STOCK", "PRODUCTION_BATCH", batch.id,
              idempotency_key, after={"imported_quantity": serial(batch.imported_quantity), "quantity": serial(qty)})
    db.commit()
    return batch_dict(batch, db, full=True)


def material_delivery_history(db: Session, batch_id: uuid.UUID) -> dict:
    deliveries = list(db.scalars(select(BatchMaterialDelivery).where(BatchMaterialDelivery.batch_id == batch_id).order_by(BatchMaterialDelivery.created_at.asc())))
    events, totals = [], {}
    for delivery in deliveries:
        lines = list(db.scalars(select(BatchMaterialDeliveryLine).where(BatchMaterialDeliveryLine.delivery_id == delivery.id)))
        event_lines = []
        for line in lines:
            total = totals.setdefault(line.material_name_key, {"name": line.material_name_snapshot, "delivered": Decimal(0), "total_required": line.total_required})
            total["delivered"] += line.quantity_delivered
            total["total_required"] = line.total_required
            event_lines.append({"name": line.material_name_snapshot, "quantity_delivered": serial(line.quantity_delivered),
                                "total_required": serial(line.total_required), "delivery_mode": line.delivery_mode})
        events.append({"id": str(delivery.id), "delivery_no": delivery.delivery_no, "delivery_date": delivery.delivery_date.isoformat(),
                       "received_by": delivery.received_by, "notes": delivery.notes, "lines": event_lines})
    return {"catalog": sorted(set(DEFAULT_MATERIALS + [row["name"] for row in totals.values()])),
            "totals": [{"name": row["name"], "delivered": serial(row["delivered"]),
                        "total_required": serial(row["total_required"]),
                        "remaining": serial(max(row["total_required"] - row["delivered"], Decimal(0)))} for row in totals.values()],
            "events": list(reversed(events))}


def create_material_delivery(db: Session, batch_id: uuid.UUID, *, delivery_date: date,
                             received_by: str | None, notes: str | None, items: list[dict],
                             idempotency_key: str, user: User) -> dict:
    existing = db.scalar(select(BatchMaterialDelivery).where(BatchMaterialDelivery.idempotency_key == idempotency_key))
    if existing: return material_delivery_history(db, existing.batch_id)
    if not items or len(items) > 100: raise ApiError(422, "MATERIAL_LINE_LIMIT", "Chọn từ 1 đến 100 dòng phụ liệu.")
    batch = db.scalar(select(ProductionBatch).where(ProductionBatch.id == batch_id).with_for_update(of=ProductionBatch))
    if not batch: raise ApiError(404, "BATCH_NOT_FOUND", "Không tìm thấy mâm.")
    names = [str(item.get("name") or "").strip() for item in items]
    keys = [name.casefold() for name in names]
    if any(not name or len(name) > 120 for name in names) or len(set(keys)) != len(keys):
        raise ApiError(422, "MATERIAL_NAME_INVALID", "Tên phụ liệu bị trống, trùng hoặc quá dài.")
    old = material_delivery_history(db, batch.id)
    delivered_by_key = {row["name"].casefold(): Decimal(str(row["delivered"])) for row in old["totals"]}
    prepared = []
    for raw, name, key in zip(items, names, keys):
        required = decimal(raw.get("total_required"), positive=True); already = delivered_by_key.get(key, Decimal(0))
        if required < already: raise ApiError(409, "MATERIAL_REQUIRED_BELOW_DELIVERED", f"{name}: tổng cần nhỏ hơn số đã giao.")
        remaining = required - already
        qty = remaining if raw.get("deliver_full") else decimal(raw.get("quantity"), positive=True)
        if qty <= 0 or qty > remaining: raise ApiError(409, "MATERIAL_OVER_DELIVERY", f"{name}: số giao vượt phần còn thiếu.")
        prepared.append((raw, name, key, qty, required))
    delivery = BatchMaterialDelivery(delivery_no=number("GPL"), delivery_date=delivery_date,
                                     batch_id=batch.id, workshop_id=batch.workshop_id,
                                     delivered_by=user.id, received_by=(received_by or "").strip() or None,
                                     notes=(notes or "").strip() or None, idempotency_key=idempotency_key)
    db.add(delivery); db.flush()
    for raw, name, key, qty, required in prepared:
        db.add(BatchMaterialDeliveryLine(delivery_id=delivery.id, material_id=raw.get("material_id"),
                                        material_name_snapshot=name, material_name_key=key,
                                        quantity_delivered=qty, total_required=required,
                                        delivery_mode="FULL_REMAINDER" if raw.get("deliver_full") else "PARTIAL",
                                        notes=(raw.get("notes") or "").strip() or None))
    add_audit(db, user, "PRODUCTION", "MATERIAL_DELIVERY", "BATCH_MATERIAL_DELIVERY", delivery.id,
              idempotency_key, after={"batch_id": str(batch.id), "line_count": len(prepared)})
    db.commit(); result = material_delivery_history(db, batch.id); result["duplicate"] = False; return result


def settlement_dict(row: WorkshopSettlement, db: Session) -> dict:
    lines = list(db.scalars(select(WorkshopSettlementLine).where(WorkshopSettlementLine.settlement_id == row.id).order_by(WorkshopSettlementLine.id)))
    allocations = int(db.scalar(select(func.coalesce(func.sum(PaymentAllocation.allocated_amount), 0)).where(
        PaymentAllocation.target_type == "WORKSHOP_SETTLEMENT", PaymentAllocation.target_id == row.id)) or 0)
    return {"id": str(row.id), "settlement_no": row.settlement_no, "settlement_date": row.settlement_date.isoformat(),
            "workshop_id": str(row.workshop_id), "total_quantity": serial(row.total_quantity),
            "total_amount": row.total_amount, "paid_amount": row.paid_amount, "balance_amount": row.balance_amount,
            "status": row.status, "notes": row.notes, "version": row.version, "allocated_amount": allocations,
            "lines": [{"id": str(line.id), "production_batch_id": str(line.production_batch_id) if line.production_batch_id else None,
                       "supplemental_delivery_id": str(line.supplemental_delivery_id) if line.supplemental_delivery_id else None,
                       "quantity": serial(line.quantity), "unit_price_amount": line.unit_price_amount,
                       "amount": line.amount, "original_settlement_id": str(line.original_settlement_id) if line.original_settlement_id else None} for line in lines]}


def settlement_candidates(db: Session, workshop_id: uuid.UUID) -> dict:
    workshop = db.get(Workshop, workshop_id)
    if not workshop: raise ApiError(404, "WORKSHOP_NOT_FOUND", "Không tìm thấy nhà may.")
    batches = list(db.scalars(select(ProductionBatch).where(
        ProductionBatch.workshop_id == workshop_id, ProductionBatch.workshop_settlement_id.is_(None),
        ProductionBatch.delivered_quantity > 0, ProductionBatch.workshop_unit_price_amount > 0
    ).order_by(ProductionBatch.cut_date)))
    supplements = list(db.scalars(select(SupplementalWorkshopDelivery).where(
        SupplementalWorkshopDelivery.workshop_id == workshop_id,
        SupplementalWorkshopDelivery.status == "WAITING_SETTLEMENT",
        SupplementalWorkshopDelivery.supplemental_settlement_id.is_(None)
    ).order_by(SupplementalWorkshopDelivery.delivery_date)))
    return {"batches": [batch_dict(row, db) for row in batches],
            "supplemental_deliveries": [supplemental_dict(row) for row in supplements]}


def create_settlement(db: Session, *, workshop_id: uuid.UUID, batch_ids: list[uuid.UUID],
                      supplemental_ids: list[uuid.UUID], settlement_date: date, notes: str | None,
                      idempotency_key: str, user: User) -> dict:
    existing = db.scalar(select(WorkshopSettlement).where(WorkshopSettlement.idempotency_key == idempotency_key))
    if existing: return settlement_dict(existing, db)
    if not batch_ids and not supplemental_ids: raise ApiError(422, "SETTLEMENT_LINES_REQUIRED", "Chọn ít nhất một mâm hoặc phiếu bổ sung.")
    if not db.get(Workshop, workshop_id): raise ApiError(404, "WORKSHOP_NOT_FOUND", "Không tìm thấy nhà may.")
    sources = []
    for batch_id in sorted(set(batch_ids), key=str):
        batch = db.scalar(select(ProductionBatch).where(ProductionBatch.id == batch_id).with_for_update(of=ProductionBatch))
        if not batch or batch.workshop_id != workshop_id or batch.workshop_settlement_id or batch.delivered_quantity <= 0 or batch.workshop_unit_price_amount <= 0:
            raise ApiError(409, "SETTLEMENT_CANDIDATE_INVALID", "Có mâm không còn đủ điều kiện chốt.")
        amount = batch.delivered_quantity * batch.workshop_unit_price_amount
        if amount != amount.to_integral_value(): raise ApiError(422, "MONEY_FRACTION", "Thành tiền nhà may phải là VND nguyên.")
        sources.append(("batch", batch, batch.delivered_quantity, batch.workshop_unit_price_amount, int(amount), None))
    for supplemental_id in sorted(set(supplemental_ids), key=str):
        row = db.scalar(select(SupplementalWorkshopDelivery).where(SupplementalWorkshopDelivery.id == supplemental_id).with_for_update(of=SupplementalWorkshopDelivery))
        if not row or row.workshop_id != workshop_id or row.status != "WAITING_SETTLEMENT" or row.supplemental_settlement_id:
            raise ApiError(409, "SUPPLEMENTAL_CANDIDATE_INVALID", "Có phiếu hàng vét không còn đủ điều kiện chốt.")
        sources.append(("supplemental", row, row.quantity, row.unit_price_amount, row.amount, row.original_settlement_id))
    total_qty = sum((source[2] for source in sources), Decimal(0)); total_amount = sum(source[4] for source in sources)
    settlement = WorkshopSettlement(settlement_no=number("CNM"), settlement_date=settlement_date,
                                    workshop_id=workshop_id, total_quantity=total_qty, total_amount=total_amount,
                                    paid_amount=0, balance_amount=total_amount, status="UNPAID",
                                    notes=(notes or "").strip() or None, settled_by=user.id,
                                    idempotency_key=idempotency_key)
    db.add(settlement); db.flush()
    for kind, source, qty, unit_price, amount, original_id in sources:
        db.add(WorkshopSettlementLine(settlement_id=settlement.id,
                                     production_batch_id=source.id if kind == "batch" else None,
                                     supplemental_delivery_id=source.id if kind == "supplemental" else None,
                                     quantity=qty, unit_price_amount=unit_price, amount=amount,
                                     original_settlement_id=original_id))
        if kind == "batch":
            source.workshop_settlement_id = settlement.id; source.settlement_status = "SETTLED_UNPAID"; source.workshop_amount = amount; source.version += 1
        else:
            source.supplemental_settlement_id = settlement.id; source.status = "SETTLED"; source.version += 1
    db.add(DebtLedgerEntry(party_type="WORKSHOP", party_id=workshop_id, entry_type="WORKSHOP_SETTLEMENT",
                           amount_delta=total_amount, reference_type="WORKSHOP_SETTLEMENT", reference_id=settlement.id,
                           description=f"Bảng kê {settlement.settlement_no}", actor_user_id=user.id,
                           idempotency_key=f"{idempotency_key}:debt"))
    db.flush(); refresh_party(db, "WORKSHOP", workshop_id)
    add_audit(db, user, "PRODUCTION", "SETTLE", "WORKSHOP_SETTLEMENT", settlement.id,
              idempotency_key, after={"total_amount": total_amount, "line_count": len(sources)})
    db.commit(); return settlement_dict(settlement, db)


def list_settlements(db: Session, workshop_id: uuid.UUID | None = None, status: str | None = None) -> list[dict]:
    stmt = select(WorkshopSettlement).order_by(WorkshopSettlement.settlement_date.desc(), WorkshopSettlement.created_at.desc())
    if workshop_id: stmt = stmt.where(WorkshopSettlement.workshop_id == workshop_id)
    if status: stmt = stmt.where(WorkshopSettlement.status == status)
    return [settlement_dict(row, db) for row in db.scalars(stmt)]


def create_party_payment(db: Session, *, party_type: str, party_id: uuid.UUID, amount: int, method: str,
                         allocations: list[dict], note: str | None, idempotency_key: str, user: User,
                         paid_at: datetime | None = None) -> dict:
    existing = db.scalar(select(Payment).where(Payment.idempotency_key == idempotency_key))
    if existing: return payment_result(existing, db)
    if amount <= 0: raise ApiError(422, "INVALID_PAYMENT_AMOUNT", "Số tiền phải lớn hơn 0.")
    allocated_total = sum(int(item.get("allocated_amount") or 0) for item in allocations)
    if allocated_total > amount or any(int(item.get("allocated_amount") or 0) <= 0 for item in allocations):
        raise ApiError(422, "ALLOCATION_EXCEEDS_PAYMENT", "Tổng phân bổ không được vượt thanh toán.")
    paid_at_value = paid_at or now()
    payment = Payment(payment_no=number("PAY"), party_type=party_type,
                      workshop_id=party_id if party_type == "WORKSHOP" else None,
                      paid_at=paid_at_value, amount=amount, method=method, direction="PAYMENT",
                      received_or_paid_by=user.id, note=(note or "").strip() or None,
                      status="POSTED", idempotency_key=idempotency_key)
    db.add(payment); db.flush()
    for item in allocations:
        target_id = uuid.UUID(str(item["target_id"])); value = int(item["allocated_amount"])
        if party_type == "WORKSHOP":
            target = db.scalar(select(WorkshopSettlement).where(WorkshopSettlement.id == target_id).with_for_update(of=WorkshopSettlement))
            if not target or target.workshop_id != party_id or target.status == "VOID":
                raise ApiError(409, "ALLOCATION_TARGET_INVALID", "Bảng kê phân bổ không hợp lệ.")
            if value > target.balance_amount:
                raise ApiError(409, "ALLOCATION_EXCEEDS_TARGET", "Phân bổ vượt số dư bảng kê.")
            target.paid_amount += value; target.balance_amount = max(target.total_amount - target.paid_amount, 0)
            target.status = "PAID" if target.balance_amount == 0 else "PARTIALLY_PAID"; target.version += 1
            target_type = "WORKSHOP_SETTLEMENT"
        elif party_type == "CUTTING_TEAM":
            target = db.scalar(select(CuttingReport).where(CuttingReport.id == target_id).with_for_update(of=CuttingReport))
            if not target or target.cutting_team_id != party_id or target.status == "VOID":
                raise ApiError(409, "ALLOCATION_TARGET_INVALID", "Báo cáo cắt phân bổ không hợp lệ.")
            paid = int(db.scalar(select(func.coalesce(func.sum(PaymentAllocation.allocated_amount), 0)).where(
                PaymentAllocation.target_type == "CUTTING_REPORT", PaymentAllocation.target_id == target.id
            )) or 0) + value
            if paid > target.amount:
                raise ApiError(409, "ALLOCATION_EXCEEDS_TARGET", "Phân bổ vượt số dư báo cáo cắt.")
            target.status = "PAID" if paid >= target.amount else "PARTIALLY_PAID"
            target_type = "CUTTING_REPORT"
        else:
            raise ApiError(422, "PARTY_TYPE_INVALID", "Loại đối tượng thanh toán không hợp lệ.")
        db.add(PaymentAllocation(payment_id=payment.id, target_type=target_type,
                                 target_id=target_id, allocated_amount=value))
    db.add(DebtLedgerEntry(party_type=party_type, party_id=party_id, entry_type=f"{party_type}_PAYMENT",
                           amount_delta=-amount, reference_type="PAYMENT", reference_id=payment.id,
                           occurred_at=paid_at_value,
                           description=payment.note or payment.payment_no, actor_user_id=user.id,
                           idempotency_key=f"{idempotency_key}:debt"))
    db.flush(); refresh_party(db, party_type, party_id)
    add_audit(db, user, "PRODUCTION", "PAYMENT", "PAYMENT", payment.id, idempotency_key,
              after={"party_type": party_type, "party_id": str(party_id), "amount": amount, "allocated": allocated_total})
    db.commit(); return payment_result(payment, db)


def payment_result(payment: Payment, db: Session) -> dict:
    rows = list(db.scalars(select(PaymentAllocation).where(PaymentAllocation.payment_id == payment.id)))
    allocated = sum(row.allocated_amount for row in rows)
    return {"id": str(payment.id), "payment_no": payment.payment_no, "amount": payment.amount,
            "method": payment.method, "status": payment.status, "allocated_amount": allocated,
            "unallocated_amount": payment.amount - allocated,
            "allocations": [{"target_type": row.target_type, "target_id": str(row.target_id),
                             "allocated_amount": row.allocated_amount} for row in rows]}


def debt_statement(db: Session, party_type: str, party_id: uuid.UUID) -> dict:
    rows = list(db.scalars(select(DebtLedgerEntry).where(
        DebtLedgerEntry.party_type == party_type, DebtLedgerEntry.party_id == party_id
    ).order_by(DebtLedgerEntry.occurred_at, DebtLedgerEntry.created_at, DebtLedgerEntry.id)))
    balance = 0; entries = []
    for row in rows:
        balance += row.amount_delta
        entries.append({"id": str(row.id), "occurred_at": row.occurred_at.isoformat(), "entry_type": row.entry_type,
                        "debit": max(row.amount_delta, 0), "credit": max(-row.amount_delta, 0), "balance": balance,
                        "reference_type": row.reference_type, "reference_id": str(row.reference_id) if row.reference_id else None,
                        "description": row.description})
    return {"opening": sum(row.amount_delta for row in rows if row.entry_type == "OPENING"),
            "debit": sum(max(row.amount_delta, 0) for row in rows if row.entry_type != "OPENING"),
            "credit": sum(max(-row.amount_delta, 0) for row in rows), "closing": balance, "entries": entries}


def supplemental_dict(row: SupplementalWorkshopDelivery) -> dict:
    return {"id": str(row.id), "delivery_no": row.delivery_no, "delivery_date": row.delivery_date.isoformat(),
            "batch_id": str(row.batch_id), "workshop_id": str(row.workshop_id),
            "original_settlement_id": str(row.original_settlement_id), "quantity": serial(row.quantity),
            "unit_price_amount": row.unit_price_amount, "amount": row.amount, "notes": row.notes,
            "status": row.status, "supplemental_settlement_id": str(row.supplemental_settlement_id) if row.supplemental_settlement_id else None,
            "quantity_before": serial(row.quantity_before), "quantity_after": serial(row.quantity_after),
            "amount_before": row.amount_before, "amount_after": row.amount_after, "version": row.version}


def settled_batches(db: Session, workshop_id: uuid.UUID, q: str | None = None) -> list[dict]:
    rows = list(db.scalars(select(ProductionBatch).where(
        ProductionBatch.workshop_id == workshop_id, ProductionBatch.workshop_settlement_id.is_not(None)
    ).order_by(ProductionBatch.updated_at.desc())))
    needle = (q or "").casefold()
    if needle: rows = [row for row in rows if needle in row.batch_no.casefold() or needle in row.pattern_code.casefold()]
    return [batch_dict(row, db) for row in rows]


def create_supplemental(db: Session, *, batch_id: uuid.UUID, delivery_date: date, quantity,
                        unit_price_amount: int, notes: str | None, expected_batch_version: int,
                        idempotency_key: str, user: User) -> dict:
    existing = db.scalar(select(SupplementalWorkshopDelivery).where(SupplementalWorkshopDelivery.idempotency_key == idempotency_key))
    if existing: return supplemental_dict(existing)
    qty = decimal(quantity, positive=True)
    if qty != qty.to_integral_value() or unit_price_amount <= 0:
        raise ApiError(422, "SUPPLEMENTAL_VALUES_INVALID", "Hàng vét cần số lượng nguyên dương và đơn giá dương.")
    batch = db.scalar(select(ProductionBatch).where(ProductionBatch.id == batch_id).with_for_update(of=ProductionBatch))
    if not batch or not batch.workshop_settlement_id:
        raise ApiError(409, "ORIGINAL_SETTLEMENT_REQUIRED", "Chỉ mâm đã có bảng kê gốc mới được thêm hàng vét.")
    amount = int(qty * unit_price_amount)
    if batch.version != expected_batch_version:
        marker = SupplementalWorkshopDelivery(delivery_no=number("HV"), delivery_date=delivery_date,
            batch_id=batch.id, workshop_id=batch.workshop_id, original_settlement_id=batch.workshop_settlement_id,
            quantity=qty, unit_price_amount=unit_price_amount, amount=amount, entered_by=user.id,
            notes=(notes or "").strip() or None, idempotency_key=idempotency_key,
            status="RECONCILIATION_REQUIRED", quantity_before=batch.delivered_quantity,
            quantity_after=batch.delivered_quantity, amount_before=batch.workshop_amount, amount_after=batch.workshop_amount)
        db.add(marker); db.commit()
        raise ApiError(409, "RECONCILIATION_REQUIRED", "Mâm thay đổi đồng thời; phiếu đã đánh dấu cần đối soát.", {"delivery_id": str(marker.id)})
    before_qty, before_amount = batch.delivered_quantity, batch.workshop_amount
    row = SupplementalWorkshopDelivery(delivery_no=number("HV"), delivery_date=delivery_date,
        batch_id=batch.id, workshop_id=batch.workshop_id, original_settlement_id=batch.workshop_settlement_id,
        quantity=qty, unit_price_amount=unit_price_amount, amount=amount, entered_by=user.id,
        notes=(notes or "").strip() or None, idempotency_key=idempotency_key,
        status="WAITING_SETTLEMENT", quantity_before=before_qty, quantity_after=before_qty + qty,
        amount_before=before_amount, amount_after=before_amount + amount)
    db.add(row)
    db.flush()
    batch.delivered_quantity += qty; batch.remaining_quantity = max(batch.planned_quantity - batch.delivered_quantity, Decimal(0)); batch.workshop_amount += amount; batch.version += 1
    add_audit(db, user, "PRODUCTION", "SUPPLEMENTAL_DELIVERY", "SUPPLEMENTAL_WORKSHOP_DELIVERY", row.id,
              idempotency_key, before={"quantity": serial(before_qty), "amount": before_amount},
              after={"quantity": serial(row.quantity_after), "amount": row.amount_after})
    db.commit(); return supplemental_dict(row)


def create_cutting_report(db: Session, *, batch_id: uuid.UUID, quantity, unit_price_amount: int,
                          report_date: date, color: str | None, layers, notes: str | None,
                          idempotency_key: str, user: User) -> dict:
    existing_debt = db.scalar(select(DebtLedgerEntry).where(DebtLedgerEntry.idempotency_key == f"{idempotency_key}:debt"))
    if existing_debt:
        row = db.scalar(select(CuttingReport).where(CuttingReport.id == existing_debt.reference_id)); return cutting_report_dict(row)
    batch = db.get(ProductionBatch, batch_id)
    if not batch: raise ApiError(404, "BATCH_NOT_FOUND", "Không tìm thấy mâm.")
    qty = decimal(quantity, positive=True); layer_qty = decimal(layers)
    if unit_price_amount <= 0: raise ApiError(422, "INVALID_PRICE", "Đơn giá cắt phải dương.")
    amount_decimal = qty * unit_price_amount
    if amount_decimal != amount_decimal.to_integral_value(): raise ApiError(422, "MONEY_FRACTION", "Tiền công cắt phải là VND nguyên.")
    row = CuttingReport(report_no=number("CUT"), report_date=report_date, cutting_team_id=batch.cutting_team_id,
                        batch_id=batch.id, pattern_code=batch.pattern_code, color=(color or "").strip() or None,
                        layers=layer_qty, quantity=qty, unit_price_amount=unit_price_amount,
                        amount=int(amount_decimal), status="UNPAID", notes=(notes or "").strip() or None, created_by=user.id)
    db.add(row); db.flush()
    db.add(DebtLedgerEntry(party_type="CUTTING_TEAM", party_id=row.cutting_team_id, entry_type="CUTTING_REPORT",
                           amount_delta=row.amount, reference_type="CUTTING_REPORT", reference_id=row.id,
                           description=row.report_no, actor_user_id=user.id, idempotency_key=f"{idempotency_key}:debt"))
    db.flush(); refresh_party(db, "CUTTING_TEAM", row.cutting_team_id)
    add_audit(db, user, "PRODUCTION", "CUTTING_REPORT", "CUTTING_REPORT", row.id, idempotency_key, after={"amount": row.amount})
    db.commit(); return cutting_report_dict(row)


def cutting_report_dict(row: CuttingReport) -> dict:
    return {"id": str(row.id), "report_no": row.report_no, "report_date": row.report_date.isoformat(),
            "cutting_team_id": str(row.cutting_team_id), "batch_id": str(row.batch_id),
            "pattern_code": row.pattern_code, "color": row.color, "layers": serial(row.layers),
            "quantity": serial(row.quantity), "unit_price_amount": row.unit_price_amount,
            "amount": row.amount, "status": row.status, "notes": row.notes}


def list_pattern_notes(db: Session, q: str | None = None) -> list[dict]:
    rows = list(db.scalars(select(PatternNote).order_by(PatternNote.created_at.desc())))
    needle = (q or "").strip().casefold()
    if needle:
        rows = [row for row in rows if needle in row.title.casefold() or needle in row.content.casefold()]
    return [_pattern_note_dict(row, db) for row in rows]


def _pattern_note_media(db: Session, media_ids: list[str]) -> list[dict]:
    """Resolve media_ids (list[str]) -> danh sách media READY (giữ thứ tự lưu)."""
    if not media_ids:
        return []
    order = {str(value): index for index, value in enumerate(media_ids)}
    rows = list(db.scalars(select(MediaObject).where(
        MediaObject.id.in_([uuid.UUID(str(v)) for v in media_ids if _try_uuid(str(v))]),
        MediaObject.status == "READY")))
    rows.sort(key=lambda m: order.get(str(m.id), 10 ** 9))
    return [_media_dict(m) for m in rows]


def _try_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
        return True
    except (ValueError, TypeError):
        return False


def _pattern_note_dict(row: PatternNote, db: Session) -> dict:
    media = _pattern_note_media(db, row.media_ids or [])
    return {"id": str(row.id), "note_no": row.note_no, "title": row.title, "content": row.content,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "image_count": len(media), "cover_image": media[0] if media else None}


def pattern_note_detail(db: Session, note_id: uuid.UUID) -> dict:
    row = db.get(PatternNote, note_id)
    if not row:
        raise ApiError(404, "PATTERN_NOTE_NOT_FOUND", "Không tìm thấy ghi chú mã rập.")
    result = _pattern_note_dict(row, db)
    result["images"] = _pattern_note_media(db, row.media_ids or [])
    return result


def _month_bounds(month: str) -> tuple[date, date]:
    """'YYYY-MM' -> (ngày đầu tháng, ngày đầu tháng kế)."""
    year, mon = (int(part) for part in month.split("-"))
    start = date(year, mon, 1)
    if mon == 12:
        end = date(year + 1, 1, 1)
    else:
        end = date(year, mon + 1, 1)
    return start, end


def cutting_monthly_report(db: Session, month: str) -> dict:
    """Báo cáo thợ cắt theo tháng: mâm chưa có báo cáo cắt, gom theo thợ cắt."""
    start, end = _month_bounds(month)
    # Mâm trong tháng, có thợ cắt, chưa hủy.
    batches = list(db.scalars(select(ProductionBatch).where(
        ProductionBatch.cut_date >= start, ProductionBatch.cut_date < end,
        ProductionBatch.production_status != "CANCELLED",
    ).order_by(ProductionBatch.cut_date)))
    teams = {row.id: row for row in db.scalars(select(CuttingTeam).where(CuttingTeam.status == "ACTIVE"))}
    reported_batch_ids = set(db.scalars(select(CuttingReport.batch_id)))
    pending = [b for b in batches if b.cutting_team_id in teams and b.id not in reported_batch_ids]

    grouped: dict[uuid.UUID, dict] = {}
    for batch in pending:
        team = teams[batch.cutting_team_id]
        qty = int(batch.delivered_quantity) if batch.delivered_quantity > 0 else int(batch.planned_quantity)
        entry = grouped.setdefault(batch.cutting_team_id, {
            "team_id": str(team.id), "team_name": team.name,
            "default_unit_price_amount": team.default_unit_price_amount,
            "batches": [], "total_quantity": 0, "batch_count": 0})
        entry["batches"].append({"batch_id": str(batch.id), "batch_no": batch.batch_no,
                                 "pattern_code": batch.pattern_code, "product_name": batch.product_name_snapshot,
                                 "quantity": qty})
        entry["total_quantity"] += qty
        entry["batch_count"] += 1

    teams_list = sorted(grouped.values(), key=lambda r: r["team_name"].casefold())
    total_quantity = sum(r["total_quantity"] for r in teams_list)
    return {"month": month, "pending_count": len(pending),
            "teams": teams_list, "total_quantity": total_quantity,
            "total_batches": len(pending)}


def cutting_debt_summary(db: Session) -> dict:
    """Công nợ đội cắt tổng quát theo ledger (hỗ trợ bước sau)."""
    teams = list(db.scalars(select(CuttingTeam).where(CuttingTeam.status == "ACTIVE")))
    result = []
    for team in teams:
        entries = list(db.scalars(select(DebtLedgerEntry).where(
            DebtLedgerEntry.party_type == "CUTTING_TEAM", DebtLedgerEntry.party_id == team.id
        ).order_by(DebtLedgerEntry.occurred_at, DebtLedgerEntry.created_at, DebtLedgerEntry.id)))
        balance = sum(row.amount_delta for row in entries)
        debit = sum(row.amount_delta for row in entries if row.amount_delta > 0)
        credit = -sum(row.amount_delta for row in entries if row.amount_delta < 0)
        result.append({"team_id": str(team.id), "team_name": team.name,
                       "debit": debit, "credit": credit, "balance": balance, "entry_count": len(entries)})
    result.sort(key=lambda r: r["team_name"].casefold())
    return {"teams": result, "total_balance": sum(r["balance"] for r in result)}


def cutting_monthly_settlement(db: Session, *, month: str, user: User) -> dict:
    start, end = _month_bounds(month)
    batches = list(db.scalars(select(ProductionBatch).where(
        ProductionBatch.cut_date >= start, ProductionBatch.cut_date < end,
        ProductionBatch.production_status != "CANCELLED",
    ).with_for_update(of=ProductionBatch).order_by(ProductionBatch.cut_date)))
    reported = set(db.scalars(select(CuttingReport.batch_id)))
    teams = {row.id: row for row in db.scalars(select(CuttingTeam).where(CuttingTeam.status == "ACTIVE"))}
    pending = [b for b in batches if b.cutting_team_id in teams and b.id not in reported]
    if not pending:
        return {"settled": 0, "total_amount": 0, "reports": []}

    created = []
    total_amount = 0
    for batch in pending:
        team = teams[batch.cutting_team_id]
        if team.default_unit_price_amount <= 0:
            raise ApiError(422, "CUTTING_PRICE_MISSING", f"Thợ cắt {team.name} chưa có đơn giá mặc định để chốt công.")
        qty = int(batch.delivered_quantity) if batch.delivered_quantity > 0 else int(batch.planned_quantity)
        if qty <= 0:
            raise ApiError(422, "CUTTING_QUANTITY_INVALID", f"Mâm {batch.batch_no} không có số lượng để chốt.")
        amount = qty * team.default_unit_price_amount
        report = CuttingReport(report_no=number("CUT"), report_date=batch.cut_date,
                               cutting_team_id=team.id, batch_id=batch.id, pattern_code=batch.pattern_code,
                               color=None, layers=Decimal(qty), quantity=Decimal(qty),
                               unit_price_amount=team.default_unit_price_amount, amount=amount,
                               status="UNPAID", notes=f"Chốt công cắt tháng {month}", created_by=user.id)
        db.add(report); db.flush()
        db.add(DebtLedgerEntry(party_type="CUTTING_TEAM", party_id=team.id, entry_type="CUTTING_REPORT",
                               amount_delta=amount, reference_type="CUTTING_REPORT", reference_id=report.id,
                               description=report.report_no, actor_user_id=user.id,
                               idempotency_key=f"cut:{month}:{batch.id}"))
        created.append({"report_no": report.report_no, "batch_no": batch.batch_no,
                        "team_name": team.name, "quantity": qty, "amount": amount})
        total_amount += amount
    for team_id in {b.cutting_team_id for b in pending}:
        refresh_party(db, "CUTTING_TEAM", team_id)
    first = db.scalar(select(CuttingReport.id).where(CuttingReport.batch_id == pending[0].id))
    add_audit(db, user, "PRODUCTION", "CUTTING_MONTHLY_SETTLE", "CUTTING_REPORT", first,
              after={"month": month, "settled": len(pending), "total_amount": total_amount})
    db.commit()
    return {"settled": len(created), "total_amount": total_amount, "reports": created}


def cutting_reports(db: Session, month: str | None = None) -> list[dict]:
    """Danh sách báo cáo công cắt (chốt tháng), lọc theo tháng nếu có."""
    stmt = select(CuttingReport).order_by(CuttingReport.report_date.desc(), CuttingReport.created_at.desc())
    if month:
        start, end = _month_bounds(month)
        stmt = stmt.where(CuttingReport.report_date >= start, CuttingReport.report_date < end)
    rows = list(db.scalars(stmt))
    teams = {row.id: row.name for row in db.scalars(select(CuttingTeam))}
    users = {row.id: row.display_name for row in db.scalars(select(User))}
    return [{"id": str(r.id), "report_no": r.report_no, "report_date": r.report_date.isoformat(),
             "cutting_team_id": str(r.cutting_team_id), "team_name": teams.get(r.cutting_team_id, ""),
             "batch_no": db.get(ProductionBatch, r.batch_id).batch_no if db.get(ProductionBatch, r.batch_id) else None,
             "pattern_code": r.pattern_code, "quantity": serial(r.quantity),
             "unit_price_amount": r.unit_price_amount, "amount": r.amount, "status": r.status,
             "notes": r.notes, "created_by": users.get(r.created_by) if r.created_by else None} for r in rows]


def cutting_payment_history(db: Session, month: str | None = None) -> list[dict]:
    """Danh sách thanh toán/ứng tiền thợ cắt (từ debt ledger CUTTING_TEAM_PAYMENT)."""
    rows = list(db.scalars(select(DebtLedgerEntry).where(
        DebtLedgerEntry.party_type == "CUTTING_TEAM", DebtLedgerEntry.entry_type == "CUTTING_TEAM_PAYMENT"
    ).order_by(DebtLedgerEntry.occurred_at.desc(), DebtLedgerEntry.created_at.desc())))
    teams = {row.id: row.name for row in db.scalars(select(CuttingTeam))}
    users = {row.id: row.display_name for row in db.scalars(select(User))}
    result = []
    for row in rows:
        if month:
            occurred = row.occurred_at
            if occurred.tzinfo is not None:
                occurred = occurred.astimezone(timezone.utc)
            key = f"{occurred.year:04d}-{occurred.month:02d}"
            if key != month:
                continue
        result.append({"id": str(row.id), "occurred_at": row.occurred_at.isoformat(),
                       "team_id": str(row.party_id), "team_name": teams.get(row.party_id, ""),
                       "amount": -row.amount_delta, "description": row.description,
                       "entered_by": users.get(row.actor_user_id) if row.actor_user_id else None,
                       "reference_id": str(row.reference_id) if row.reference_id else None})
    return result


def cutting_monthly_debt(db: Session) -> dict:
    """Công nợ thợ cắt gom theo tháng: tổng chốt / đã trả / còn lại theo tháng."""
    reports = db.execute(select(CuttingReport.report_date, func.coalesce(func.sum(CuttingReport.amount), 0)).group_by(CuttingReport.report_date)).all()
    payments = db.execute(select(DebtLedgerEntry.occurred_at, func.coalesce(func.sum(DebtLedgerEntry.amount_delta), 0)).where(
        DebtLedgerEntry.party_type == "CUTTING_TEAM", DebtLedgerEntry.entry_type == "CUTTING_TEAM_PAYMENT"
    ).group_by(DebtLedgerEntry.occurred_at)).all()
    months: dict[str, dict] = {}

    def month_key(dt) -> str:
        if isinstance(dt, datetime):
            if dt.tzinfo is not None:
                dt = dt.astimezone(timezone.utc)
            return f"{dt.year:04d}-{dt.month:02d}"
        return f"{dt.year:04d}-{dt.month:02d}"

    for report_date, amount in reports:
        key = month_key(report_date)
        entry = months.setdefault(key, {"month": key, "settled": 0, "paid": 0})
        entry["settled"] += int(amount or 0)
    for occurred_at, delta in payments:
        key = month_key(occurred_at)
        entry = months.setdefault(key, {"month": key, "settled": 0, "paid": 0})
        entry["paid"] += int(-(delta or 0))
    result = []
    for key, entry in months.items():
        remaining = entry["settled"] - entry["paid"]
        entry["remaining"] = remaining
        entry["done"] = entry["settled"] > 0 and remaining <= 0
        result.append(entry)
    result.sort(key=lambda r: r["month"], reverse=True)
    return {"months": result, "total_remaining": sum(r["remaining"] for r in result)}


def create_pattern_note(db: Session, *, title: str, content: str, media_ids: list[uuid.UUID],
                        client_token: str, user: User) -> dict:
    existing = db.scalar(select(PatternNote).where(PatternNote.client_token == client_token))
    if existing: return next(row for row in list_pattern_notes(db) if row["id"] == str(existing.id))
    row = PatternNote(note_no=number("RAPNOTE"), title=title.strip(), content=content.strip(),
                      created_by=user.id, client_token=client_token, media_ids=[str(value) for value in media_ids])
    db.add(row); db.flush(); add_audit(db, user, "PRODUCTION", "CREATE", "PATTERN_NOTE", row.id, client_token); db.commit()
    return next(item for item in list_pattern_notes(db) if item["id"] == str(row.id))
