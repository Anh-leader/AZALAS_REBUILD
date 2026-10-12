import uuid
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from app.core.errors import ApiError
from app.models import (
    Color, Customer, FabricType, MediaObject, ProductionBatch, ProductionBatchMedia,
    ProductionBatchSizePlan, Warehouse,
)
from app.services.production import parse_quantity_expression

JPEG = b"\xff\xd8\xff" + b"\x00" * 64


def _upload(client, owner, name="rap.jpg"):
    r = client.post("/api/v1/media/upload", headers=owner, files={"file": (name, JPEG, "image/jpeg")})
    assert r.status_code == 201, r.text
    return r.json()["data"]["id"]


def _masters(client, owner):
    workshop = client.post("/api/v1/workshops", headers=owner, json={
        "workshop_code": f"NM-{uuid.uuid4().hex[:6]}", "name": f"Nhà may {uuid.uuid4().hex[:6]}",
        "phone": None, "address": None, "notes": None}).json()["data"]
    team = client.post("/api/v1/cutting-teams", headers=owner, json={
        "team_code": f"CAT-{uuid.uuid4().hex[:6]}", "name": f"Thợ cắt {uuid.uuid4().hex[:6]}",
        "phone": None, "default_unit_price_amount": 0, "notes": None}).json()["data"]
    fabric = client.post("/api/v1/fabric-types", headers=owner, json={
        "code": None, "name": f"Vải {uuid.uuid4().hex[:6]}", "notes": None}).json()["data"]
    return workshop, team, fabric


def test_master_data_has_categories(client, owner):
    r = client.get("/api/v1/production/master-data", headers=owner)
    assert r.status_code == 200
    data = r.json()["data"]
    assert isinstance(data["workshops"], list)
    assert isinstance(data["cutting_teams"], list)
    assert isinstance(data["fabrics"], list)
    assert isinstance(data["warehouses"], list)
    assert isinstance(data["patterns"], list)
    assert isinstance(data["colors"], list)


def test_create_workshop(client, owner):
    name = f"Nhà may {uuid.uuid4().hex[:6]}"
    r = client.post("/api/v1/workshops", headers=owner, json={"workshop_code": f"NM-{uuid.uuid4().hex[:6]}", "name": name})
    assert r.status_code == 201
    assert r.json()["data"]["name"] == name


def test_create_cutting_team(client, owner):
    name = f"Thợ cắt {uuid.uuid4().hex[:6]}"
    r = client.post("/api/v1/cutting-teams", headers=owner, json={"team_code": f"CAT-{uuid.uuid4().hex[:6]}", "name": name, "default_unit_price_amount": 0})
    assert r.status_code == 201
    assert r.json()["data"]["name"] == name


def test_create_fabric_type(client, owner):
    name = f"Vải {uuid.uuid4().hex[:6]}"
    r = client.post("/api/v1/fabric-types", headers=owner, json={"name": name})
    assert r.status_code == 201
    assert r.json()["data"]["name"] == name
    dup = client.post("/api/v1/fabric-types", headers=owner, json={"name": name})
    assert dup.status_code == 409


def test_quantity_parse_and_mismatch(client):
    assert parse_quantity_expression("100x7=700") == Decimal(700)
    assert parse_quantity_expression("100 x 7 = 700") == Decimal(700)
    assert parse_quantity_expression("700") == Decimal(700)
    assert parse_quantity_expression("x=700") == Decimal(700)
    assert parse_quantity_expression("10+20+30") == Decimal(60)
    with pytest.raises(ApiError):
        parse_quantity_expression("100x7=600")


def _make_batch(client, owner, db, *, layer="20x5=100", price=12000, with_media=True,
                size_plans_override=None, media_ids_override=None, mode="HOUSE",
                customer=None, delivery="2026-10-20"):
    workshop, team, fabric = _masters(client, owner)
    warehouse = db.scalar(select(Warehouse).where(Warehouse.code == "TAN_XUAN"))
    media_ids = media_ids_override if media_ids_override is not None else ([_upload(client, owner)] if with_media else [])
    size_plans = size_plans_override if size_plans_override is not None else [
        {"color": "CAM", "size": "M", "layers": 20, "ratio": 1, "planned_quantity": 50,
         "planned_warehouse_id": str(warehouse.id)},
        {"color": "CAM", "size": "L", "layers": 20, "ratio": 1, "planned_quantity": 50,
         "planned_warehouse_id": str(warehouse.id)},
    ]
    body = {
        "mode": mode, "cut_date": "2026-10-09", "workshop_id": workshop["id"], "cutting_team_id": team["id"],
        "pattern_code": "RAP-DEMO-01", "product_id": None, "product_name": "Quần demo",
        "size_expression": "M-L", "ratio_expression": "1:1", "layer_expression": layer,
        "expected_delivery_date": delivery if mode == "CUSTOMER_ORDER" else None,
        "customer_id": str(customer.id) if customer else None,
        "workshop_unit_price_amount": price, "planned_warehouse_id": str(warehouse.id),
        "fabric_type_id": fabric["id"], "notes": "Mâm test", "media_ids": media_ids,
        "size_plans": size_plans,
    }
    return client.post("/api/v1/production/batches", headers={**owner, "Idempotency-Key": uuid.uuid4().hex}, json=body)


def test_create_house_batch_success(client, owner, db):
    r = _make_batch(client, owner, db)
    assert r.status_code == 201, r.text
    data = r.json()["data"]
    assert data["batch_type"] == "HOUSE"
    assert data["planned_quantity"] == 100
    assert data["workshop_amount"] == 100 * 12000
    assert len(data["size_plans"]) == 2
    assert len(data["images"]) == 1
    color = db.scalar(select(Color).where(Color.canonical_name == "CAM"))
    assert color is not None
    plans = db.scalars(select(ProductionBatchSizePlan).where(ProductionBatchSizePlan.batch_id == uuid.UUID(data["id"]))).all()
    assert len(plans) == 2
    assert all(p.color_id == color.id for p in plans)
    assert db.scalar(select(func.count()).select_from(ProductionBatchMedia).where(
        ProductionBatchMedia.batch_id == uuid.UUID(data["id"]))) == 1


def test_house_batch_missing_image_rejected(client, owner, db):
    r = _make_batch(client, owner, db, with_media=False)
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "BATCH_MEDIA_REQUIRED"


def test_house_batch_missing_unit_price_rejected(client, owner, db):
    r = _make_batch(client, owner, db, price=0)
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "UNIT_PRICE_REQUIRED"


def test_customer_batch_success(client, owner, db):
    customer = db.scalar(select(Customer).order_by(Customer.id))
    r = _make_batch(client, owner, db, mode="CUSTOMER_ORDER", customer=customer)
    assert r.status_code == 201, r.text
    data = r.json()["data"]
    assert data["batch_type"] == "CUSTOMER_ORDER"
    assert data["customer_id"] == str(customer.id)
    assert data["synced_order_id"] is not None


def test_customer_batch_missing_delivery_rejected(client, owner, db):
    customer = db.scalar(select(Customer).order_by(Customer.id))
    r = _make_batch(client, owner, db, mode="CUSTOMER_ORDER", customer=customer, delivery=None)
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "CUSTOMER_BATCH_FIELDS_REQUIRED"


def test_double_submit_same_idempotency_key(client, owner, db):
    workshop, team, fabric = _masters(client, owner)
    warehouse = db.scalar(select(Warehouse).where(Warehouse.code == "TAN_XUAN"))
    media = _upload(client, owner)
    key = uuid.uuid4().hex
    body = {
        "mode": "HOUSE", "cut_date": "2026-10-09", "workshop_id": workshop["id"], "cutting_team_id": team["id"],
        "pattern_code": "RAP-DEMO-01", "product_id": None, "product_name": "Quần demo", "layer_expression": "10",
        "expected_delivery_date": None, "customer_id": None, "workshop_unit_price_amount": 1000,
        "planned_warehouse_id": str(warehouse.id), "fabric_type_id": fabric["id"], "notes": None,
        "media_ids": [media], "size_plans": [{"color": "ĐEN", "size": "M", "layers": 10, "ratio": 1, "planned_quantity": 10}],
    }
    first = client.post("/api/v1/production/batches", headers={**owner, "Idempotency-Key": key}, json=body)
    second = client.post("/api/v1/production/batches", headers={**owner, "Idempotency-Key": key}, json=body)
    assert first.status_code == 201 and second.status_code == 201
    assert first.json()["data"]["id"] == second.json()["data"]["id"]
    assert db.scalar(select(func.count()).select_from(ProductionBatch)) == 1


def test_role_without_permission_403(client, owner):
    username = f"member_{uuid.uuid4().hex[:8]}"
    client.post("/api/v1/users", headers=owner, json={
        "username": username, "password": "safe-pass-123", "display_name": "Member", "phone": None, "role_codes": ["MEMBER"]})
    login = client.post("/api/v1/auth/login", json={"username": username, "password": "safe-pass-123"})
    auth = {"Authorization": f"Bearer {login.json()['data']['access_token']}"}
    r = client.post("/api/v1/production/batches", headers={**auth, "Idempotency-Key": uuid.uuid4().hex}, json={})
    assert r.status_code == 403


def test_rollback_leaves_no_orphan_size_plans(client, owner, db):
    workshop, team, fabric = _masters(client, owner)
    warehouse = db.scalar(select(Warehouse).where(Warehouse.code == "TAN_XUAN"))
    media = _upload(client, owner)
    before = db.scalar(select(func.count()).select_from(ProductionBatch)) or 0
    body = {
        "mode": "HOUSE", "cut_date": "2026-10-09", "workshop_id": workshop["id"], "cutting_team_id": team["id"],
        "pattern_code": "RAP-DEMO-01", "product_id": None, "product_name": "Quần demo", "layer_expression": "10",
        "expected_delivery_date": None, "customer_id": None, "workshop_unit_price_amount": 1000,
        "planned_warehouse_id": str(warehouse.id), "fabric_type_id": fabric["id"], "notes": None,
        "media_ids": [media], "size_plans": [{"color": "   ", "size": "M", "layers": 10, "ratio": 1, "planned_quantity": 10}],
    }
    r = client.post("/api/v1/production/batches", headers={**owner, "Idempotency-Key": uuid.uuid4().hex}, json=body)
    assert r.status_code == 422
    assert db.scalar(select(func.count()).select_from(ProductionBatch)) == before
    assert db.scalar(select(func.count()).select_from(ProductionBatchSizePlan)) == 0
