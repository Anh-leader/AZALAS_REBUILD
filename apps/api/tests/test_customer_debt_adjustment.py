import uuid

from sqlalchemy import func, select

from app.models import Customer, DebtLedgerEntry


def _customer(db):
    return db.scalar(select(Customer).order_by(Customer.id))


def _debt(client, auth, customer_id):
    r = client.get(f"/api/v1/debt/customers/{customer_id}", headers=auth)
    assert r.status_code == 200, r.text
    return r.json()["data"]


def _adjust(client, auth, customer_id, items, *, key=None):
    return client.post(f"/api/v1/customers/{customer_id}/debt-adjustments",
                       headers={**auth, "Idempotency-Key": key or uuid.uuid4().hex},
                       json={"items": items})


def test_increase_raises_debt(client, owner, db):
    customer = _customer(db)
    before = _debt(client, owner, customer.id)["closing"]
    r = _adjust(client, owner, customer.id, [{"type": "INCREASE", "date": "2026-10-10", "amount": 100000, "note": "Khách lấy thêm hàng"}])
    assert r.status_code == 201, r.text
    data = r.json()["data"]
    assert data["closing"] == before + 100000


def test_decrease_lowers_debt(client, owner, db):
    customer = _customer(db)
    # Tạo sẵn nợ dương rồi trừ
    _adjust(client, owner, customer.id, [{"type": "INCREASE", "amount": 200000, "note": "seed"}])
    before = _debt(client, owner, customer.id)["closing"]
    r = _adjust(client, owner, customer.id, [{"type": "DECREASE", "amount": 50000, "note": "Khách CK"}])
    assert r.status_code == 201, r.text
    assert r.json()["data"]["closing"] == before - 50000


def test_multiple_items_net_correct(client, owner, db):
    customer = _customer(db)
    before = _debt(client, owner, customer.id)["closing"]
    r = _adjust(client, owner, customer.id, [
        {"type": "INCREASE", "amount": 150000, "note": "Mua thêm"},
        {"type": "DECREASE", "amount": 60000, "note": "Trả tiền"},
    ])
    assert r.status_code == 201, r.text
    assert r.json()["data"]["closing"] == before + 150000 - 60000


def test_zero_or_negative_amount_rejected(client, owner, db):
    customer = _customer(db)
    assert _adjust(client, owner, customer.id, [{"type": "INCREASE", "amount": 0}]).status_code == 422
    assert _adjust(client, owner, customer.id, [{"type": "INCREASE", "amount": -100}]).status_code == 422


def test_bad_type_rejected(client, owner, db):
    customer = _customer(db)
    r = _adjust(client, owner, customer.id, [{"type": "BOGUS", "amount": 1000}])
    assert r.status_code == 422


def test_unknown_customer_returns_404(client, owner):
    r = _adjust(client, owner, uuid.uuid4(), [{"type": "INCREASE", "amount": 1000}])
    assert r.status_code == 404


def test_staff_without_permission_gets_403(client, owner, db):
    customer = _customer(db)
    username = f"member_{uuid.uuid4().hex[:8]}"
    client.post("/api/v1/users", headers=owner, json={
        "username": username, "password": "safe-pass-123", "display_name": "Member",
        "phone": None, "role_codes": ["MEMBER"],
    })
    login = client.post("/api/v1/auth/login", json={"username": username, "password": "safe-pass-123"})
    auth = {"Authorization": f"Bearer {login.json()['data']['access_token']}"}
    assert _adjust(client, auth, customer.id, [{"type": "INCREASE", "amount": 1000}]).status_code == 403


def test_idempotency_does_not_double_apply(client, owner, db):
    customer = _customer(db)
    key = uuid.uuid4().hex
    first = _adjust(client, owner, customer.id, [{"type": "INCREASE", "amount": 100000, "note": "x"}], key=key)
    assert first.status_code == 201
    after_first = first.json()["data"]["closing"]
    second = _adjust(client, owner, customer.id, [{"type": "INCREASE", "amount": 100000, "note": "x"}], key=key)
    assert second.status_code == 201
    assert second.json()["data"]["closing"] == after_first


def test_ledger_gets_new_entries(client, owner, db):
    customer = _customer(db)
    before_count = db.scalar(select(func.count()).select_from(DebtLedgerEntry).where(
        DebtLedgerEntry.party_id == customer.id))
    _adjust(client, owner, customer.id, [
        {"type": "INCREASE", "amount": 10000, "note": "a"},
        {"type": "DECREASE", "amount": 3000, "note": "b"},
    ])
    db.expire_all()
    after_count = db.scalar(select(func.count()).select_from(DebtLedgerEntry).where(
        DebtLedgerEntry.party_id == customer.id))
    assert after_count == before_count + 2


def test_customer_detail_returns_new_debt(client, owner, db):
    customer = _customer(db)
    before = client.get(f"/api/v1/customers/{customer.id}", headers=owner).json()["data"]["debt_amount"]
    _adjust(client, owner, customer.id, [{"type": "INCREASE", "amount": 100000}])
    after = client.get(f"/api/v1/customers/{customer.id}", headers=owner).json()["data"]["debt_amount"]
    assert after == before + 100000


def test_customer_list_sort_reflects_new_debt(client, owner, db):
    _adjust(client, owner, _customer(db).id, [{"type": "INCREASE", "amount": 5_000_000}])
    r = client.get("/api/v1/customers", headers=owner, params={"sort": "debt_desc"})
    assert r.status_code == 200
    top = r.json()["data"][0]
    assert top["debt_amount"] >= 5_000_000
