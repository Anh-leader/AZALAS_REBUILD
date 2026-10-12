import uuid

from sqlalchemy import func, select

from app.models import DebtLedgerEntry, EmbroideryMonthTransaction, Partner, PartnerSettlement


def _settle(client, owner, month="2026-10", amount=5000000, note=None):
    return client.post("/api/v1/materials/embroidery/monthly-settlements",
                       headers={**owner, "Idempotency-Key": uuid.uuid4().hex},
                       json={"period_month": month, "amount": amount, "note": note})


def test_settle_month_success(client, owner, db):
    r = _settle(client, owner)
    assert r.status_code == 201, r.text
    data = r.json()["data"]
    assert data["period_month"] == "2026-10"
    assert data["total_amount"] == 5000000
    assert data["balance_amount"] == 5000000
    # Partner mặc định THÊU được tạo.
    partner = db.scalar(select(Partner).where(Partner.partner_code == "EMBROIDERY-DEFAULT"))
    assert partner is not None
    assert partner.name == "THÊU"
    # Ghi debt ledger cộng nợ.
    entries = db.scalars(select(DebtLedgerEntry).where(
        DebtLedgerEntry.party_id == partner.id, DebtLedgerEntry.entry_type == "EMBROIDERY_SETTLEMENT")).all()
    assert len(entries) == 1
    assert entries[0].amount_delta == 5000000


def test_settle_amount_must_be_positive(client, owner):
    r = _settle(client, owner, amount=0)
    assert r.status_code == 422


def test_settle_invalid_month(client, owner):
    r = _settle(client, owner, month="10/2026")
    assert r.status_code == 422


def test_settle_same_month_updates(client, owner, db):
    first = _settle(client, owner, amount=5000000)
    assert first.status_code == 201
    second = _settle(client, owner, amount=6000000)
    assert second.status_code == 201
    data = second.json()["data"]
    assert data["total_amount"] == 6000000
    # Chỉ có một settlement cho tháng.
    partner = db.scalar(select(Partner).where(Partner.partner_code == "EMBROIDERY-DEFAULT"))
    settlements = db.scalars(select(PartnerSettlement).where(
        PartnerSettlement.partner_id == partner.id, PartnerSettlement.settlement_type == "EMBROIDERY")).all()
    assert len(settlements) == 1
    assert settlements[0].total_amount == 6000000
    # Tổng nợ = 6.000.000 (đảo 5.000.000 cũ + ghi 6.000.000 mới).
    total = db.scalar(select(func.coalesce(func.sum(DebtLedgerEntry.amount_delta), 0)).where(
        DebtLedgerEntry.party_id == partner.id)) or 0
    assert total == 6000000


def test_settle_idempotency(client, owner, db):
    key = uuid.uuid4().hex
    body = {"period_month": "2026-10", "amount": 5000000, "note": None}
    first = client.post("/api/v1/materials/embroidery/monthly-settlements", headers={**owner, "Idempotency-Key": key}, json=body)
    second = client.post("/api/v1/materials/embroidery/monthly-settlements", headers={**owner, "Idempotency-Key": key}, json=body)
    assert first.status_code == 201 and second.status_code == 201
    assert first.json()["data"]["id"] == second.json()["data"]["id"]


def test_list_settlements(client, owner):
    _settle(client, owner, month="2026-10", amount=5000000)
    _settle(client, owner, month="2026-09", amount=3000000)
    r = client.get("/api/v1/materials/embroidery/monthly-settlements", headers=owner)
    assert r.status_code == 200
    data = r.json()["data"]
    assert len(data) == 2
    # Mới nhất (tháng 10) ở đầu.
    assert data[0]["period_month"] == "2026-10"


def test_monthly_settlements(client, owner):
    _settle(client, owner, month="2026-10", amount=5000000)
    r = client.get("/api/v1/materials/embroidery/monthly/2026-10/settlements", headers=owner)
    assert r.status_code == 200
    assert len(r.json()["data"]) == 1
    assert r.json()["data"][0]["total_amount"] == 5000000


def test_role_without_permission_403(client, owner):
    username = f"member_{uuid.uuid4().hex[:8]}"
    client.post("/api/v1/users", headers=owner, json={
        "username": username, "password": "safe-pass-123", "display_name": "Member", "phone": None, "role_codes": ["MEMBER"]})
    login = client.post("/api/v1/auth/login", json={"username": username, "password": "safe-pass-123"})
    auth = {"Authorization": f"Bearer {login.json()['data']['access_token']}"}
    assert client.post("/api/v1/materials/embroidery/monthly-settlements", headers={**auth, "Idempotency-Key": uuid.uuid4().hex},
                       json={"period_month": "2026-10", "amount": 1}).status_code == 403


def _advance(client, owner, month="2026-10", amount=1000000, day="2026-10-01", note="Ứng trước"):
    return client.post("/api/v1/materials/embroidery/advances", headers={**owner, "Idempotency-Key": uuid.uuid4().hex},
                       json={"month": month, "amount": amount, "date": day, "note": note})


def _payment(client, owner, month="2026-10", amount=1000000, day="2026-10-15", note="Trả"):
    return client.post("/api/v1/materials/embroidery/payments", headers={**owner, "Idempotency-Key": uuid.uuid4().hex},
                       json={"month": month, "amount": amount, "date": day, "note": note})


def test_debt_summary_after_settlement(client, owner):
    _settle(client, owner, month="2026-10", amount=5000000)
    r = client.get("/api/v1/materials/embroidery/debt-summary", headers=owner)
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["total_remaining"] == 5000000
    months = {m["month"]: m for m in data["months"]}
    assert months["2026-10"]["buy"] == 5000000
    assert months["2026-10"]["remaining"] == 5000000
    assert months["2026-10"]["group"] == "PENDING"


def test_advance_without_settlement_creates_prepaid(client, owner):
    r = _advance(client, owner, month="2026-06", amount=1000000)
    assert r.status_code == 201, r.text
    summary = client.get("/api/v1/materials/embroidery/debt-summary", headers=owner).json()["data"]
    assert summary["unallocated_advance"] == 1000000
    months = {m["month"]: m for m in summary["months"]}
    assert months["2026-06"]["group"] == "ADVANCE"
    assert months["2026-06"]["advance"] == 1000000


def test_advance_reduces_remaining(client, owner):
    _settle(client, owner, month="2026-10", amount=5000000)
    r = _advance(client, owner, month="2026-10", amount=1000000)
    assert r.status_code == 201
    summary = client.get("/api/v1/materials/embroidery/debt-summary", headers=owner).json()["data"]
    months = {m["month"]: m for m in summary["months"]}
    assert months["2026-10"]["advance"] == 1000000
    assert months["2026-10"]["remaining"] == 4000000


def test_payment_reduces_remaining(client, owner):
    _settle(client, owner, month="2026-10", amount=5000000)
    r = _payment(client, owner, month="2026-10", amount=2000000)
    assert r.status_code == 201, r.text
    summary = client.get("/api/v1/materials/embroidery/debt-summary", headers=owner).json()["data"]
    months = {m["month"]: m for m in summary["months"]}
    assert months["2026-10"]["paid"] == 2000000
    assert months["2026-10"]["remaining"] == 3000000


def test_payment_cannot_exceed_remaining(client, owner):
    _settle(client, owner, month="2026-10", amount=5000000)
    r = _payment(client, owner, month="2026-10", amount=9999999)
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "PAYMENT_EXCEEDS_REMAINING"


def test_payment_idempotency(client, owner, db):
    _settle(client, owner, month="2026-10", amount=5000000)
    key = uuid.uuid4().hex
    body = {"month": "2026-10", "amount": 1000000, "date": "2026-10-15", "note": None}
    first = client.post("/api/v1/materials/embroidery/payments", headers={**owner, "Idempotency-Key": key}, json=body)
    second = client.post("/api/v1/materials/embroidery/payments", headers={**owner, "Idempotency-Key": key}, json=body)
    assert first.status_code == 201 and second.status_code == 201
    assert first.json()["data"]["id"] == second.json()["data"]["id"]
    assert db.scalar(select(func.count()).select_from(EmbroideryMonthTransaction)) == 1


def test_monthly_payments(client, owner):
    _settle(client, owner, month="2026-10", amount=5000000)
    _advance(client, owner, month="2026-10", amount=1000000)
    _payment(client, owner, month="2026-10", amount=2000000)
    r = client.get("/api/v1/materials/embroidery/monthly/2026-10/payments", headers=owner)
    assert r.status_code == 200
    data = r.json()["data"]
    assert len(data) == 2
    types = {row["transaction_type"] for row in data}
    assert types == {"ADVANCE", "PAYMENT"}


def test_ledger_running_balance(client, owner):
    _settle(client, owner, month="2026-10", amount=5000000)
    _payment(client, owner, month="2026-10", amount=2000000)
    r = client.get("/api/v1/materials/embroidery/ledger", headers=owner)
    assert r.status_code == 200
    ledger = r.json()["data"]
    assert len(ledger) >= 2
    assert ledger[0]["balance"] == 3000000


def test_full_settle_moves_to_settled_group(client, owner):
    _settle(client, owner, month="2026-10", amount=5000000)
    _payment(client, owner, month="2026-10", amount=5000000)
    summary = client.get("/api/v1/materials/embroidery/debt-summary", headers=owner).json()["data"]
    months = {m["month"]: m for m in summary["months"]}
    assert months["2026-10"]["remaining"] == 0
    assert months["2026-10"]["group"] == "SETTLED"


def test_debt_summary_empty(client, owner):
    r = client.get("/api/v1/materials/embroidery/debt-summary", headers=owner)
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["total_remaining"] == 0
    assert data["months"] == []
