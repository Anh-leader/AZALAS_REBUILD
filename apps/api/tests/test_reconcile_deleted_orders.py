"""Unit tests cho deleted-order reconciliation (FIX ĐỢT 1) — pure logic, không đụng DB.

Chỉ kiểm tra build_plan / compute_deleted_diff / new_deleted_eligible. KHÔNG chạy
--apply và KHÔNG đụng Supabase OLD/NEW production.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from scripts.reconciliation.deleted_orders import (
    DELETED,
    build_plan,
    compute_deleted_diff,
    new_deleted_eligible,
)

CUTOVER = datetime(2026, 10, 15, 21, 20, 54, tzinfo=timezone.utc)


def _old(code: str, *, deleted_at: datetime | None = CUTOVER + timedelta(days=2), reason: str = "Xóa từ Chi tiết đơn") -> dict:
    return {"legacy_id": 1, "deleted_at": deleted_at, "delete_reason": reason, "deleted_by": "u-1"}


def _new(order_id: str, *, status: str, billing: str, updated_at: datetime | None = CUTOVER) -> dict:
    return {"id": order_id, "status": status, "billing_status": billing, "updated_at": updated_at}


# --------------------------------------------------------------------------
# backfill billing_status (status đã DELETED nhưng billing còn DRAFT)
# --------------------------------------------------------------------------
def test_backfill_billing_status_for_deleted_draft():
    plan = build_plan(
        {"A": _old("A")},
        {"A": _new("id-a", status="DELETED", billing="DRAFT")},
    )
    assert plan["will_backfill_billing_status"] == [{
        "order_code": "A", "order_id": "id-a", "old_status": "DELETED", "old_billing_status": "DRAFT",
        "legacy_id": 1, "deleted_at": _old("A")["deleted_at"], "delete_reason": "Xóa từ Chi tiết đơn",
        "deleted_by": "u-1",
    }]
    assert plan["will_sync_post_cutover"] == []
    assert plan["conflicts"] == []
    assert plan["already_correct"] == []


def test_already_deleted_skipped():
    plan = build_plan(
        {"A": _old("A")},
        {"A": _new("id-a", status="DELETED", billing="DELETED")},
    )
    assert plan["already_correct"] == ["A"]
    assert plan["will_backfill_billing_status"] == []
    assert plan["will_sync_post_cutover"] == []


def test_blocking_invoice_conflicts_backfill():
    plan = build_plan(
        {"A": _old("A")},
        {"A": _new("id-a", status="DELETED", billing="DRAFT")},
        {"id-a": ["SENT"]},
    )
    assert plan["conflicts"][0]["order_code"] == "A"
    assert plan["conflicts"][0]["reason"] == "has_blocking_invoice"
    assert plan["will_backfill_billing_status"] == []


# --------------------------------------------------------------------------
# post-cutover sync (OLD DA_XOA nhưng NEW vẫn PICKED/... )
# --------------------------------------------------------------------------
def test_post_cutover_sync_when_not_modified_after_delete():
    deleted_at = CUTOVER + timedelta(days=2)
    plan = build_plan(
        {"B": _old("B", deleted_at=deleted_at)},
        {"B": _new("id-b", status="PICKED", billing="DRAFT", updated_at=CUTOVER)},
    )
    assert plan["will_sync_post_cutover"] == [{
        "order_code": "B", "order_id": "id-b", "old_status": "PICKED", "old_billing_status": "DRAFT",
        "legacy_id": 1, "deleted_at": deleted_at, "delete_reason": "Xóa từ Chi tiết đơn", "deleted_by": "u-1",
    }]
    assert plan["will_backfill_billing_status"] == []


def test_modified_after_delete_not_overwritten():
    deleted_at = CUTOVER + timedelta(days=2)
    plan = build_plan(
        {"B": _old("B", deleted_at=deleted_at)},
        {"B": _new("id-b", status="PICKED", billing="DRAFT", updated_at=CUTOVER + timedelta(days=3))},
    )
    assert plan["conflicts"][0]["order_code"] == "B"
    assert plan["conflicts"][0]["reason"] == "modified_after_delete"
    assert plan["will_sync_post_cutover"] == []


def test_post_cutover_missing_old_deleted_at_conflicts():
    plan = build_plan(
        {"B": _old("B", deleted_at=None)},
        {"B": _new("id-b", status="PICKED", billing="DRAFT", updated_at=CUTOVER)},
    )
    assert plan["conflicts"][0]["reason"] == "missing_old_deleted_at"


# --------------------------------------------------------------------------
# idempotency + verify
# --------------------------------------------------------------------------
def test_rerun_is_idempotent_no_actions():
    # Sau apply, order có status=DELETED + billing=DELETED -> already_correct, không action.
    plan = build_plan(
        {"A": _old("A"), "B": _old("B")},
        {
            "A": _new("id-a", status="DELETED", billing="DELETED"),
            "B": _new("id-b", status="DELETED", billing="DELETED"),
        },
    )
    assert plan["already_correct"] == ["A", "B"]
    assert plan["will_backfill_billing_status"] == []
    assert plan["will_sync_post_cutover"] == []
    assert plan["conflicts"] == []


def test_deleted_tab_sees_record_after_fix():
    # NEW eligible = billing_status=DELETED; sau fix order A xuất hiện trong tab deleted.
    new_orders = {
        "A": _new("id-a", status="DELETED", billing="DELETED"),
        "B": _new("id-b", status="PICKED", billing="DRAFT"),
    }
    assert new_deleted_eligible(new_orders) == ["A"]


def test_compute_deleted_diff_matches_target():
    diff = compute_deleted_diff(["A", "B", "C"], ["A", "B", "C"])
    assert diff == {"deleted_old": 3, "deleted_new": 3, "only_old": [], "only_new": [], "mismatch_count": 0}


def test_compute_deleted_diff_reports_exact_mismatch():
    diff = compute_deleted_diff(["A", "B"], ["A"])
    assert diff["mismatch_count"] == 1
    assert diff["only_old"] == ["B"]
    assert diff["only_new"] == []


def test_not_in_new_is_skipped():
    plan = build_plan({"C": _old("C")}, {})
    assert plan["skipped"] == ["C"]
    assert plan["will_backfill_billing_status"] == []
    assert plan["will_sync_post_cutover"] == []
