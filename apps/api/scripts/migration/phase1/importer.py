"""Phase 1 importers: khách, đơn, chi tiết, lịch sử, nợ, thanh toán, tồn, ảnh metadata.

Tất cả importer đều insert-only + idempotent:
- Customer  : dedupe theo customer_code
- Order     : dedupe theo order_no
- OrderItem : chỉ import cho đơn mới tạo (không ghi đè)
- Debt/Payment : idempotency_key từ legacy id
- Inventory : upsert theo (variant, warehouse, location)
- Media     : dedupe theo object_key = "legacy:<MaAnh>"

Mọi hàm trả report section; không commit khi dry_run.
"""
from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Color, Customer, DebtLedgerEntry, InventoryBalance, MediaObject, Order,
    OrderItem, OrderMedia, OrderStatusEvent, Payment, Product, ProductVariant,
    Warehouse, WarehouseLocation,
)
from . import mappings
from .source import (
    SourceSheet, decimal_qty, money_int, parse_date,
)


class Report:
    """Tích lũy thống kê + các mục bất thường để xuất báo cáo."""

    def __init__(self, dry_run: bool) -> None:
        self.dry_run = dry_run
        self.sections: dict[str, dict] = {}
        self.unmapped_status: list[dict] = []
        self.unmapped_warehouse: list[dict] = []
        self.unmapped_variant: list[dict] = []
        self.invalid_amount: list[dict] = []
        self.orphan_orders: list[dict] = []
        self.missing_customer: list[dict] = []
        self.missing_relation: list[dict] = []
        self.duplicate_names: list[dict] = []
        self.errors: list[str] = []
        self.media_mapping: list[dict] = []

    def section(self, name: str) -> dict:
        if name not in self.sections:
            self.sections[name] = {"source": 0, "valid": 0, "imported": 0, "skipped_existing": 0, "invalid": 0}
        return self.sections[name]

    def as_dict(self) -> dict:
        return {
            "dry_run": self.dry_run,
            "sections": self.sections,
            "unmapped_status": self.unmapped_status,
            "unmapped_warehouse": self.unmapped_warehouse,
            "unmapped_variant": self.unmapped_variant,
            "invalid_amount": self.invalid_amount,
            "orphan_orders": self.orphan_orders,
            "missing_customer": self.missing_customer,
            "missing_relation": self.missing_relation,
            "duplicate_names": self.duplicate_names,
            "media_mapping": self.media_mapping,
            "errors": self.errors,
        }


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    iso = parse_date(value)
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso).replace(tzinfo=timezone.utc)
    except ValueError:
        return None


# --------------------------------------------------------------------------
# Customers
# --------------------------------------------------------------------------
def import_customers(db: Session, sheet: SourceSheet, report: Report) -> None:
    sec = report.section("customers")
    codes = [row.values.get("customer_code") for row in sheet.rows if row.values.get("customer_code")]
    existing = set(db.scalars(select(Customer.customer_code).where(Customer.customer_code.in_(codes)))) if codes else set()

    name_to_codes: dict[str, set[str]] = defaultdict(set)
    for row in sheet.rows:
        name = row.values.get("name")
        code = row.values.get("customer_code")
        if name and code:
            key = name.strip().lower()
            name_to_codes[key].add(code)

    seen = set()
    for row in sheet.rows:
        sec["source"] += 1
        code = row.values.get("customer_code")
        name = row.values.get("name")
        if not code or not name:
            sec["invalid"] += 1
            continue
        if len(code) > 40 or len(name) > 300:
            sec["invalid"] += 1
            report.errors.append(f"{sheet.sheet} dòng {row.row_number}: MaKH/TenKhach vượt độ dài")
            continue
        if code in seen:
            sec["invalid"] += 1
            report.errors.append(f"{sheet.sheet} dòng {row.row_number}: MaKH trùng trong nguồn: {code}")
            continue
        seen.add(code)
        if code in existing:
            sec["skipped_existing"] += 1
            continue

        status, deleted = mappings.map_customer_status(row.values.get("status"))
        db.add(Customer(
            customer_code=code,
            name=name,
            phone=row.values.get("phone"),
            address=row.values.get("address"),
            carrier_name=row.values.get("carrier_name"),
            carrier_phone=row.values.get("carrier_phone"),
            customer_group=row.values.get("customer_group") or "Khách lẻ",
            status=status,
            deleted_at=_now() if deleted else None,
        ))
        sec["valid"] += 1
        sec["imported"] += 1

    # duplicate name nhưng khác code -> báo cáo, KHÔNG tự merge.
    for name, codes in name_to_codes.items():
        if len(codes) > 1:
            report.duplicate_names.append({"name": name, "customer_codes": sorted(codes)})


# --------------------------------------------------------------------------
# Orders + items + status history
# --------------------------------------------------------------------------
def _customer_map(db: Session) -> dict[str, uuid.UUID]:
    rows = db.execute(select(Customer.customer_code, Customer.id)).all()
    return {code: cid for code, cid in rows}


def _warehouse_map(db: Session) -> dict[str, uuid.UUID]:
    rows = db.execute(select(Warehouse.code, Warehouse.id)).all()
    return {code: wid for code, wid in rows}


def import_orders(
    db: Session,
    orders_sheet: SourceSheet,
    items_sheet: SourceSheet | None,
    history_sheet: SourceSheet | None,
    report: Report,
) -> None:
    sec = report.section("orders")
    items_sec = report.section("order_items")
    history_sec = report.section("status_history")

    customers = _customer_map(db)
    warehouses = _warehouse_map(db)
    default_warehouse_id = warehouses.get(mappings.DEFAULT_WAREHOUSE_CODE)

    existing_orders = set(db.scalars(select(Order.order_no)))
    seen_order_nos: set[str] = set()
    order_ids: dict[str, uuid.UUID] = {}

    items_by_order: dict[str, list[dict]] = defaultdict(list)
    if items_sheet:
        for row in items_sheet.rows:
            order_no = row.values.get("order_no")
            if order_no:
                items_by_order[order_no].append(row)

    history_by_order: dict[str, list[dict]] = defaultdict(list)
    if history_sheet:
        for row in history_sheet.rows:
            order_no = row.values.get("order_no")
            if order_no:
                history_by_order[order_no].append(row)

    for row in orders_sheet.rows:
        sec["source"] += 1
        order_no = row.values.get("order_no")
        customer_code = row.values.get("customer_code")
        if not order_no or not customer_code:
            sec["invalid"] += 1
            continue
        if order_no in existing_orders:
            sec["skipped_existing"] += 1
            continue
        if order_no in seen_order_nos:
            sec["invalid"] += 1
            report.errors.append(f"{orders_sheet.sheet} dòng {row.row_number}: MaHoaDon trùng trong nguồn: {order_no}")
            continue
        seen_order_nos.add(order_no)

        customer_id = customers.get(customer_code)
        if not customer_id:
            sec["invalid"] += 1
            report.missing_customer.append({
                "sheet": orders_sheet.sheet, "row": row.row_number,
                "order_no": order_no, "customer_code": customer_code,
            })
            continue

        warehouse_id = mappings.map_warehouse(row.values.get("warehouse"))
        if warehouse_id:
            warehouse_id = warehouses.get(warehouse_id)
        if not warehouse_id:
            warehouse_id = default_warehouse_id
            report.unmapped_warehouse.append({
                "sheet": orders_sheet.sheet, "row": row.row_number, "order_no": order_no,
                "source_value": row.values.get("warehouse"),
            })

        status = mappings.map_status(row.values.get("status"), mappings.ORDER_STATUS_MAP)
        if status is None:
            report.unmapped_status.append({
                "sheet": orders_sheet.sheet, "row": row.row_number, "order_no": order_no,
                "field": "TrangThai", "source_value": row.values.get("status"),
            })
            status = "NEW"

        billing = mappings.map_status(row.values.get("billing_status"), mappings.BILLING_STATUS_MAP)
        if billing is None:
            billing = "DRAFT"

        created_date = parse_date(row.values.get("created_date")) or date.today().isoformat()
        delivery_date = parse_date(row.values.get("delivery_date"))

        order = Order(
            order_no=order_no,
            customer_id=customer_id,
            warehouse_id=warehouse_id,
            order_type=mappings.map_order_type(row.values.get("order_type")) or "NORMAL",
            created_date=date.fromisoformat(created_date),
            delivery_date=date.fromisoformat(delivery_date) if delivery_date else None,
            status=status,
            billing_status=billing,
            source_channel=mappings.map_source_channel(row.values.get("channel")),
            customer_note=row.values.get("customer_note"),
            staff_note=row.values.get("staff_note"),
            total_amount=money_int(row.values.get("total_amount"), sheet=orders_sheet.sheet, row=row.row_number, field="TongTien"),
            paid_amount=money_int(row.values.get("paid_amount"), sheet=orders_sheet.sheet, row=row.row_number, field="DaThanhToan"),
            invoice_balance_amount=money_int(row.values.get("invoice_debt"), sheet=orders_sheet.sheet, row=row.row_number, field="NoTrongHoaDon"),
            version=1,
        )
        db.add(order)
        db.flush()
        order_ids[order_no] = order.id
        sec["valid"] += 1
        sec["imported"] += 1

        _import_items(db, order, order_no, items_by_order.get(order_no, []), items_sec, report)
        _import_history(db, order, order_no, history_by_order.get(order_no, []), history_sec, report)


def _import_items(db: Session, order: Order, order_no: str, rows: list, sec: dict, report: Report) -> None:
    variants = {v.internal_code: v.id for v in db.scalars(select(ProductVariant))}
    line_no = 0
    for row in rows:
        sec["source"] += 1
        product_name = row.values.get("product_name")
        if not product_name:
            sec["invalid"] += 1
            continue
        quantity = decimal_qty(row.values.get("quantity"), sheet="tbl_ChiTietDonHang", row=row.row_number, field="SoLuong")
        unit_price = money_int(row.values.get("unit_price"), sheet="tbl_ChiTietDonHang", row=row.row_number, field="DonGia")
        line_total = money_int(row.values.get("line_total"), sheet="tbl_ChiTietDonHang", row=row.row_number, field="ThanhTien")
        if quantity <= 0:
            sec["invalid"] += 1
            continue
        computed = int((quantity * unit_price).to_integral_value())
        if abs(computed - line_total) > 1:
            report.invalid_amount.append({
                "order_no": order_no, "row": row.row_number, "product": product_name,
                "quantity": str(quantity), "unit_price": unit_price,
                "computed": computed, "source_line_total": line_total,
            })

        variant_id = variants.get(row.values.get("internal_code")) or variants.get(row.values.get("sales_code"))
        line_no += 1
        db.add(OrderItem(
            order_id=order.id,
            line_no=line_no,
            product_variant_id=variant_id,
            product_name_snapshot=product_name[:300],
            sales_code_snapshot=row.values.get("sales_code"),
            internal_code_snapshot=row.values.get("internal_code"),
            color_snapshot=row.values.get("color"),
            size_snapshot=row.values.get("size"),
            warehouse_id=order.warehouse_id,
            quantity=quantity,
            unit_price_amount=unit_price,
            line_total_amount=line_total,
            sale_type=row.values.get("sale_type"),
            product_image_url_snapshot=row.values.get("product_image"),
            notes=row.values.get("note"),
            revision_no=1,
            active=True,
        ))
        sec["valid"] += 1
        sec["imported"] += 1


def _import_history(db: Session, order: Order, order_no: str, rows: list, sec: dict, report: Report) -> None:
    for row in rows:
        sec["source"] += 1
        to_status = mappings.map_status(row.values.get("to_status"), mappings.ORDER_STATUS_MAP)
        if to_status is None:
            report.unmapped_status.append({
                "sheet": "tbl_LichSuTrangThaiDon", "row": row.row_number, "order_no": order_no,
                "field": "to_status", "source_value": row.values.get("to_status"),
            })
            continue
        from_status = mappings.map_status(row.values.get("from_status"), mappings.ORDER_STATUS_MAP)
        db.add(OrderStatusEvent(
            order_id=order.id,
            from_status=from_status,
            to_status=to_status,
            reason=row.values.get("reason"),
            occurred_at=_parse_dt(row.values.get("occurred_at")) or _now(),
        ))
        sec["valid"] += 1
        sec["imported"] += 1


# --------------------------------------------------------------------------
# Debt ledger (tbl_NhatKyNo) + payments (tbl_ThanhToanKhach)
# --------------------------------------------------------------------------
def import_debt_ledger(db: Session, sheet: SourceSheet, report: Report) -> None:
    sec = report.section("debt_ledger")
    customers = _customer_map(db)
    existing_keys = set(db.scalars(select(DebtLedgerEntry.idempotency_key).where(DebtLedgerEntry.idempotency_key.is_not(None))))
    index = 0
    for row in sheet.rows:
        sec["source"] += 1
        customer_code = row.values.get("customer_code")
        customer_id = customers.get(customer_code) if customer_code else None
        if not customer_id:
            sec["invalid"] += 1
            report.missing_customer.append({
                "sheet": sheet.sheet, "row": row.row_number, "customer_code": customer_code,
            })
            continue
        entry_type = mappings.map_debt_entry_type(row.values.get("entry_type"))
        if entry_type is None:
            sec["invalid"] += 1
            report.unmapped_status.append({
                "sheet": sheet.sheet, "row": row.row_number, "field": "entry_type",
                "source_value": row.values.get("entry_type"),
            })
            continue
        amount = money_int(row.values.get("amount"), sheet=sheet.sheet, row=row.row_number, field="SoTien")
        # Dấu: thanh toán/hàng trả làm GIẢM nợ.
        signed = amount if entry_type not in mappings.DEBT_DECREASING_TYPES else -amount
        index += 1
        key = f"legacy-nhatkyno:{row.values.get('legacy_id') or index}"
        if key in existing_keys:
            sec["skipped_existing"] += 1
            continue
        db.add(DebtLedgerEntry(
            party_type="CUSTOMER",
            party_id=customer_id,
            occurred_at=_parse_dt(row.values.get("occurred_at")) or _now(),
            entry_type=entry_type,
            amount_delta=signed,
            reference_type="LEGACY_IMPORT",
            reference_id=customer_id,
            description=row.values.get("description"),
            actor_user_id=None,
            idempotency_key=key,
        ))
        sec["valid"] += 1
        sec["imported"] += 1


def import_payments(db: Session, sheet: SourceSheet, report: Report) -> None:
    sec = report.section("payments")
    customers = _customer_map(db)
    existing = set(db.scalars(select(Payment.idempotency_key).where(Payment.idempotency_key.is_not(None))))
    index = 0
    for row in sheet.rows:
        sec["source"] += 1
        customer_code = row.values.get("customer_code")
        customer_id = customers.get(customer_code) if customer_code else None
        if not customer_id:
            sec["invalid"] += 1
            report.missing_customer.append({
                "sheet": sheet.sheet, "row": row.row_number, "customer_code": customer_code,
            })
            continue
        amount = money_int(row.values.get("amount"), sheet=sheet.sheet, row=row.row_number, field="SoTien")
        if amount <= 0:
            sec["invalid"] += 1
            continue
        index += 1
        legacy_id = row.values.get("legacy_id")
        key = f"legacy-thanhtoan:{legacy_id or index}"
        if key in existing:
            sec["skipped_existing"] += 1
            continue
        db.add(Payment(
            payment_no=legacy_id or f"LEGACY-PAY-{index}",
            party_type="CUSTOMER",
            customer_id=customer_id,
            paid_at=_parse_dt(row.values.get("paid_at")) or _now(),
            amount=amount,
            method=mappings.map_payment_method(row.values.get("method")),
            direction="RECEIPT",
            note=row.values.get("note"),
            status="POSTED",
            idempotency_key=key,
        ))
        sec["valid"] += 1
        sec["imported"] += 1


# --------------------------------------------------------------------------
# Inventory (tbl_Kho_BienThe -> variants; tbl_Kho_Ton -> balances)
# --------------------------------------------------------------------------
def import_inventory(
    db: Session,
    variants_sheet: SourceSheet | None,
    inventory_sheet: SourceSheet,
    report: Report,
) -> None:
    variants_sec = report.section("product_variants")
    inv_sec = report.section("inventory")

    variant_ids: dict[str, uuid.UUID] = {}
    if variants_sheet:
        existing_internal = {v.internal_code for v in db.scalars(select(ProductVariant))}
        products = {p.product_code: p for p in db.scalars(select(Product))}
        colors = {c.canonical_name.strip().lower(): c for c in db.scalars(select(Color))}
        for row in variants_sheet.rows:
            variants_sec["source"] += 1
            internal_code = row.values.get("internal_code")
            size = row.values.get("size")
            if not internal_code or not size:
                variants_sec["invalid"] += 1
                continue
            if internal_code in existing_internal:
                variants_sec["skipped_existing"] += 1
                continue
            product = products.get(row.values.get("product_code"))
            if product is None:
                # Không tự sinh sản phẩm khi thiếu master; báo cáo.
                report.unmapped_variant.append({
                    "sheet": variants_sheet.sheet, "row": row.row_number, "internal_code": internal_code,
                    "reason": "product_code không tồn tại",
                })
                variants_sec["invalid"] += 1
                continue
            color_name = (row.values.get("color") or "").strip().lower()
            color = colors.get(color_name)
            db.add(ProductVariant(
                product_id=product.id,
                internal_code=internal_code,
                sales_code=row.values.get("sales_code"),
                color_id=color.id if color else None,
                size=size,
                display_name=row.values.get("display_name") or internal_code,
                status="ACTIVE",
                version=1,
            ))
            variants_sec["valid"] += 1
            variants_sec["imported"] += 1
        db.flush()

    for v in db.scalars(select(ProductVariant)):
        variant_ids[v.internal_code] = v.id
        if v.sales_code:
            variant_ids[v.sales_code] = v.id

    warehouses = _warehouse_map(db)
    locations: dict[tuple[uuid.UUID, str], uuid.UUID] = {}
    for loc in db.scalars(select(WarehouseLocation)):
        if loc.code:
            locations[(loc.warehouse_id, loc.code.strip().lower())] = loc.id

    existing_scopes = set(db.execute(select(
        InventoryBalance.variant_id, InventoryBalance.warehouse_id, InventoryBalance.location_id,
    )).all())

    for row in inventory_sheet.rows:
        inv_sec["source"] += 1
        variant_id = variant_ids.get(row.values.get("internal_code")) or variant_ids.get(row.values.get("sales_code"))
        if not variant_id:
            inv_sec["invalid"] += 1
            report.unmapped_variant.append({
                "sheet": inventory_sheet.sheet, "row": row.row_number,
                "internal_code": row.values.get("internal_code"),
                "sales_code": row.values.get("sales_code"),
                "reason": "không khớp product_variant",
            })
            continue
        wcode = mappings.map_warehouse(row.values.get("warehouse"))
        warehouse_id = warehouses.get(wcode) if wcode else None
        if not warehouse_id:
            inv_sec["invalid"] += 1
            report.unmapped_warehouse.append({
                "sheet": inventory_sheet.sheet, "row": row.row_number,
                "source_value": row.values.get("warehouse"),
            })
            continue
        location_code = (row.values.get("location") or "").strip().lower()
        location_id = locations.get((warehouse_id, location_code)) if location_code else None
        scope = (variant_id, warehouse_id, location_id)
        if scope in existing_scopes:
            inv_sec["skipped_existing"] += 1
            continue
        on_hand = decimal_qty(row.values.get("on_hand"), sheet=inventory_sheet.sheet, row=row.row_number, field="ton")
        reserved = decimal_qty(row.values.get("reserved"), sheet=inventory_sheet.sheet, row=row.row_number, field="giu")
        db.add(InventoryBalance(
            variant_id=variant_id,
            warehouse_id=warehouse_id,
            location_id=location_id,
            on_hand=on_hand,
            reserved=min(reserved, on_hand),
            available=decimal_qty(row.values.get("available"), sheet=inventory_sheet.sheet, row=row.row_number, field="khadung") or (on_hand - min(reserved, on_hand)),
            pending_finish=decimal_qty(row.values.get("pending_finish"), sheet=inventory_sheet.sheet, row=row.row_number, field="chohoanthien"),
            cut_separated=decimal_qty(row.values.get("cut_separated"), sheet=inventory_sheet.sheet, row=row.row_number, field="dacotri"),
            defective=decimal_qty(row.values.get("defective"), sheet=inventory_sheet.sheet, row=row.row_number, field="hangloi"),
            version=1,
        ))
        inv_sec["valid"] += 1
        inv_sec["imported"] += 1


# --------------------------------------------------------------------------
# Media metadata (tbl_DonHang_AnhZalo)
# --------------------------------------------------------------------------
def import_media(db: Session, sheet: SourceSheet, report: Report) -> None:
    sec = report.section("media")
    order_ids = {o.order_no: o.id for o in db.scalars(select(Order))}
    existing_keys = set(db.scalars(select(MediaObject.object_key)))

    for row in sheet.rows:
        sec["source"] += 1
        ma_anh = row.values.get("ma_anh")
        order_no = row.values.get("order_no")
        if not ma_anh or not order_no:
            sec["invalid"] += 1
            continue
        key = mappings.legacy_media_key(ma_anh)
        if key in existing_keys:
            sec["skipped_existing"] += 1
            continue
        order_id = order_ids.get(order_no)
        if not order_id:
            sec["invalid"] += 1
            report.missing_relation.append({
                "sheet": sheet.sheet, "row": row.row_number, "ma_anh": ma_anh, "order_no": order_no,
            })
            continue

        drive_link = row.values.get("drive_link")
        if drive_link and not mappings.is_drive_link(drive_link):
            report.errors.append(f"{sheet.sheet} dòng {row.row_number}: LinkAnh không giống Google Drive link: {drive_link}")

        media = MediaObject(
            storage_provider=mappings.MEDIA_LEGACY_PROVIDER,
            storage=mappings.MEDIA_LEGACY_STORAGE,
            bucket=None,
            object_key=key,
            version_id=None,
            original_name=ma_anh,
            content_type=mappings.guess_content_type(row.values.get("original_name")),
            size_bytes=0,
            checksum="",
            sha256="",
            status="PENDING_UPLOAD",
            uploaded_by=None,
        )
        db.add(media)
        db.flush()
        db.add(OrderMedia(order_id=order_id, media_id=media.id))
        sec["valid"] += 1
        sec["imported"] += 1
        report.media_mapping.append({
            "ma_anh": ma_anh,
            "media_id": str(media.id),
            "order_no": order_no,
            "drive_link": drive_link,
            "uploader": row.values.get("uploader"),
            "note": row.values.get("note"),
            "created_at": row.values.get("created_at"),
        })
