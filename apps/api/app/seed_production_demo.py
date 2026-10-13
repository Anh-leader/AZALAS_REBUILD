"""Seed isolated, repeatable demo data for the QL Rập workflow.

Run from apps/api with:
    .venv\\Scripts\\python.exe -m app.seed_production_demo --confirm-local-demo
"""

from __future__ import annotations

import argparse
import hashlib
import struct
import sys
import zlib
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
import uuid

from sqlalchemy import select
from sqlalchemy.engine import make_url

from app.core.config import settings
from app.core.db import SessionLocal
from app.models import (
    CuttingReport,
    CuttingTeam,
    FabricType,
    MediaObject,
    PatternNote,
    Product,
    ProductionBatch,
    ProductionBatchSizePlan,
    User,
    Warehouse,
    Workshop,
)
from app.services.production import (
    add_audit,
    create_batch,
    create_cutting_report,
    create_cutting_team,
    create_fabric_type,
    create_pattern_note,
    create_party_payment,
    create_receipt,
    create_settlement,
    cutting_reports,
    create_workshop,
)
from app.services.storage import put_object


WIDTH, HEIGHT = 360, 440
BACKGROUND = (250, 249, 246)
GRID = (228, 231, 234)
INK = (35, 49, 67)


def _png_chunk(kind: bytes, data: bytes) -> bytes:
    body = kind + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)


def _pattern_image(kind: str, accent: tuple[int, int, int]) -> bytes:
    pixels = [[BACKGROUND for _ in range(WIDTH)] for _ in range(HEIGHT)]

    def set_pixel(x: int, y: int, color: tuple[int, int, int]) -> None:
        if 0 <= x < WIDTH and 0 <= y < HEIGHT:
            pixels[y][x] = color

    def line(x0: int, y0: int, x1: int, y1: int, color: tuple[int, int, int]) -> None:
        dx, sx = abs(x1 - x0), 1 if x0 < x1 else -1
        dy, sy = -abs(y1 - y0), 1 if y0 < y1 else -1
        error = dx + dy
        while True:
            set_pixel(x0, y0, color)
            if x0 == x1 and y0 == y1:
                break
            twice = 2 * error
            if twice >= dy:
                error += dy
                x0 += sx
            if twice <= dx:
                error += dx
                y0 += sy

    def polygon(points: list[tuple[int, int]], fill: tuple[int, int, int]) -> None:
        min_y = min(y for _, y in points)
        max_y = max(y for _, y in points)
        for y in range(min_y, max_y + 1):
            intersections = []
            for index, (x1, y1) in enumerate(points):
                x2, y2 = points[(index + 1) % len(points)]
                if (y1 <= y < y2) or (y2 <= y < y1):
                    intersections.append(round(x1 + (y - y1) * (x2 - x1) / (y2 - y1)))
            intersections.sort()
            for left, right in zip(intersections[::2], intersections[1::2]):
                for x in range(left, right + 1):
                    set_pixel(x, y, fill)
        for index, point in enumerate(points):
            line(*point, *points[(index + 1) % len(points)], INK)

    for x in range(30, WIDTH - 20, 20):
        for y in range(58, HEIGHT - 20):
            set_pixel(x, y, GRID)
    for y in range(60, HEIGHT - 20, 20):
        for x in range(30, WIDTH - 20):
            set_pixel(x, y, GRID)

    for y in range(0, 42):
        for x in range(WIDTH):
            set_pixel(x, y, INK)
    for y in range(HEIGHT - 28, HEIGHT):
        for x in range(WIDTH):
            set_pixel(x, y, accent)

    if kind == "shirt":
        points = [(126, 117), (153, 88), (179, 108), (205, 88), (234, 117),
                  (218, 151), (203, 142), (203, 315), (157, 315), (157, 142),
                  (142, 151)]
        polygon(points, accent)
        line(179, 110, 179, 315, INK)
        for y in (148, 178, 208, 238, 268):
            set_pixel(185, y, INK)
        line(157, 143, 203, 143, INK)
    elif kind == "pants":
        points = [(126, 104), (234, 104), (225, 184), (213, 315), (185, 315),
                  (179, 192), (173, 315), (145, 315), (133, 184)]
        polygon(points, accent)
        line(126, 126, 234, 126, INK)
        line(179, 128, 179, 190, INK)
    else:
        points = [(125, 114), (151, 86), (179, 108), (207, 86), (235, 114),
                  (222, 151), (207, 142), (214, 315), (145, 315), (152, 142),
                  (137, 151)]
        polygon(points, accent)
        line(179, 109, 179, 315, INK)
        line(150, 170, 169, 170, INK)
        line(189, 170, 208, 170, INK)
        for y in (145, 180, 215, 250, 285):
            set_pixel(183, y, INK)

    raw = b"".join(b"\x00" + b"".join(bytes(color) for color in row) for row in pixels)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", struct.pack(">IIBBBBB", WIDTH, HEIGHT, 8, 2, 0, 0, 0))
        + _png_chunk(b"IDAT", zlib.compress(raw, level=9))
        + _png_chunk(b"IEND", b"")
    )


def ensure_media(db, *, code: str, title: str, kind: str, accent: tuple[int, int, int], user: User) -> MediaObject:
    filename = f"{code}.png"
    object_key = f"demo/production-patterns/{filename}"
    media = db.scalar(select(MediaObject).where(MediaObject.object_key == object_key))
    if media:
        stored_file = Path(settings.upload_dir) / object_key
        if (
            media.status != "READY"
            or media.content_type != "image/png"
            or media.storage_provider != "local"
            or media.storage != "LOCAL"
            or not stored_file.is_file()
        ):
            raise RuntimeError(f"Media demo hiện có không hợp lệ: {filename}")
        return media

    data = _pattern_image(kind, accent)
    storage, bucket, version_id = put_object(object_key=object_key, data=data, content_type="image/png")
    media = MediaObject(
        storage_provider="local",
        storage=storage,
        bucket=bucket,
        object_key=object_key,
        version_id=version_id,
        original_name=filename,
        content_type="image/png",
        size_bytes=len(data),
        checksum=hashlib.sha256(data).hexdigest(),
        sha256=hashlib.sha256(data).hexdigest(),
        status="READY",
        uploaded_by=user.id,
    )
    db.add(media)
    db.commit()
    db.refresh(media)
    print(f"Ảnh mẫu: {title} ({filename})")
    return media


def seed(*, confirm_local_demo: bool) -> None:
    if not confirm_local_demo:
        raise SystemExit("Thiếu --confirm-local-demo; chưa ghi dữ liệu.")

    database_url = make_url(settings.database_url)
    if database_url.host not in {"localhost", "127.0.0.1", "::1"} or database_url.database != "azalas":
        raise SystemExit("Từ chối seed: chỉ cho phép DB local azalas.")
    if settings.storage_driver.lower() != "local":
        raise SystemExit("Từ chối seed: script này chỉ tạo media local demo.")

    db = SessionLocal()
    try:
        user = db.scalar(select(User).where(User.username == "owner", User.role == "OWNER"))
        warehouse = db.scalar(select(Warehouse).where(Warehouse.active).order_by(Warehouse.sort_order))
        if not user or not warehouse:
            raise RuntimeError("Cần có tài khoản OWNER và ít nhất một kho đang hoạt động.")

        workshop_specs = [
            ("DEMO-NM-ANPHU", "DEMO - Nhà may An Phú", "Nhà may dùng để trình diễn quy trình QL Rập."),
            ("DEMO-NM-BINHMINH", "DEMO - Nhà may Bình Minh", "Nhà may demo thứ hai để minh họa phân công."),
        ]
        workshops: dict[str, Workshop] = {}
        for code, name, notes in workshop_specs:
            row = db.scalar(select(Workshop).where(Workshop.workshop_code == code))
            if not row:
                create_workshop(db, workshop_code=code, name=name, phone=None,
                                address="Địa chỉ demo", notes=notes, user=user)
                row = db.scalar(select(Workshop).where(Workshop.workshop_code == code))
                print(f"Nhà may: {name}")
            assert row is not None
            workshops[code] = row

        cutter_specs = [
            ("DEMO-CAT-HOA", "DEMO - Tổ cắt Hoa", 500),
            ("DEMO-CAT-MINH", "DEMO - Tổ cắt Minh", 550),
            ("DEMO-CAT-TAM", "DEMO - Tổ cắt Tâm", 600),
        ]
        cutters: dict[str, CuttingTeam] = {}
        for code, name, unit_price in cutter_specs:
            row = db.scalar(select(CuttingTeam).where(CuttingTeam.team_code == code))
            if not row:
                conflicting_name = db.scalar(select(CuttingTeam).where(CuttingTeam.name == name))
                if conflicting_name:
                    raise RuntimeError(f"Tên demo đã được dùng với mã khác: {name}")
                create_cutting_team(db, team_code=code, name=name, phone=None,
                                    default_unit_price_amount=unit_price,
                                    notes="Dữ liệu demo QL Rập.", user=user)
                row = db.scalar(select(CuttingTeam).where(CuttingTeam.team_code == code))
                print(f"Thợ cắt: {name}")
            assert row is not None
            cutters[code] = row

        fabric = db.scalar(select(FabricType).where(FabricType.code == "DEMO-VAI-COTTON"))
        if not fabric:
            create_fabric_type(db, code="DEMO-VAI-COTTON", name="DEMO - Thun cotton",
                               notes="Loại vải demo, không phát sinh nhập kho.", user=user)
            fabric = db.scalar(select(FabricType).where(FabricType.code == "DEMO-VAI-COTTON"))
            print("Loại vải: DEMO - Thun cotton")
        assert fabric is not None

        patterns = [
            {
                "product_code": "DEMO-RAP-AO-001",
                "pattern_code": "DEMO-RAP-AO-001",
                "name": "DEMO - Áo thun cổ tròn",
                "title": "DEMO-RAP-AO-001 · Áo thun cổ tròn",
                "content": "Form regular, minh họa rập thân áo và tay áo. Dữ liệu chỉ dùng để demo.",
                "kind": "shirt",
                "accent": (95, 159, 178),
                "layers": "12x4=48",
                "size_expression": "S / M / L",
                "ratio_expression": "1 / 1 / 1",
                "workshop": "DEMO-NM-ANPHU",
                "cutter": "DEMO-CAT-HOA",
                "unit_price": 18000,
                "days_ago": 2,
            },
            {
                "product_code": "DEMO-RAP-QJ-001",
                "pattern_code": "DEMO-RAP-QJ-001",
                "name": "DEMO - Quần jogger",
                "title": "DEMO-RAP-QJ-001 · Quần jogger",
                "content": "Rập quần jogger, có bo gấu và cạp chun. Dữ liệu chỉ dùng để demo.",
                "kind": "pants",
                "accent": (172, 126, 105),
                "layers": "10x6=60",
                "size_expression": "M / L / XL",
                "ratio_expression": "1 / 1 / 1",
                "workshop": "DEMO-NM-BINHMINH",
                "cutter": "DEMO-CAT-MINH",
                "unit_price": 22000,
                "days_ago": 1,
            },
            {
                "product_code": "DEMO-RAP-AK-001",
                "pattern_code": "DEMO-RAP-AK-001",
                "name": "DEMO - Áo khoác thể thao",
                "title": "DEMO-RAP-AK-001 · Áo khoác thể thao",
                "content": "Rập áo khoác thể thao có đường khóa giữa thân. Dữ liệu chỉ dùng để demo.",
                "kind": "jacket",
                "accent": (123, 155, 113),
                "layers": "8x8=64",
                "size_expression": "M / L / XL",
                "ratio_expression": "2 / 3 / 3",
                "workshop": "DEMO-NM-ANPHU",
                "cutter": "DEMO-CAT-TAM",
                "unit_price": 26000,
                "days_ago": 0,
            },
        ]

        products: dict[str, Product] = {}
        media_by_code: dict[str, MediaObject] = {}
        for spec in patterns:
            product = db.scalar(select(Product).where(Product.product_code == spec["product_code"]))
            if not product:
                product = Product(
                    product_code=spec["product_code"],
                    pattern_code=spec["pattern_code"],
                    name=spec["name"],
                    category="DEMO QL Rập",
                    status="ACTIVE",
                    notes="Dữ liệu demo; có thể xóa riêng sau buổi trình diễn.",
                )
                db.add(product)
                db.flush()
                add_audit(db, user, "PRODUCTION", "CREATE", "PRODUCT", product.id,
                          after={"product_code": product.product_code, "pattern_code": product.pattern_code})
                db.commit()
                db.refresh(product)
                print(f"Mã rập: {product.pattern_code} · {product.name}")
            elif product.pattern_code != spec["pattern_code"]:
                raise RuntimeError(f"Mã demo bị trùng dữ liệu khác: {spec['product_code']}")
            products[spec["product_code"]] = product

            media = ensure_media(db, code=spec["product_code"], title=spec["title"],
                                 kind=spec["kind"], accent=spec["accent"], user=user)
            media_by_code[spec["product_code"]] = media

            token = f"DEMO-PATTERN-NOTE-{spec['product_code']}"
            note = db.scalar(select(PatternNote).where(PatternNote.client_token == token))
            if not note:
                create_pattern_note(db, title=spec["title"], content=spec["content"],
                                    media_ids=[media.id], client_token=token, user=user)
                print(f"Ghi chú rập kèm ảnh: {spec['title']}")

        size_plans = {
            "DEMO-RAP-AO-001": [("S", 1, 16), ("M", 1, 16), ("L", 1, 16)],
            "DEMO-RAP-QJ-001": [("M", 1, 20), ("L", 1, 20), ("XL", 1, 20)],
            "DEMO-RAP-AK-001": [("M", 2, 16), ("L", 3, 24), ("XL", 3, 24)],
        }
        today = date.today()
        for index, spec in enumerate(patterns, start=1):
            key = f"DEMO-PRODUCTION-BATCH-{index:02d}"
            if db.scalar(select(ProductionBatch.id).where(ProductionBatch.idempotency_key == key)):
                continue
            plans = [
                {
                    "size": size,
                    "layers": layers,
                    "ratio": quantity // layers,
                    "planned_quantity": quantity,
                    "planned_warehouse_id": warehouse.id,
                }
                for size, layers, quantity in size_plans[spec["pattern_code"]]
            ]
            create_batch(
                db,
                data={
                    "mode": "HOUSE",
                    "workshop_id": workshops[spec["workshop"]].id,
                    "cutting_team_id": cutters[spec["cutter"]].id,
                    "pattern_code": spec["pattern_code"],
                    "product_id": products[spec["product_code"]].id,
                    "product_name": spec["name"],
                    "cut_date": today - timedelta(days=spec["days_ago"]),
                    "size_expression": spec["size_expression"],
                    "ratio_expression": spec["ratio_expression"],
                    "layer_expression": spec["layers"],
                    "expected_delivery_date": today + timedelta(days=3),
                    "workshop_unit_price_amount": spec["unit_price"],
                    "planned_warehouse_id": warehouse.id,
                    "fabric_type_id": fabric.id,
                    "media_ids": [media_by_code[spec["product_code"]].id],
                    "size_plans": plans,
                    "notes": "Mâm minh họa quy trình; không phát sinh nhập kho hay thanh toán.",
                },
                user=user,
                idempotency_key=key,
            )
            print(f"Mâm demo: {key} · {spec['pattern_code']} · {spec['layers']}")

        demo_batches = {
            batch.idempotency_key: batch
            for batch in db.scalars(select(ProductionBatch).where(
                ProductionBatch.idempotency_key.in_([
                    "DEMO-PRODUCTION-BATCH-01",
                    "DEMO-PRODUCTION-BATCH-02",
                    "DEMO-PRODUCTION-BATCH-03",
                ])
            ))
        }

        # Receipts establish earned workshop amounts, without importing any
        # finished goods into inventory.
        for batch_key, receive_quantity in (
            ("DEMO-PRODUCTION-BATCH-01", None),
            ("DEMO-PRODUCTION-BATCH-02", Decimal(30)),
        ):
            batch = demo_batches[batch_key]
            receipt_key = f"{batch_key}:DEMO-RECEIPT"
            if db.scalar(select(ProductionBatch.id).where(
                ProductionBatch.id == batch.id,
                ProductionBatch.delivered_quantity > 0,
            )):
                continue
            plans = list(db.scalars(select(ProductionBatchSizePlan).where(
                ProductionBatchSizePlan.batch_id == batch.id,
            ).order_by(ProductionBatchSizePlan.size)))
            lines = []
            remaining_to_receive = receive_quantity
            for plan in plans:
                if receive_quantity is None:
                    quantity = plan.planned_quantity
                else:
                    quantity = min(plan.planned_quantity, remaining_to_receive)
                if quantity <= 0:
                    continue
                lines.append({
                    "batch_size_plan_id": plan.id,
                    "received_now": quantity,
                    "import_to_stock": False,
                })
                if remaining_to_receive is not None:
                    remaining_to_receive -= quantity
            if remaining_to_receive is not None and remaining_to_receive > 0:
                raise RuntimeError(f"Số lượng nhận demo vượt kế hoạch size của {batch.batch_no}.")
            create_receipt(
                db,
                batch.id,
                receipt_date=today,
                warehouse_id=batch.planned_warehouse_id,
                color_id=None,
                lines=lines,
                notes="DEMO - phiếu nhận minh họa, không nhập tồn kho.",
                idempotency_key=receipt_key,
                user=user,
            )
            print(f"Phiếu nhận demo: {batch.batch_no} · {receive_quantity or batch.planned_quantity} sản phẩm")

        workshop_settlements = {}
        for settlement_key, batch_key in (
            ("DEMO-WORKSHOP-SETTLEMENT-ANPHU", "DEMO-PRODUCTION-BATCH-01"),
            ("DEMO-WORKSHOP-SETTLEMENT-BINHMINH", "DEMO-PRODUCTION-BATCH-02"),
        ):
            batch = demo_batches[batch_key]
            workshop_settlements[settlement_key] = create_settlement(
                db,
                workshop_id=batch.workshop_id,
                batch_ids=[batch.id],
                supplemental_ids=[],
                settlement_date=today,
                notes="DEMO - bảng kê tiền gia công.",
                idempotency_key=settlement_key,
                user=user,
            )

        partial_workshop_settlement = workshop_settlements["DEMO-WORKSHOP-SETTLEMENT-BINHMINH"]
        if partial_workshop_settlement["balance_amount"] > 0:
            payment_amount = min(200_000, partial_workshop_settlement["balance_amount"])
            create_party_payment(
                db,
                party_type="WORKSHOP",
                party_id=demo_batches["DEMO-PRODUCTION-BATCH-02"].workshop_id,
                amount=payment_amount,
                method="BANK_TRANSFER",
                allocations=[{
                    "target_id": partial_workshop_settlement["id"],
                    "allocated_amount": payment_amount,
                }],
                note="DEMO - thanh toán một phần bảng kê nhà may.",
                idempotency_key="DEMO-WORKSHOP-PAYMENT-BINHMINH",
                user=user,
                paid_at=datetime.now(timezone.utc),
            )

        month = today.strftime("%Y-%m")
        for index, spec in enumerate(patterns, start=1):
            batch = demo_batches[f"DEMO-PRODUCTION-BATCH-{index:02d}"]
            existing_report = db.scalar(select(CuttingReport).where(CuttingReport.batch_id == batch.id))
            if existing_report:
                continue
            quantity = batch.delivered_quantity if batch.delivered_quantity > 0 else batch.planned_quantity
            create_cutting_report(
                db,
                batch_id=batch.id,
                quantity=quantity,
                unit_price_amount=cutters[spec["cutter"]].default_unit_price_amount,
                report_date=batch.cut_date,
                color=None,
                layers=quantity,
                notes="DEMO - chốt công cắt minh họa.",
                idempotency_key=f"DEMO-CUTTING-REPORT-{index:02d}",
                user=user,
            )

        demo_report = next(
            (
                report for report in cutting_reports(db, month)
                if report["batch_no"] == demo_batches["DEMO-PRODUCTION-BATCH-01"].batch_no
            ),
            None,
        )
        if demo_report is None:
            raise RuntimeError("Không tìm thấy báo cáo cắt demo sau khi chốt tháng.")
        create_party_payment(
            db,
            party_type="CUTTING_TEAM",
            party_id=demo_batches["DEMO-PRODUCTION-BATCH-01"].cutting_team_id,
            amount=8_000,
            method="CASH",
            allocations=[{"target_id": demo_report["id"], "allocated_amount": 8_000}],
            note="DEMO - thanh toán một phần tiền công cắt.",
            idempotency_key="DEMO-CUTTING-PAYMENT-HOA",
            user=user,
            paid_at=datetime.now(timezone.utc),
        )

        print(
            "Hoàn tất demo QL Rập: "
            f"{len(patterns)} mã rập, {len(workshops)} nhà may, {len(cutters)} tổ cắt, "
            f"{len(patterns)} mâm sản xuất và {len(patterns)} báo cáo công cắt. "
            "Các giao dịch tài chính chỉ gắn với dữ liệu DEMO; không nhập tồn kho."
        )
    finally:
        db.close()


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser()
    parser.add_argument("--confirm-local-demo", action="store_true")
    args = parser.parse_args()
    seed(confirm_local_demo=args.confirm_local_demo)
