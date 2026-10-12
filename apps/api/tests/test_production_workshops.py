import uuid
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from app.core.errors import ApiError
from app.models import (
    AuditLog, BatchMaterialDelivery, Customer, InventoryBalance, InventoryTransaction,
    Order, ProductionBatch, ProductionReceipt, SupplementalWorkshopDelivery,
    Warehouse, WorkshopSettlement,
)
from app.services.production import parse_quantity_expression


def _masters(client, owner):
    workshop = client.post("/api/v1/workshops", headers=owner, json={
        "workshop_code": f"NM-{uuid.uuid4().hex[:6]}", "name": f"Nhà may {uuid.uuid4().hex[:6]}",
        "phone": None, "address": "Địa chỉ test", "notes": None,
    })
    assert workshop.status_code == 201, workshop.text
    team = client.post("/api/v1/cutting-teams", headers=owner, json={
        "team_code": f"CAT-{uuid.uuid4().hex[:6]}", "name": f"Thợ cắt {uuid.uuid4().hex[:6]}",
        "phone": None, "default_unit_price_amount": 500, "notes": None,
    })
    assert team.status_code == 201, team.text
    return workshop.json()["data"], team.json()["data"]


def _upload(client, owner, name="rap-demo.jpg"):
    r = client.post("/api/v1/media/upload", headers=owner, files={"file": (name, b"\xff\xd8\xff" + b"\x00" * 64, "image/jpeg")})
    assert r.status_code == 201, r.text
    return r.json()["data"]["id"]


def _batch(client, owner, db, *, mode="CUSTOMER_ORDER", layer_expression="10", price=1000, media=None):
    workshop, team = _masters(client, owner)
    customer = db.scalar(select(Customer).order_by(Customer.id))
    warehouse = db.scalar(select(Warehouse).where(Warehouse.code == "TAN_XUAN"))
    balance = db.scalar(select(InventoryBalance).where(InventoryBalance.warehouse_id == warehouse.id).order_by(InventoryBalance.id))
    media_id = media if media is not None else _upload(client, owner)
    body = {
        "mode": mode, "cut_date": "2026-10-09", "workshop_id": workshop["id"],
        "cutting_team_id": team["id"], "pattern_code": "RAP-DEMO-01", "product_id": str(balance.variant.product_id),
        "product_name": "Quần demo từ Rập", "size_expression": "M-L", "ratio_expression": "1:1",
        "layer_expression": layer_expression, "expected_delivery_date": "2026-10-20" if mode == "CUSTOMER_ORDER" else None,
        "customer_id": str(customer.id) if mode == "CUSTOMER_ORDER" else None,
        "workshop_unit_price_amount": price, "planned_warehouse_id": str(warehouse.id), "fabric_type_id": None,
        "notes": "Mâm test", "media_ids": [media_id],
        "size_plans": [{"color_id": str(balance.variant.color_id), "size": balance.variant.size,
          "layers": 10, "ratio": 1, "planned_quantity": 10, "product_variant_id": str(balance.variant_id),
          "planned_warehouse_id": str(warehouse.id), "notes": None}],
    }
    response = client.post("/api/v1/production/batches", headers={**owner, "Idempotency-Key": uuid.uuid4().hex}, json=body)
    assert response.status_code == 201, response.text
    return response.json()["data"], workshop, team, balance


def test_quantity_expression_parser():
    assert parse_quantity_expression("20x5=100") == Decimal(100)
    assert parse_quantity_expression("10+20+30") == Decimal(60)
    assert parse_quantity_expression("42") == Decimal(42)
    with pytest.raises(ApiError):
        parse_quantity_expression("20x5=99")


def test_customer_batch_creates_uuid_linked_sales_order(client, owner, db):
    data, _, _, _ = _batch(client, owner, db, layer_expression="20x5=100")
    db.expire_all()
    batch = db.get(ProductionBatch, uuid.UUID(data["id"]))
    order = db.get(Order, batch.synced_order_id)
    assert order is not None and order.source_channel == "RAP"
    assert order.production_batch_id == batch.id
    assert batch.customer_id == order.customer_id
    assert batch.planned_quantity == Decimal(100)


def test_production_receipt_updates_remaining_and_uses_stock_service(client, owner, db):
    batch, _, _, balance = _batch(client, owner, db)
    before = balance.on_hand
    plan = batch["size_plans"][0]
    response = client.post(f"/api/v1/production/batches/{batch['id']}/receipts",
        headers={**owner, "Idempotency-Key": uuid.uuid4().hex}, json={
            "receipt_date": "2026-10-10", "warehouse_id": batch["planned_warehouse_id"], "color_id": None,
            "notes": "Nhận đợt 1", "lines": [{"batch_size_plan_id": plan["id"],
              "product_variant_id": plan["product_variant_id"], "received_now": 4,
              "import_to_stock": True, "notes": None}],
        })
    assert response.status_code == 201, response.text
    db.expire_all()
    current = db.get(ProductionBatch, uuid.UUID(batch["id"]))
    assert current.delivered_quantity == Decimal(4) and current.remaining_quantity == Decimal(6)
    assert db.get(InventoryBalance, balance.id).on_hand == before + Decimal(4)
    tx = db.scalar(select(InventoryTransaction).where(
        InventoryTransaction.reference_type == "PRODUCTION_RECEIPT"))
    assert tx is not None and tx.quantity_delta == Decimal(4)


def test_workshop_settlement_server_total_and_overpayment_credit(client, owner, db):
    batch, workshop, _, _ = _batch(client, owner, db, price=1200)
    plan = batch["size_plans"][0]
    receipt = client.post(f"/api/v1/production/batches/{batch['id']}/receipts",
        headers={**owner, "Idempotency-Key": uuid.uuid4().hex}, json={
          "receipt_date": "2026-10-10", "warehouse_id": batch["planned_warehouse_id"], "color_id": None,
          "lines": [{"batch_size_plan_id": plan["id"], "product_variant_id": plan["product_variant_id"],
                     "received_now": 5, "import_to_stock": False}], "notes": None})
    assert receipt.status_code == 201
    settled = client.post("/api/v1/workshop-settlements", headers={**owner, "Idempotency-Key": uuid.uuid4().hex}, json={
        "workshop_id": workshop["id"], "batch_ids": [batch["id"]], "supplemental_ids": [],
        "settlement_date": "2026-10-11", "notes": "Bảng kê gốc",
    })
    assert settled.status_code == 201, settled.text
    statement = settled.json()["data"]
    assert statement["total_quantity"] == 5 and statement["total_amount"] == 6000
    payment = client.post("/api/v1/workshop-payments", headers={**owner, "Idempotency-Key": uuid.uuid4().hex}, json={
        "workshop_id": workshop["id"], "amount": 7000, "method": "BANK_TRANSFER",
        "allocations": [{"target_id": statement["id"], "allocated_amount": 6000}], "note": "Trả dư",
    })
    assert payment.status_code == 201, payment.text
    assert payment.json()["data"]["unallocated_amount"] == 1000
    debt = client.get(f"/api/v1/workshops/{workshop['id']}/debt-ledger", headers=owner).json()["data"]
    assert debt["closing"] == -1000


def test_supplemental_delivery_keeps_original_settlement_and_is_idempotent(client, owner, db):
    batch, workshop, _, _ = _batch(client, owner, db, price=1000)
    plan = batch["size_plans"][0]
    client.post(f"/api/v1/production/batches/{batch['id']}/receipts",
        headers={**owner, "Idempotency-Key": uuid.uuid4().hex}, json={"receipt_date": "2026-10-10",
          "warehouse_id": batch["planned_warehouse_id"], "color_id": None,
          "lines": [{"batch_size_plan_id": plan["id"], "product_variant_id": plan["product_variant_id"],
                     "received_now": 5, "import_to_stock": False}], "notes": None})
    original = client.post("/api/v1/workshop-settlements", headers={**owner, "Idempotency-Key": uuid.uuid4().hex}, json={
        "workshop_id": workshop["id"], "batch_ids": [batch["id"]], "supplemental_ids": [],
        "settlement_date": "2026-10-11", "notes": "Gốc"}).json()["data"]
    db.expire_all(); current = db.get(ProductionBatch, uuid.UUID(batch["id"])); key = uuid.uuid4().hex
    payload = {"batch_id": batch["id"], "delivery_date": "2026-10-12", "quantity": 2,
               "unit_price_amount": 1500, "notes": "Hàng vét", "expected_batch_version": current.version}
    first = client.post("/api/v1/supplemental-workshop-deliveries", headers={**owner, "Idempotency-Key": key}, json=payload)
    assert first.status_code == 201, first.text
    second = client.post("/api/v1/supplemental-workshop-deliveries", headers={**owner, "Idempotency-Key": key}, json=payload)
    assert second.status_code == 201
    db.expire_all()
    assert db.get(WorkshopSettlement, uuid.UUID(original["id"])).total_amount == 5000
    assert db.scalar(select(func.count()).select_from(SupplementalWorkshopDelivery)) == 1


def test_advance_payment_creates_unallocated_credit(client, owner, db):
    batch, workshop, _, _ = _batch(client, owner, db, price=1000)
    r = client.post("/api/v1/workshop-payments", headers={**owner, "Idempotency-Key": uuid.uuid4().hex}, json={
        "workshop_id": workshop["id"], "amount": 500000, "method": "CASH", "allocations": [],
        "note": "Ứng trước nhà may", "paid_at": "2026-10-11T12:00:00"})
    assert r.status_code == 201, r.text
    data = r.json()["data"]
    assert data["unallocated_amount"] == 500000
    debt = client.get(f"/api/v1/workshops/{workshop['id']}/debt-ledger", headers=owner).json()["data"]
    assert debt["closing"] == -500000
    assert debt["credit"] == 500000


def test_material_delivery_is_append_only_and_retry_safe(client, owner, db):
    batch, _, _, _ = _batch(client, owner, db, mode="HOUSE")
    key = uuid.uuid4().hex
    payload = {"delivery_date": "2026-10-10", "received_by": "Xưởng", "notes": "Đợt 1",
               "items": [{"name": "Dây kéo", "total_required": 10, "quantity": 4, "deliver_full": False}]}
    first = client.post(f"/api/v1/production/batches/{batch['id']}/material-deliveries",
                        headers={**owner, "Idempotency-Key": key}, json=payload)
    second = client.post(f"/api/v1/production/batches/{batch['id']}/material-deliveries",
                         headers={**owner, "Idempotency-Key": key}, json=payload)
    assert first.status_code == second.status_code == 201
    assert db.scalar(select(func.count()).select_from(BatchMaterialDelivery)) == 1
    over = client.post(f"/api/v1/production/batches/{batch['id']}/material-deliveries",
                       headers={**owner, "Idempotency-Key": uuid.uuid4().hex}, json={
                         **payload, "items": [{"name": "Dây kéo", "total_required": 10, "quantity": 7, "deliver_full": False}]})
    assert over.status_code == 409


def test_production_audit_has_actor_entity_and_request(client, owner, db):
    batch, _, _, _ = _batch(client, owner, db)
    row = db.scalar(select(AuditLog).where(AuditLog.entity_id == uuid.UUID(batch["id"])))
    assert row is not None and row.actor_user_id is not None and row.entity_type == "PRODUCTION_BATCH"
    assert row.request_id
