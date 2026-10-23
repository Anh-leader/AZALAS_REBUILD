"""Unit tests cho sync_order_statuses (pure functions, không đụng Supabase).

Khoá hành vi: mapping OLD status -> NEW status/billing, idempotent (không update
khi đã đúng), và NEW-native order (không có legacy mapping) KHÔNG bao giờ bị đụng.
"""
from __future__ import annotations

from scripts.migration.legacy_to_current.sync_status import (
    STATUS_SYNC,
    build_status_plan,
    target_for,
)


def test_target_for_maps_all_known_statuses():
    assert target_for("MOI") == ("NEW", "DRAFT")
    assert target_for("DANG_SOAN") == ("PICKING", "DRAFT")
    assert target_for("DA_SOAN") == ("PICKED", "DRAFT")
    assert target_for("NO_DON") == ("DEBT_ORDER", "DRAFT")
    assert target_for("DA_XOA") == ("DELETED", "DELETED")


def test_target_for_unknown_returns_none():
    assert target_for("CHUA_BIET") is None
    assert target_for(None) is None
    assert target_for("") is None


def test_status_sync_keys_are_stable():
    # Không vô tình đổi tên status OLD -> làm lệch mapping.
    assert set(STATUS_SYNC) == {"MOI", "DANG_SOAN", "DA_SOAN", "NO_DON", "DA_XOA"}


def test_build_plan_updates_only_changed_rows():
    old_rows = [
        {"id": 1, "order_code": "HD1", "status": "MOI"},        # đúng, skip
        {"id": 2, "order_code": "HD2", "status": "DA_SOAN"},    # NEW -> PICKED
        {"id": 3, "order_code": "HD3", "status": "DA_XOA"},     # PICKED -> DELETED
    ]
    mapping = {"1": "u1", "2": "u2", "3": "u3"}
    current = {
        "u1": ("NEW", "DRAFT"),
        "u2": ("NEW", "DRAFT"),
        "u3": ("PICKED", "DRAFT"),
    }
    result = build_status_plan(old_rows, mapping, current)
    assert result["unmapped_status"] == []
    assert result["missing_mapping"] == []
    changes = {c["order_code"]: (c["from_status"], c["to_status"], c["from_billing"], c["to_billing"]) for c in result["plan"]}
    assert set(changes) == {"HD2", "HD3"}
    assert changes["HD2"] == ("NEW", "PICKED", "DRAFT", "DRAFT")
    assert changes["HD3"] == ("PICKED", "DELETED", "DRAFT", "DELETED")


def test_build_plan_skips_new_native_orders():
    # Order không nằm trong legacy mapping (NEW-native) không bao giờ được update.
    old_rows = [{"id": 1, "order_code": "HD1", "status": "DA_SOAN"}]
    mapping = {}  # HD1 is NEW-native (no mapping)
    current = {"native-1": ("NEW", "DRAFT")}
    result = build_status_plan(old_rows, mapping, current)
    assert result["plan"] == []
    # Báo thiếu mapping thay vì âm thầm bỏ qua, để operator biết.
    assert result["missing_mapping"] == [{"legacy_id": "1", "order_code": "HD1"}]


def test_build_plan_reports_unmapped_and_missing():
    old_rows = [
        {"id": 1, "order_code": "HD1", "status": "CHUA_BIET"},
        {"id": 2, "order_code": "HD2", "status": "MOI"},
    ]
    mapping = {"2": "u2"}
    current = {"u2": ("NEW", "DRAFT")}
    result = build_status_plan(old_rows, mapping, current)
    assert result["plan"] == []
    assert result["unmapped_status"] == [{"legacy_id": "1", "order_code": "HD1", "status": "CHUA_BIET"}]
    assert result["missing_mapping"] == []


def test_build_plan_idempotent():
    # Rerun không sinh thêm update khi mọi thứ đã đúng.
    old_rows = [
        {"id": 1, "order_code": "HD1", "status": "MOI"},
        {"id": 2, "order_code": "HD2", "status": "DA_SOAN"},
        {"id": 3, "order_code": "HD3", "status": "DA_XOA"},
    ]
    mapping = {"1": "u1", "2": "u2", "3": "u3"}
    current = {
        "u1": ("NEW", "DRAFT"),
        "u2": ("PICKED", "DRAFT"),
        "u3": ("DELETED", "DELETED"),
    }
    result = build_status_plan(old_rows, mapping, current)
    assert result["plan"] == []
    assert result["unmapped_status"] == []
    assert result["missing_mapping"] == []
