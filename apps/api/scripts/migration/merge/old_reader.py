"""Đọc dữ liệu Supabase OLD (raw SQL) sang các dict chuẩn hóa để build merge plan.

Dùng engine riêng (OLD_DATABASE_URL), KHÔNG đụng SessionLocal (target NEW).
Các cột được đọc linh hoạt bằng fallback để chịu schema OLD khác nhẹ.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import create_engine, text


def _col(row: Any, names: tuple[str, ...]) -> Any:
    for name in names:
        if name in row._mapping:
            return row._mapping[name]
    return None


def _str(value: Any) -> str | None:
    if value is None:
        return None
    return str(value).strip() or None


def read_old_customers(engine) -> dict[str, dict]:
    result: dict[str, dict] = {}
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT * FROM customers")).mappings()
        for row in rows:
            code = _str(_col(row, ("customer_code", "legacy_customer_code")))
            if not code:
                continue
            result[code] = {
                "name": _str(_col(row, ("name",))),
                "phone": _str(_col(row, ("phone",))),
                "address": _str(_col(row, ("address",))),
                "customer_group": _str(_col(row, ("customer_group",))),
                "carrier_name": _str(_col(row, ("carrier_name",))),
                "carrier_phone": _str(_col(row, ("carrier_phone",))),
                "updated_at": _str(_col(row, ("updated_at",))),
            }
    return result


def read_old_orders(engine) -> dict[str, dict]:
    result: dict[str, dict] = {}
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT * FROM orders")).mappings()
        for row in rows:
            no = _str(_col(row, ("order_no",)))
            if not no:
                continue
            result[no] = {
                "status": _str(_col(row, ("status",))),
                "billing_status": _str(_col(row, ("billing_status",))),
                "total_amount": int(_col(row, ("total_amount",)) or 0),
                "paid_amount": int(_col(row, ("paid_amount",)) or 0),
                "invoice_balance_amount": int(_col(row, ("invoice_balance_amount",)) or 0),
                "updated_at": _str(_col(row, ("updated_at",))),
            }
    return result


def read_old_debt_identity(engine) -> set[str]:
    identities: set[str] = set()
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT idempotency_key, reference_type, reference_id FROM debt_ledger_entries")).mappings()
        for row in rows:
            key = _str(_col(row, ("idempotency_key",)))
            if key:
                identities.add(key)
                continue
            ref = _str(_col(row, ("reference_type",)))
            ref_id = _str(_col(row, ("reference_id",)))
            if ref and ref_id:
                identities.add(f"{ref}:{ref_id}")
    return identities


def read_old_media_keys(engine) -> set[str]:
    keys: set[str] = set()
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT object_key, checksum, sha256 FROM media_objects")).mappings()
        for row in rows:
            for name in ("object_key", "checksum", "sha256"):
                value = _str(_col(row, (name,)))
                if value:
                    keys.add(f"{name}:{value}")
    return keys


def read_old_balances(engine) -> dict[str, int]:
    result: dict[str, int] = {}
    with engine.connect() as conn:
        rows = conn.execute(text(
            "SELECT c.customer_code AS code, "
            "COALESCE(SUM(e.amount_delta), 0) AS balance "
            "FROM customers c "
            "LEFT JOIN debt_ledger_entries e ON e.party_type='CUSTOMER' AND e.party_id = c.id "
            "GROUP BY c.customer_code"
        )).mappings()
        for row in rows:
            code = _str(_col(row, ("code",)))
            if code:
                result[code] = int(_col(row, ("balance",)) or 0)
    return result
