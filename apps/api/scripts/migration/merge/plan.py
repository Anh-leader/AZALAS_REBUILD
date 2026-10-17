"""Merge plan: pure functions để tính categories + conflict cho từng entity.

Thiết kế để test được mà không cần DB: nhận các record dict đã chuẩn hóa,
trả plan + report. Apply layer sẽ dùng plan này để ghi (chỉ khi --apply).

Quy tắc merge (Supabase OLD là source of truth):
- Key matching: customers.customer_code / orders.order_no / media.object_key+checksum
  / debt.idempotency_key (reference identity) / payments.idempotency_key.
- Nếu key chỉ có ở OLD -> only_supabase (giữ nguyên).
- Nếu key chỉ có ở Sheets -> only_sheets (import).
- Nếu key có cả hai:
    * field null/empty ở OLD mà Sheets có -> fill (không tính conflict).
    * field khác nhau không-null -> conflict, giữ OLD, đưa vào report.
    * status: không downgrade (giữ rank cao hơn).
"""
from __future__ import annotations

from typing import Any

# Workflow rank để chặn downgrade. Cao hơn = tiến xa hơn trong luồng.
ORDER_STATUS_RANK: dict[str, int] = {
    "NEW": 1,
    "PICKING": 2,
    "PICKED": 3,
    "DEBT_ORDER": 3,
    "SHIPPING": 4,
    "COMPLETED": 5,
    "RETURNED": 5,
    "CANCELLED": 6,
    "DELETED": 7,
}


def _is_empty(value: Any) -> bool:
    return value is None or value == "" or value == 0 or value is False


def merge_scalar(old_value: Any, sheet_value: Any) -> tuple[Any, bool]:
    """Trả (value, conflict). OLD thắng; Sheets chỉ fill khi OLD rỗng."""
    if not _is_empty(old_value):
        return old_value, False
    return sheet_value, False


def merge_field(old_value: Any, sheet_value: Any, *, financial: bool = False) -> tuple[Any, bool]:
    """Merge một field. Financial field: KHÔNG tự merge khi conflict (cần rule rõ)."""
    if _is_empty(old_value) and not _is_empty(sheet_value):
        return sheet_value, False
    if not _is_empty(old_value) and not _is_empty(sheet_value) and old_value != sheet_value:
        if financial:
            # Giữ OLD, báo conflict để người vận hành xử lý thủ công.
            return old_value, True
        # Non-financial: OLD vẫn thắng, nhưng báo conflict để minh bạch.
        return old_value, True
    return old_value, False


def merge_status(old_status: str | None, sheet_status: str | None) -> tuple[str | None, bool]:
    """Không downgrade status. Trả (status_giữ, downgrade_conflict)."""
    if _is_empty(old_status):
        return sheet_status, False
    if _is_empty(sheet_status):
        return old_status, False
    old_rank = ORDER_STATUS_RANK.get(old_status, 0)
    sheet_rank = ORDER_STATUS_RANK.get(sheet_status, 0)
    if sheet_rank > old_rank:
        # Sheets mới hơn (tiến xa hơn) -> chấp nhận upgrade.
        return sheet_status, False
    if sheet_rank < old_rank:
        # Sheets cũ hơn -> downgrade, giữ OLD và báo conflict.
        return old_status, True
    return old_status, False


def is_newer(newer_at: Any, older_at: Any) -> bool:
    """So sánh updated_at: newer_at mới hơn older_at (string/None an toàn)."""
    if not newer_at or not older_at:
        return bool(newer_at)
    return str(newer_at) > str(older_at)  # ISO-8601 so sánh lexicographic đúng


# --------------------------------------------------------------------------
# Entity plan builders. Mỗi hàm trả dict report categories.
# --------------------------------------------------------------------------
def plan_customers(old: dict[str, dict], sheets: dict[str, dict]) -> dict:
    result: dict[str, Any] = {
        "only_supabase": [], "only_sheets": [], "same": [], "conflict": [],
    }
    for key, old_row in old.items():
        if key not in sheets:
            result["only_supabase"].append(key)
            continue
        sheet_row = sheets[key]
        conflicts: list[str] = []
        merged: dict[str, Any] = {}
        for field in ("name", "phone", "address", "customer_group", "carrier_name", "carrier_phone"):
            value, conflict = merge_field(old_row.get(field), sheet_row.get(field), financial=False)
            merged[field] = value
            if conflict:
                conflicts.append(field)
        if conflicts:
            result["conflict"].append({"key": key, "fields": conflicts})
        else:
            result["same"].append(key)
    for key in sheets:
        if key not in old:
            result["only_sheets"].append(key)
    return result


def plan_orders(old: dict[str, dict], sheets: dict[str, dict]) -> dict:
    result: dict[str, Any] = {
        "only_supabase": [], "only_sheets": [], "same": [], "status_conflict": [], "amount_conflict": [],
    }
    for key, old_row in old.items():
        if key not in sheets:
            result["only_supabase"].append(key)
            continue
        sheet_row = sheets[key]
        kept_status, status_conflict = merge_status(old_row.get("status"), sheet_row.get("status"))
        amount_conflicts = []
        for field in ("total_amount", "paid_amount", "invoice_balance_amount"):
            old_v, sheet_v = old_row.get(field), sheet_row.get(field)
            if not _is_empty(old_v) and not _is_empty(sheet_v) and int(old_v) != int(sheet_v):
                amount_conflicts.append(field)
        if status_conflict:
            result["status_conflict"].append({
                "key": key, "old_status": old_row.get("status"),
                "sheet_status": sheet_row.get("status"), "kept": kept_status,
            })
        elif amount_conflicts:
            result["amount_conflict"].append({"key": key, "fields": amount_conflicts})
        else:
            result["same"].append(key)
    for key in sheets:
        if key not in old:
            result["only_sheets"].append(key)
    return result


def plan_debt(old_txns: set[str], sheet_txns: set[str], old_balance: dict[str, int], sheet_balance: dict[str, int]) -> dict:
    result: dict[str, Any] = {
        "supabase_only_transactions": sorted(old_txns - sheet_txns),
        "sheet_only_transactions": sorted(sheet_txns - old_txns),
        "balance_difference": [],
    }
    for customer in sorted(set(old_balance) | set(sheet_balance)):
        old_bal = old_balance.get(customer, 0)
        sheet_bal = sheet_balance.get(customer, 0)
        if old_bal != sheet_bal:
            result["balance_difference"].append({
                "customer_code": customer,
                "supabase_balance": old_bal,
                "sheet_balance": sheet_bal,
                "difference": sheet_bal - old_bal,
            })
    return result


def plan_media(old_keys: set[str], sheet_keys: set[str], invalid: list[dict] | None = None) -> dict:
    return {
        "existing": sorted(old_keys & sheet_keys),
        "missing": sorted(sheet_keys - old_keys),
        "duplicate": sorted(old_keys),  # keys present in OLD are never re-imported
        "invalid": invalid or [],
    }
