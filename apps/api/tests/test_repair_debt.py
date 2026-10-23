"""Unit tests cho repair_opening_debts (pure functions, không đụng Supabase).

Khoá hành vi: re-sync OPENING ledger entries theo OLD opening_debt, idempotent,
chỉ UPDATE khi lệch, INSERT khi thiếu, và NEW-native customer KHÔNG bị đụng.
"""
from __future__ import annotations

from scripts.migration.legacy_to_current.repair_debt import build_opening_plan, _money_int


def test_money_int_rounds_half_up():
    assert _money_int("613662.00") == 613662
    assert _money_int("11.05") == 11
    assert _money_int(None) == 0
    assert _money_int("-5999.00") == -5999


def test_build_opening_plan_updates_only_changed():
    old_opening = {"417": 613662, "430": 255989, "999": 1000}
    mapping = {"417": "u417", "430": "u430", "999": "u999"}
    current = {"u417": 469258, "u430": 255989, "u999": 1000}  # 417 stale, others ok
    plan = build_opening_plan(old_opening, mapping, current)
    assert plan["inserts"] == []
    assert plan["missing_mapping"] == []
    assert plan["updates"] == [{"party_id": "u417", "legacy_id": "417", "from": 469258, "to": 613662}]


def test_build_opening_plan_inserts_missing_nonzero():
    old_opening = {"417": 613662}
    mapping = {"417": "u417"}
    current = {}  # no OPENING entry yet
    plan = build_opening_plan(old_opening, mapping, current)
    assert plan["updates"] == []
    assert plan["inserts"] == [{"party_id": "u417", "legacy_id": "417", "amount_delta": 613662}]


def test_build_opening_plan_skips_zero_when_missing():
    old_opening = {"417": 0}
    mapping = {"417": "u417"}
    current = {}
    plan = build_opening_plan(old_opening, mapping, current)
    assert plan["updates"] == [] and plan["inserts"] == [] and plan["missing_mapping"] == []


def test_build_opening_plan_skips_new_native():
    # Customer không có legacy mapping (NEW-native) không bao giờ bị đụng.
    old_opening = {"417": 613662}
    mapping = {}  # no mapping -> NEW-native
    current = {}
    plan = build_opening_plan(old_opening, mapping, current)
    assert plan["updates"] == [] and plan["inserts"] == []
    assert plan["missing_mapping"] == [{"legacy_id": "417", "opening_debt": 613662}]


def test_build_opening_plan_idempotent():
    old_opening = {"417": 613662, "430": 255989}
    mapping = {"417": "u417", "430": "u430"}
    current = {"u417": 613662, "u430": 255989}
    plan = build_opening_plan(old_opening, mapping, current)
    assert plan["updates"] == [] and plan["inserts"] == [] and plan["missing_mapping"] == []
