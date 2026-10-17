"""Xác định trường thời gian (business timestamp) cho từng bảng legacy.

Legacy Supabase dùng ``TIMESTAMP WITHOUT TIME ZONE`` / ``TEXT``. Để incremental
migration theo khoảng ngày, ta cần biết mỗi bảng nên lọc theo cột thời gian nào.

Module này:
- ``detect_time_columns(engine)``: introspect ``information_schema`` của OLD, trả
  cột thời gian được phát hiện cho từng bảng + danh sách bảng KHÔNG có cột thời
  gian (chỉ được kéo theo dependency, không tự lọc).
- ``parse_range(from_date, to_date)``: parse ngày -> (start, end) naive datetime.
  Legacy timestamp được coi là wall-clock theo ``LEGACY_TZ`` (mặc định
  Asia/Ho_Chi_Minh), so sánh trực tiếp với bound naive cùng tz.
"""
from __future__ import annotations

import os
from datetime import date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.engine import Engine

LEGACY_TZ_NAME = os.environ.get("LEGACY_TZ", "Asia/Ho_Chi_Minh")
LEGACY_TZ = ZoneInfo(LEGACY_TZ_NAME)

# Cột thời gian ưu tiên cho từng bảng legacy (anchor-driven). Bảng KHÔNG có trong
# dict này mặc định thử các cột chung, rồi được coi là "dependency-only".
TIME_COLUMN_CANDIDATES: dict[str, list[str]] = {
    "az_customers": ["created_at", "updated_at", "created_on", "created_date"],
    "order_groups": ["created_at", "created_on", "created_date", "delivery_date"],
    "order_units": ["created_at", "created_on", "created_date"],
    "order_status_events": ["created_at", "occurred_at", "created_on"],
    "invoices": ["finalized_at", "created_at", "draft_updated_at", "issued_at"],
    "invoice_payments": ["created_at", "paid_at", "created_on"],
    "invoice_lines": ["created_at"],
    "invoice_order_links": ["created_at"],
    "az_debt_slips": ["created_at", "created_on"],
    "az_customer_opening_debts": ["created_at"],
    "return_slips": ["created_at", "created_on"],
    "order_images": ["created_at", "created_on", "uploaded_at"],
    "pattern_jobs": ["created_at", "created_on"],
    "pattern_job_images": ["created_at", "created_on", "uploaded_at"],
    "supply_entries": ["created_at", "created_on"],
    "supply_payments": ["created_at", "paid_at", "created_on"],
    "supply_partners": ["created_at", "created_on"],
}

# Bảng phụ thuộc (KHÔNG tự lọc thời gian; chỉ kéo theo anchor):
DEPENDENCY_ONLY_TABLES: set[str] = {
    "order_items", "return_items", "az_debt_slip_items", "az_invoice_return_lines",
    "az_profiles", "az_staff", "az_warehouses", "pattern_catalog", "cutters",
    "sewing_houses", "pattern_fabrics", "sewing_rates", "hr_rate_history",
}


def parse_range(from_date: str | None, to_date: str | None) -> tuple[datetime, datetime] | None:
    """Parse --from-date/--to-date thành (start, end) naive datetime.

    Không có từ ngày -> None (chạy full). Chỉ có 1 trong 2 -> lỗi rõ.
    end là "đến trước" (exclusive): 2026-10-17 00:00:00.
    """
    if not from_date and not to_date:
        return None
    if not from_date or not to_date:
        raise ValueError("--from-date và --to-date phải đi cùng nhau.")
    start = date.fromisoformat(from_date)
    end = date.fromisoformat(to_date)
    if start >= end:
        raise ValueError("--from-date phải nhỏ hơn --to-date.")
    # Legacy timestamp là naive (wall-clock LEGACY_TZ); bound cũng naive.
    return (
        datetime(start.year, start.month, start.day, 0, 0, 0),
        datetime(end.year, end.month, end.day, 0, 0, 0),
    )


def list_tables(engine: Engine) -> list[str]:
    """Liệt kê các bảng public của OLD (để detect cột thời gian)."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = 'public' AND table_type = 'BASE TABLE' "
                "ORDER BY table_name"
            )
        ).fetchall()
    return [r[0] for r in rows]


def _table_columns(engine: Engine, table: str) -> set[str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema = 'public' AND table_name = :t"
            ),
            {"t": table},
        ).fetchall()
    return {r[0] for r in rows}


def detect_time_columns(engine: Engine, tables: list[str]) -> tuple[dict[str, str], dict[str, list[str]]]:
    """Trả (detected: table->column, missing: table->danh sách candidate đã thử)."""
    detected: dict[str, str] = {}
    missing: dict[str, list[str]] = {}
    for table in tables:
        if table in DEPENDENCY_ONLY_TABLES:
            continue
        cols = _table_columns(engine, table)
        candidates = TIME_COLUMN_CANDIDATES.get(table) or [
            "created_at", "created_on", "created_date", "updated_at",
            "occurred_at", "finalized_at", "paid_at", "issued_at",
        ]
        found = next((c for c in candidates if c in cols), None)
        if found:
            detected[table] = found
        else:
            missing[table] = candidates
    return detected, missing


def in_range(ts, start: datetime, end: datetime) -> bool:
    """So sánh legacy timestamp với bound [start, end) theo wall-clock LEGACY_TZ.

    Legacy timestamp thực tế là ``timestamptz`` (tz-aware UTC). Để so đúng với
    ``--from-date``/``--to-date`` (ngày theo Asia/Ho_Chi_Minh), ta chuyển
    timestamp về wall-clock +07 rồi so với bound naive +07. Nếu timestamp naive
    (hiếm, bảng TEXT) thì coi như đã là wall-clock +07.
    """
    if ts is None:
        return False
    if isinstance(ts, str):
        try:
            ts = datetime.fromisoformat(ts)
        except ValueError:
            return False
    if ts.tzinfo is None:
        local = ts
    else:
        local = ts.astimezone(LEGACY_TZ).replace(tzinfo=None)
    return start <= local < end
