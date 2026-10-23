"""Unit tests cho invoice reconciliation (FIX ĐỢT 2A) — pure logic, không đụng DB.

Không chạy --apply và không đụng Supabase OLD/NEW production.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from scripts.reconciliation.invoices import (
    build_plan,
    compute_target,
    sent_codes,
)

CUTOVER = datetime(2026, 10, 15, 21, 24, 45, tzinfo=timezone.utc)
FINALIZED = datetime(2026, 10, 17, 8, 32, 56, tzinfo=timezone.utc)


def _old_invoice(code: str, *, subtotal: str = "11.05", customer_id: int = 572,
                 finalized_at: datetime | None = FINALIZED, created_at: datetime = CUTOVER) -> dict:
    return {
        "invoice_code": code, "legacy_id": 4, "customer_id": customer_id,
        "status": "DA_GUI", "subtotal": subtotal, "finalized_at": finalized_at,
        "created_at": created_at, "invoice_image_path": "x.png", "old_debt_snapshot": "1000.00",
    }


def _new_invoice(invoice_id: str, *, status: str = "DRAFT", subtotal: int = 11, paid: int = 0,
                 balance: int = 11, debt_before: int = 7005, debt_after: int = 7016,
                 updated_at: datetime | None = CUTOVER, issued_at=None, captured_at=None) -> dict:
    return {
        "id": invoice_id, "status": status, "subtotal_amount": subtotal,
        "surcharge_amount": 0, "return_credit_amount": 0, "paid_amount": paid,
        "balance_amount": balance, "debt_before_amount": debt_before, "debt_after_amount": debt_after,
        "issued_at": issued_at, "captured_at": captured_at, "updated_at": updated_at,
    }


def test_compute_target_paid_when_overpaid():
    t = compute_target(_old_invoice("A"), [{"method": "CHUYEN_KHOAN", "amount": "600.00"}])
    assert t["status"] == "PAID"
    assert t["subtotal_amount"] == 11
    assert t["paid_amount"] == 600
    assert t["balance_amount"] == 0


def test_compute_target_sent_when_no_payment():
    t = compute_target(_old_invoice("B", subtotal="3280.00"), [])
    assert t["status"] == "SENT"
    assert t["subtotal_amount"] == 3280
    assert t["balance_amount"] == 3280


def test_stale_draft_plans_finalize():
    plan = build_plan(
        {"A": _old_invoice("A")},
        {"A": [{"method": "CHUYEN_KHOAN", "amount": "600.00"}]},
        {"A": [71, 72]},
        {"A": [{"source_item_id": 19, "line_total": "0.05"}, {"source_item_id": 20, "line_total": "11.00"}]},
        {19: 71, 20: 72},
        {"A": _new_invoice("id-a")},
    )
    assert len(plan["will_finalize"]) == 1
    item = plan["will_finalize"][0]
    assert item["invoice_code"] == "A"
    assert item["diff"]["status"] == "PAID"
    assert item["diff"]["paid_amount"] == 600
    assert item["diff"]["balance_amount"] == 0
    assert item["diff"]["debt_after_amount"] == 6416  # 7005 + 11 - 600


def test_already_sent_no_action():
    plan = build_plan(
        {"A": _old_invoice("A")},
        {"A": []},
        {"A": []},
        {"A": []},
        {},
        {"A": _new_invoice("id-a", status="SENT", subtotal=11, paid=600, balance=0)},
    )
    assert plan["already_exists"] == ["A"]
    assert plan["will_finalize"] == []


def test_amount_mismatch_is_audit_only():
    # OLD total 7000, NEW total 7300 (surcharge 300) -> audit-only, không tự sửa.
    old = _old_invoice("C", subtotal="7000.00")
    new = _new_invoice("id-c", status="SENT", subtotal=7000, paid=0, balance=7000)
    new["surcharge_amount"] = 300
    plan = build_plan({"C": old}, {"C": []}, {"C": []}, {"C": []}, {}, {"C": new})
    assert "C" in plan["already_exists"]
    assert any(m["invoice_code"] == "C" for m in plan["amount_mismatch"])
    assert plan["will_finalize"] == []


def test_modified_after_finalize_conflicts():
    plan = build_plan(
        {"A": _old_invoice("A")},
        {"A": []},
        {"A": []},
        {"A": []},
        {},
        {"A": _new_invoice("id-a", updated_at=FINALIZED + timedelta(days=1))},
    )
    assert plan["conflicts"][0]["invoice_code"] == "A"
    assert plan["conflicts"][0]["reason"] == "modified_after_finalize"


def test_missing_invoice_plans_insert():
    plan = build_plan(
        {"A": _old_invoice("A")},
        {"A": [{"method": "CHUYEN_KHOAN", "amount": "600.00"}]},
        {"A": [71]},
        {"A": [{"source_item_id": 19, "line_total": "11.00"}]},
        {19: 71},
        {},
    )
    assert len(plan["will_insert_invoices"]) == 1
    assert plan["will_insert_invoices"][0]["invoice_code"] == "A"


def test_link_amount_reconcile_when_different():
    plan = build_plan(
        {"B": _old_invoice("B", subtotal="3280.00")},
        {"B": []},
        {"B": [120]},
        {"B": [{"source_item_id": 58, "line_total": "3280.00"}]},
        {58: 120},
        {"B": _new_invoice("id-b", status="DRAFT", subtotal=3800, balance=3800, debt_before=60319, debt_after=64119)},
        {"B": {"new-order-oid": 3800}},
        {"120": "new-order-oid"},
    )
    assert len(plan["will_finalize"]) == 1
    assert plan["will_finalize"][0]["diff"]["subtotal_amount"] == 3280
    assert plan["will_finalize"][0]["diff"]["debt_after_amount"] == 63599  # 60319 + 3280
    assert plan["will_update_invoice_orders"] == [{
        "invoice_code": "B", "invoice_id": "id-b", "order_id": "new-order-oid",
        "old_amount": 3800, "new_amount": 3280,
    }]


def test_sent_codes_diff():
    old = {"A": {"status": "DA_GUI"}, "B": {"status": "CHUA_CHOT"}}
    new = {"A": {"status": "PAID"}, "C": {"status": "SENT"}}
    d = sent_codes(old, new)
    assert d["sent_old"] == 1
    assert d["sent_new"] == 2
    assert d["only_old"] == []
    assert d["only_new"] == ["C"]
    assert d["mismatch_count"] == 1
