"""Unit tests cho incremental migration (pure functions + SQLite closure test).

KHÔNG đụng Supabase OLD/NEW. Chỉ kiểm tra date-range, time-field detection logic,
RowFilter và anchor-dependency closure.
"""
from __future__ import annotations

from datetime import datetime

import pytest
from sqlalchemy import create_engine, text

from scripts.migration.legacy_to_current.incremental import RowFilter, compute_filter
from scripts.migration.legacy_to_current.timefields import in_range, parse_range


def test_parse_range_valid():
    start, end = parse_range("2026-10-16", "2026-10-17")
    assert start == datetime(2026, 10, 16, 0, 0, 0)
    assert end == datetime(2026, 10, 17, 0, 0, 0)


def test_parse_range_none():
    assert parse_range(None, None) is None


def test_parse_range_requires_both():
    with pytest.raises(ValueError):
        parse_range("2026-10-16", None)
    with pytest.raises(ValueError):
        parse_range(None, "2026-10-17")


def test_parse_range_from_must_precede_to():
    with pytest.raises(ValueError):
        parse_range("2026-10-17", "2026-10-16")


def test_in_range_bounds():
    start = datetime(2026, 10, 16, 0, 0, 0)
    end = datetime(2026, 10, 17, 0, 0, 0)
    assert in_range(datetime(2026, 10, 16, 0, 0, 0), start, end) is True
    assert in_range(datetime(2026, 10, 16, 23, 59, 59), start, end) is True
    assert in_range(datetime(2026, 10, 17, 0, 0, 0), start, end) is False  # exclusive
    assert in_range(datetime(2026, 10, 15, 23, 59, 59), start, end) is False
    assert in_range(None, start, end) is False


def _engine_with_tables():
    engine = create_engine("sqlite://")
    ddl = [
        'CREATE TABLE order_units (id INTEGER PRIMARY KEY, order_code TEXT, group_id INTEGER, created_at TEXT)',
        'CREATE TABLE order_groups (id INTEGER PRIMARY KEY, root_code TEXT, customer_id INTEGER)',
        'CREATE TABLE az_customers (id INTEGER PRIMARY KEY, customer_code TEXT, name TEXT)',
        'CREATE TABLE order_items (id INTEGER PRIMARY KEY, unit_id INTEGER, product_name TEXT)',
        'CREATE TABLE order_status_events (id INTEGER PRIMARY KEY, unit_id INTEGER, created_at TEXT)',
        'CREATE TABLE order_images (id INTEGER PRIMARY KEY, group_id INTEGER, storage_path TEXT)',
        'CREATE TABLE invoices (id INTEGER PRIMARY KEY, invoice_code TEXT, finalized_at TEXT)',
        'CREATE TABLE invoice_order_links (invoice_id INTEGER, unit_id INTEGER)',
        'CREATE TABLE invoice_lines (id INTEGER PRIMARY KEY, invoice_id INTEGER)',
        'CREATE TABLE invoice_payments (id INTEGER PRIMARY KEY, invoice_id INTEGER, paid_at TEXT)',
        'CREATE TABLE az_customer_opening_debts (customer_id INTEGER, legacy_code TEXT, opening_debt NUMERIC)',
        'CREATE TABLE az_debt_slips (id INTEGER PRIMARY KEY, customer_id INTEGER, created_at TEXT)',
        'CREATE TABLE return_slips (id INTEGER PRIMARY KEY, customer_id INTEGER)',
        'CREATE TABLE return_items (id INTEGER PRIMARY KEY, slip_id INTEGER)',
        'CREATE TABLE supply_entries (id INTEGER PRIMARY KEY, created_at TEXT)',
    ]
    with engine.begin() as conn:
        for stmt in ddl:
            conn.execute(text(stmt))
    return engine


def test_compute_filter_anchor_closure():
    engine = _engine_with_tables()
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO az_customers (id, customer_code, name) VALUES (10, 'KH1', 'A')"))
        conn.execute(text("INSERT INTO order_groups (id, root_code, customer_id) VALUES (100, 'G1', 10)"))
        # order 1 in range, order 2 out of range
        conn.execute(text("INSERT INTO order_units (id, order_code, group_id, created_at) VALUES (1, 'HD1', 100, '2026-10-16 10:00:00')"))
        conn.execute(text("INSERT INTO order_units (id, order_code, group_id, created_at) VALUES (2, 'HD2', 100, '2026-10-18 10:00:00')"))
        conn.execute(text("INSERT INTO order_items (id, unit_id) VALUES (11, 1), (12, 2)"))
        conn.execute(text("INSERT INTO order_status_events (id, unit_id, created_at) VALUES (21, 1, '2026-10-16 11:00:00'), (22, 2, '2026-10-18 11:00:00')"))
        conn.execute(text("INSERT INTO order_images (id, group_id, storage_path) VALUES (31, 100, 'p1')"))
        conn.execute(text("INSERT INTO invoices (id, invoice_code, finalized_at) VALUES (41, 'INV1', '2026-10-16 12:00:00')"))
        conn.execute(text("INSERT INTO invoice_order_links (invoice_id, unit_id) VALUES (41, 1)"))
        conn.execute(text("INSERT INTO invoice_lines (id, invoice_id) VALUES (51, 41)"))
        conn.execute(text("INSERT INTO invoice_payments (id, invoice_id, paid_at) VALUES (61, 41, '2026-10-16 12:30:00')"))
        conn.execute(text("INSERT INTO az_customer_opening_debts (customer_id, legacy_code, opening_debt) VALUES (10, 'KH1', 100)"))
        conn.execute(text("INSERT INTO az_debt_slips (id, customer_id, created_at) VALUES (81, 10, '2026-10-16 13:00:00')"))
        conn.execute(text("INSERT INTO return_slips (id, customer_id) VALUES (91, 10)"))
        conn.execute(text("INSERT INTO return_items (id, slip_id) VALUES (101, 91)"))
        conn.execute(text("INSERT INTO supply_entries (id, created_at) VALUES (111, '2026-10-16 14:00:00'), (112, '2026-10-20 14:00:00')"))

    start, end = parse_range("2026-10-16", "2026-10-17")
    time_cols = {
        "order_units": "created_at",
        "invoices": "finalized_at",
        "supply_entries": "created_at",
    }
    f = compute_filter(engine, start, end, time_cols)

    assert f.anchor_orders == 1
    assert f.by_id["order_units"] == {"1"}
    assert f.by_id["order_groups"] == {"100"}
    assert f.by_id["az_customers"] == {"10"}
    assert f.by_id["order_items"] == {"11"}
    assert f.by_id["order_status_events"] == {"21"}
    assert f.by_id["order_images"] == {"31"}
    assert f.by_id["invoices"] == {"41"}
    assert f.by_column["invoice_order_links"] == ("invoice_id", {"41"})
    assert f.by_id["invoice_lines"] == {"51"}
    assert f.by_id["invoice_payments"] == {"61"}
    assert f.by_column["az_customer_opening_debts"] == ("customer_id", {"10"})
    assert f.by_id["az_debt_slips"] == {"81"}
    assert f.by_id["return_slips"] == {"91"}
    assert f.by_id["return_items"] == {"101"}
    # supply_entries lọc theo thời gian riêng
    assert f.by_time["supply_entries"] == "created_at"


def test_row_filter_filter_rows():
    f = RowFilter(start=datetime(2026, 10, 16), end=datetime(2026, 10, 17), time_cols={})
    f.by_id["order_units"] = {"1"}
    f.by_column["invoice_order_links"] = ("invoice_id", {"41"})
    f.by_time["supply_entries"] = "created_at"

    rows = [
        {"id": 1, "order_code": "HD1"},
        {"id": 2, "order_code": "HD2"},
    ]
    assert [r["id"] for r in f.filter_rows("order_units", rows)] == [1]

    links = [{"invoice_id": 41}, {"invoice_id": 99}]
    assert [r["invoice_id"] for r in f.filter_rows("invoice_order_links", links)] == [41]

    entries = [
        {"id": 1, "created_at": "2026-10-16 10:00:00"},
        {"id": 2, "created_at": "2026-10-18 10:00:00"},
    ]
    assert [r["id"] for r in f.filter_rows("supply_entries", entries)] == [1]
