"""FIX ĐỢT 1 — Reconcile deleted orders between Supabase OLD (legacy) and NEW (current).

Problem
-------
OLD lưu đơn xóa ở ``order_units.status = 'DA_XOA'``. Migration trước đã map
``DA_XOA -> orders.status = 'DELETED'`` nhưng KHÔNG set ``orders.billing_status``,
nên nó vẫn giữ giá trị mặc định ``DRAFT``.

Trong khi đó tab "Đơn đã xóa" của NEW (``finance.invoice_work_queue``) lọc theo
``billing_status = 'DELETED'`` → hiển thị 0 dù NEW đang có 42+ đơn ``status='DELETED'``.

Chức năng module này:
  * backfill ``billing_status='DELETED'`` cho các order đã ``status='DELETED'``
    (an toàn khi OLD tương ứng thật sự DA_XOA và không có invoice link chặn),
  * đồng bộ đơn xóa sau cutover (OLD DA_XOA nhưng NEW vẫn PICKED/... ) sang
    ``status='DELETED'`` + ``billing_status='DELETED'`` (an toàn khi NEW chưa bị
    user sửa sau thời điểm OLD xóa, và không có invoice link chặn),
  * ghi ``audit_logs`` (action ``LEGACY_DELETED_ORDER_SYNC``) cho mỗi thay đổi,
  * idempotent (chạy lần 2: updated=0, inserted=0).

KHÔNG tự ghi production: chỉ ghi khi CLI chạy với ``--apply``.
"""
from __future__ import annotations

import json
import uuid
from datetime import timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

DELETED = "DELETED"
ACTION = "LEGACY_DELETED_ORDER_SYNC"
MODULE = "MIGRATION"
# Invoice đã chốt/đang thu tiền thì chặn xóa (không hard-delete mù).
BLOCKING_INVOICE_STATUSES = ("SENT", "PAID", "PARTIALLY_PAID")


def _newer(a: Any, b: Any) -> bool:
    """True nếu a (NEW updated_at) muộn hơn b (OLD deleted_at). Chịu naive/aware."""
    if a is None or b is None:
        return False
    try:
        return a > b
    except TypeError:
        a_utc = a.replace(tzinfo=timezone.utc) if a.tzinfo is None else a
        b_utc = b.replace(tzinfo=timezone.utc) if b.tzinfo is None else b
        return a_utc > b_utc


def _as_str(value: Any) -> str | None:
    if value is None:
        return None
    return str(value).strip() or None


def build_plan(
    old_deleted: dict[str, dict],
    new_orders: dict[str, dict],
    linked_invoice_statuses: dict[str, list[str]] | None = None,
) -> dict:
    """Pure logic: tính plan đồng bộ deleted order (không đụng DB).

    Args:
        old_deleted: order_code -> {legacy_id, deleted_at, delete_reason, deleted_by}
        new_orders:  order_no   -> {id, status, billing_status, updated_at}
        linked_invoice_statuses: order_id (str) -> list[str] invoice statuses
    """
    linked = linked_invoice_statuses or {}
    source = sorted(old_deleted)

    already_correct: list[str] = []
    will_backfill: list[dict] = []
    will_sync_post_cutover: list[dict] = []
    conflicts: list[dict] = []
    not_in_new: list[str] = []

    for code in source:
        old = old_deleted[code]
        new = new_orders.get(code)
        if new is None:
            not_in_new.append(code)
            continue

        order_id = str(new.get("id") or "")
        inv_statuses = [_as_str(s) for s in linked.get(order_id, [])]
        blocking = any(s in BLOCKING_INVOICE_STATUSES for s in inv_statuses)

        if new.get("billing_status") == DELETED:
            already_correct.append(code)
            continue

        if new.get("status") == DELETED:
            if blocking:
                conflicts.append(_conflict(code, "has_blocking_invoice", old, new, inv_statuses))
            else:
                will_backfill.append(_action(code, old, new))
            continue

        # status != DELETED -> đồng bộ đơn xóa sau cutover.
        if blocking:
            conflicts.append(_conflict(code, "has_blocking_invoice", old, new, inv_statuses))
            continue
        deleted_at = old.get("deleted_at")
        if deleted_at is None:
            conflicts.append(_conflict(code, "missing_old_deleted_at", old, new, inv_statuses))
            continue
        if _newer(new.get("updated_at"), deleted_at):
            conflicts.append(_conflict(code, "modified_after_delete", old, new, inv_statuses))
            continue
        will_sync_post_cutover.append(_action(code, old, new))

    return {
        "source_deleted_old": source,
        "already_correct": already_correct,
        "will_backfill_billing_status": will_backfill,
        "will_sync_post_cutover": will_sync_post_cutover,
        "conflicts": conflicts,
        "skipped": not_in_new,
    }


def _action(code: str, old: dict, new: dict) -> dict:
    return {
        "order_code": code,
        "order_id": str(new.get("id") or ""),
        "old_status": new.get("status"),
        "old_billing_status": new.get("billing_status"),
        "legacy_id": old.get("legacy_id"),
        "deleted_at": old.get("deleted_at"),
        "delete_reason": old.get("delete_reason"),
        "deleted_by": _as_str(old.get("deleted_by")),
    }


def _conflict(code: str, reason: str, old: dict, new: dict, inv_statuses: list[str]) -> dict:
    return {
        "order_code": code,
        "order_id": str(new.get("id") or ""),
        "reason": reason,
        "status": new.get("status"),
        "billing_status": new.get("billing_status"),
        "invoice_statuses": inv_statuses,
        "old_deleted_at": old.get("deleted_at"),
        "new_updated_at": new.get("updated_at"),
    }


def new_deleted_eligible(new_orders: dict[str, dict]) -> list[str]:
    """Các order_code đủ điều kiện hiển thị ở tab 'Đơn đã xóa' (billing_status=DELETED)."""
    return sorted(code for code, o in new_orders.items() if o.get("billing_status") == DELETED)


def compute_deleted_diff(old_codes, new_eligible_codes) -> dict:
    """So sánh deleted theo business key (order_code), không chỉ so count."""
    old = set(old_codes)
    new = set(new_eligible_codes)
    return {
        "deleted_old": len(old),
        "deleted_new": len(new),
        "only_old": sorted(old - new),
        "only_new": sorted(new - old),
        "mismatch_count": len((old - new) | (new - old)),
    }


# --------------------------------------------------------------------------
# Readers (SELECT from OLD / NEW)
# --------------------------------------------------------------------------
def read_old_deleted(engine: Engine) -> dict[str, dict]:
    with engine.connect() as conn:
        rows = conn.execute(text(
            "SELECT id, order_code, deleted_by, deleted_at, delete_reason "
            "FROM order_units WHERE status = 'DA_XOA'"
        )).mappings()
        out: dict[str, dict] = {}
        for r in rows:
            code = _as_str(r.get("order_code"))
            if not code:
                continue
            out[code] = {
                "legacy_id": r.get("id"),
                "deleted_at": r.get("deleted_at"),
                "delete_reason": r.get("delete_reason"),
                "deleted_by": _as_str(r.get("deleted_by")),
            }
        return out


def read_new_orders(engine: Engine) -> dict[str, dict]:
    with engine.connect() as conn:
        rows = conn.execute(text(
            "SELECT id, order_no, status, billing_status, updated_at FROM orders"
        )).mappings()
        out: dict[str, dict] = {}
        for r in rows:
            code = _as_str(r.get("order_no"))
            if not code:
                continue
            out[code] = {
                "id": r.get("id"),
                "status": r.get("status"),
                "billing_status": r.get("billing_status"),
                "updated_at": r.get("updated_at"),
            }
        return out


def read_invoice_links(engine: Engine) -> dict[str, list[str]]:
    with engine.connect() as conn:
        rows = conn.execute(text(
            "SELECT io.order_id, i.status FROM invoice_orders io "
            "JOIN invoices i ON i.id = io.invoice_id"
        )).mappings()
        out: dict[str, list[str]] = {}
        for r in rows:
            out.setdefault(str(r.get("order_id")), []).append(_as_str(r.get("status")) or "")
        return out


# --------------------------------------------------------------------------
# Apply (write NEW, single transaction, idempotent)
# --------------------------------------------------------------------------
def apply_plan(engine: Engine, plan: dict) -> dict:
    """Áp dụng plan trong 1 transaction. Guards được re-check để idempotent."""
    updated = 0
    inserted_audit = 0
    with engine.begin() as conn:
        for item in plan.get("will_backfill_billing_status", []):
            res = conn.execute(text(
                "UPDATE orders SET billing_status = :del, updated_at = now() "
                "WHERE id = CAST(:id AS uuid) AND status = :del AND billing_status <> :del "
                "RETURNING order_no"
            ), {"id": item["order_id"], "del": DELETED})
            if res.fetchone():
                updated += 1
                inserted_audit += _insert_audit(conn, item, status_changed=False)
        for item in plan.get("will_sync_post_cutover", []):
            res = conn.execute(text(
                "UPDATE orders SET status = :del, billing_status = :del, updated_at = now() "
                "WHERE id = CAST(:id AS uuid) AND status <> :del "
                "RETURNING order_no"
            ), {"id": item["order_id"], "del": DELETED})
            if res.fetchone():
                updated += 1
                inserted_audit += _insert_audit(conn, item, status_changed=True)
    return {"updated": updated, "audit_inserted": inserted_audit}


def _insert_audit(conn: Connection, item: dict, *, status_changed: bool) -> int:
    before = {
        "status": item.get("old_status"),
        "billing_status": item.get("old_billing_status"),
    }
    after = {
        "status": DELETED,
        "billing_status": DELETED,
        "status_changed": status_changed,
        "legacy_id": _as_str(item.get("legacy_id")),
        "legacy_deleted_at": item.get("deleted_at"),
        "legacy_delete_reason": item.get("delete_reason"),
        "legacy_deleted_by": item.get("deleted_by"),
    }
    conn.execute(text(
        "INSERT INTO audit_logs "
        "(id, entity_type, entity_id, action, module, actor_user_id, before_data, after_data) "
        "VALUES (CAST(:id AS uuid), 'ORDER', CAST(:entity_id AS uuid), :action, :module, NULL, "
        "CAST(:before AS json), CAST(:after AS json))"
    ), {
        "id": str(uuid.uuid4()),
        "entity_id": item["order_id"],
        "action": ACTION,
        "module": MODULE,
        "before": json.dumps(before, ensure_ascii=False, default=str),
        "after": json.dumps(after, ensure_ascii=False, default=str),
    })
    return 1
