"""Sync NEW ``orders.status`` / ``orders.billing_status`` from OLD ``order_units.status``.

Root cause of "Chi tiết đơn" count drift: snapshot migrations copied a status at
migration time while OLD keeps progressing (MOI -> DANG_SOAN -> DA_SOAN -> DA_XOA).
NEW therefore goes stale and "Đơn mới"/"Đang soạn" inflate (e.g. 58/35 instead of
26/13). This module re-reads OLD and patches NEW for **migrated orders only**,
identified via ``legacy_id_mapping``. Orders without a mapping (created natively on
NEW) are never touched.

Idempotent: only rows whose status/billing_status actually differ are updated.
Dry-run by default (no writes); pass ``dry_run=False`` to apply.
"""
from __future__ import annotations

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from .old import read_query

# OLD order_units.status -> (NEW orders.status, NEW orders.billing_status)
STATUS_SYNC: dict[str, tuple[str, str]] = {
    "MOI": ("NEW", "DRAFT"),
    "DANG_SOAN": ("PICKING", "DRAFT"),
    "DA_SOAN": ("PICKED", "DRAFT"),
    "NO_DON": ("DEBT_ORDER", "DRAFT"),
    "DA_XOA": ("DELETED", "DELETED"),
}


def target_for(old_status: str | None) -> tuple[str, str] | None:
    """Return (NEW status, NEW billing_status) for an OLD status, or None if unmapped."""
    if old_status is None:
        return None
    return STATUS_SYNC.get(str(old_status).strip())


def build_status_plan(
    old_rows: list[dict],
    mapping: dict[str, str],
    current: dict[str, tuple[str, str]],
) -> dict:
    """Pure plan builder (testable without a database).

    ``mapping`` maps legacy_id (str) -> new_uuid (str); ``current`` maps new_uuid
    (str) -> (status, billing_status). Only mapped orders that actually differ are
    planned for update, so NEW-native orders (absent from ``mapping``) are skipped.
    """
    plan: list[dict] = []
    unmapped_status: list[dict] = []
    missing_mapping: list[dict] = []
    for r in old_rows:
        legacy_id = str(r.get("id"))
        order_code = str(r.get("order_code") or "")
        raw_status = r.get("status")
        target = target_for(raw_status)
        if target is None:
            unmapped_status.append(
                {"legacy_id": legacy_id, "order_code": order_code, "status": str(raw_status)}
            )
            continue
        new_uuid = mapping.get(legacy_id)
        if new_uuid is None:
            missing_mapping.append({"legacy_id": legacy_id, "order_code": order_code})
            continue
        cur = current.get(str(new_uuid))
        if cur is None:
            missing_mapping.append(
                {"legacy_id": legacy_id, "order_code": order_code, "reason": "order_missing_in_new"}
            )
            continue
        if tuple(cur) == target:
            continue
        plan.append(
            {
                "order_id": str(new_uuid),
                "order_code": order_code,
                "old_status": str(raw_status),
                "from_status": cur[0],
                "to_status": target[0],
                "from_billing": cur[1],
                "to_billing": target[1],
            }
        )
    return {"plan": plan, "unmapped_status": unmapped_status, "missing_mapping": missing_mapping}


def _load_mapping_and_current(engine: Engine) -> tuple[dict[str, str], dict[str, tuple[str, str]]]:
    with engine.connect() as conn:
        mapping = {
            str(legacy_id): str(new_uuid)
            for legacy_id, new_uuid in conn.execute(
                text(
                    "SELECT legacy_id, new_uuid FROM legacy_id_mapping "
                    "WHERE legacy_table = 'order_units' AND new_table = 'orders'"
                )
            ).fetchall()
        }
        current = {
            str(oid): (status, billing)
            for oid, status, billing in conn.execute(
                text("SELECT id, status, billing_status FROM orders")
            ).fetchall()
        }
    return mapping, current


def sync_order_statuses(old_url: str, new_url: str, *, dry_run: bool = True) -> dict:
    """Re-sync order statuses OLD -> NEW. Read-only when ``dry_run`` is True."""
    old = create_engine(old_url, future=True)
    new = create_engine(new_url, future=True)
    try:
        rows = read_query(old, 'SELECT id, order_code, status FROM "order_units"')
        mapping, current = _load_mapping_and_current(new)
        plan = build_status_plan(rows, mapping, current)

        changes = plan["plan"]
        by_transition: dict[str, int] = {}
        for c in changes:
            key = f"{c['from_status']}->{c['to_status']}"
            by_transition[key] = by_transition.get(key, 0) + 1

        if changes and not dry_run:
            with new.begin() as conn:
                for c in changes:
                    conn.execute(
                        text(
                            "UPDATE orders SET status = :status, billing_status = :billing, "
                            "updated_at = now() WHERE id = :id"
                        ),
                        {"status": c["to_status"], "billing": c["to_billing"], "id": c["order_id"]},
                    )

        return {
            "dry_run": dry_run,
            "total_old_orders": len(rows),
            "will_update": len(changes),
            "by_transition": by_transition,
            "unmapped_status": plan["unmapped_status"],
            "missing_mapping": plan["missing_mapping"],
        }
    finally:
        old.dispose()
        new.dispose()
