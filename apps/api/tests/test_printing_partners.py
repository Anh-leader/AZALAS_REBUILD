import uuid

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.core.db import SessionLocal
from app.main import app
from app.models import (DebtLedgerEntry, MediaObject, NhatInMonthTransaction,
                        Partner, PartnerSettlement)
from app.services import printing_partners


def _settle(client, owner, partner="tung", month="2026-10", amount=5000000, media_id=None):
    return client.post(
        f"/api/v1/materials/printing/{partner}/monthly-settlements",
        headers={**owner, "Idempotency-Key": uuid.uuid4().hex},
        json={"period_month": month, "amount": amount, "media_id": media_id},
    )


def _upload_pdf(client, owner, partner="tung"):
    response = client.post(
        f"/api/v1/media/upload/printing/{partner}",
        headers=owner,
        files={"file": ("reconciliation.pdf", b"%PDF-1.4 test", "application/pdf")},
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]["id"]


def _money(client, owner, action, *, partner="tung", month="2026-10", amount=1000000):
    return client.post(
        f"/api/v1/materials/printing/{partner}/{action}",
        headers={**owner, "Idempotency-Key": uuid.uuid4().hex},
        json={"month": month, "amount": amount, "date": "2026-10-12", "note": "test"},
    )


def test_tung_settlement_and_pdf_are_partner_scoped(client, owner, db):
    media_id = _upload_pdf(client, owner)
    response = _settle(client, owner, media_id=media_id)
    assert response.status_code == 201, response.text
    data = response.json()["data"]
    partner = db.scalar(select(Partner).where(Partner.partner_code == "TUNG_IN"))
    settlement = db.get(PartnerSettlement, uuid.UUID(data["id"]))
    media = db.get(MediaObject, uuid.UUID(media_id))
    assert partner.name == "TÙNG - IN"
    assert settlement.partner_id == partner.id
    assert settlement.settlement_type == "TUNG_IN"
    assert settlement.media_id == media.id
    assert media.object_key.startswith("partners/")
    assert "/TUNG_IN/" in media.object_key
    assert media.object_key.endswith(".pdf")
    assert db.scalar(select(Partner).where(Partner.partner_code == "NHAT_IN")) is None


def test_tung_debt_advance_payment_and_details_are_isolated(client, owner):
    assert _settle(client, owner).status_code == 201
    assert _money(client, owner, "advances").status_code == 201
    assert _money(client, owner, "payments", amount=2000000).status_code == 201

    summary = client.get(
        "/api/v1/materials/printing/tung/debt-summary", headers=owner
    ).json()["data"]
    month = next(row for row in summary["months"] if row["month"] == "2026-10")
    assert month["buy"] == 5000000
    assert month["advance"] == 1000000
    assert month["paid"] == 2000000
    assert month["remaining"] == 2000000

    payments = client.get(
        "/api/v1/materials/printing/tung/monthly/2026-10/payments", headers=owner
    ).json()["data"]
    assert {row["transaction_type"] for row in payments} == {"ADVANCE", "PAYMENT"}
    assert all(row["created_by_name"] == "Trang Hà" for row in payments)
    ledger = client.get("/api/v1/materials/printing/tung/ledger", headers=owner).json()["data"]
    assert len(ledger) == 3
    assert all(row["entry_type"].startswith("TUNG_IN_") for row in ledger)
    assert all(row["actor_name"] == "Trang Hà" for row in ledger)
    assert all(row["month"] == "2026-10" for row in ledger)

    nhat_summary = client.get(
        "/api/v1/materials/printing/nhat/debt-summary", headers=owner
    ).json()["data"]
    assert nhat_summary["months"] == []
    assert client.get(
        "/api/v1/materials/printing/nhat/ledger", headers=owner
    ).json()["data"] == []


def test_tung_multiple_settlements_and_payment_limit(client, owner):
    assert _settle(client, owner, amount=2000000).status_code == 201
    assert _settle(client, owner, amount=3000000).status_code == 201
    details = client.get(
        "/api/v1/materials/printing/tung/monthly/2026-10/settlements", headers=owner
    ).json()["data"]
    assert len(details) == 2
    assert all(row["created_by_name"] == "Trang Hà" for row in details)
    assert _money(client, owner, "payments", amount=5000001).status_code == 422


def test_tung_rejects_invalid_money_and_foreign_partner_pdf(client, owner):
    assert _settle(client, owner, amount=0).status_code == 422
    nhat_pdf = _upload_pdf(client, owner, partner="nhat")
    response = _settle(client, owner, media_id=nhat_pdf)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "MEDIA_PARTNER_INVALID"

    decimal_payment = client.post(
        "/api/v1/materials/printing/tung/advances",
        headers={**owner, "Idempotency-Key": uuid.uuid4().hex},
        json={"month": "2026-10", "amount": 1.5, "date": "2026-10-12"},
    )
    assert decimal_payment.status_code == 422


def test_tung_month_transactions_are_partner_keyed(client, owner, db):
    assert _settle(client, owner).status_code == 201
    assert _money(client, owner, "advances").status_code == 201
    row = db.scalar(select(NhatInMonthTransaction))
    tung = db.scalar(select(Partner).where(Partner.partner_code == "TUNG_IN"))
    assert row.partner_id == tung.id
    assert client.get(
        "/api/v1/materials/printing/nhat/monthly/2026-10/payments", headers=owner
    ).json()["data"] == []
    assert client.get(
        "/api/v1/materials/printing/nhat/debt-summary", headers=owner
    ).json()["data"]["months"] == []


def test_tung_write_requires_settlement_permission(client, owner):
    username = f"member_{uuid.uuid4().hex[:8]}"
    client.post("/api/v1/users", headers=owner, json={
        "username": username, "password": "safe-pass-123",
        "display_name": "Member", "phone": None, "role_codes": ["MEMBER"],
    })
    login = client.post("/api/v1/auth/login", json={
        "username": username, "password": "safe-pass-123",
    })
    auth = {"Authorization": f"Bearer {login.json()['data']['access_token']}"}
    response = client.post(
        "/api/v1/materials/printing/tung/monthly-settlements",
        headers={**auth, "Idempotency-Key": uuid.uuid4().hex},
        json={"period_month": "2026-10", "amount": 1},
    )
    assert response.status_code == 403


def test_tung_settlement_rolls_back_if_audit_fails(client, owner, monkeypatch):
    def fail_audit(*args, **kwargs):
        raise RuntimeError("audit unavailable")

    monkeypatch.setattr(printing_partners, "add_audit", fail_audit)
    failing_client = TestClient(app, raise_server_exceptions=False)
    response = _settle(failing_client, owner)
    assert response.status_code == 500
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(PartnerSettlement).where(
            PartnerSettlement.settlement_type == "TUNG_IN"
        )) == 0
        assert db.scalar(select(func.count()).select_from(DebtLedgerEntry).where(
            DebtLedgerEntry.entry_type.like("TUNG_IN_%")
        )) == 0
