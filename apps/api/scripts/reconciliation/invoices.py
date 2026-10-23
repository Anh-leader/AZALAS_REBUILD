"""FIX ĐỢT 2A — Reconcile invoices OLD (legacy) -> NEW (current).

Audit phát hiện "2 invoice finalize sau cutover chưa có ở NEW":
   121020260003, 151020260009

Thực tế (probe live): 2 invoice này KHÔNG bị thiếu — chúng đã được migrate ở
trạng thái DRAFT (lúc cutover OLD còn đang nháp), sau đó OLD finalize (DA_GUI).
NEW vẫn giữ DRAFT + số tiền cũ + chưa có status sent -> tab "Đã gửi đơn" lệch 2.

Chức năng module:
  * classify từng OLD DA_GUI invoice -> NEW state:
      - missing      : NEW chưa có hàng invoice nào -> plan insert đầy đủ
      - stale_draft  : NEW còn DRAFT, OLD đã DA_GUI -> plan finalize (update)
      - already_sent : NEW đã sent -> so amount; lệch thì audit-only (conflict)
      - conflict     : NEW bị user sửa sau finalize, hoặc status lạ
  * finalize đúng theo rule migration (status/subtotal/paid/balance/debt_after),
  * reconcile invoice_orders.amount theo OLD invoice_lines,
  * audit-only cho 111020260001 (surcharge 300) — KHÔNG tự sửa.

Dùng legacy_id_mapping (không dùng customer_code làm identity chính).

KHÔNG tự ghi production: chỉ ghi khi CLI chạy với --apply.
"""
from __future__ import annotations

import json
import uuid
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Engine

SENT_STATUSES = ("SENT", "PAID", "PARTIALLY_PAID")
DRAFT_STATUSES = ("DRAFT", "READY")
BLOCKING_NEW_STATUSES = ("DELETED", "VOID", "CANCELLED")


def _money_int(value: Any) -> int:
    if value is None:
        return 0
    d = Decimal(str(value))
    return int(d.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _as_str(value: Any) -> str | None:
    if value is None:
        return None
    return str(value).strip() or None


# --------------------------------------------------------------------------
# Target state (pure, mirror migration _apply_invoices/_apply_payments)
# --------------------------------------------------------------------------
def compute_target(old: dict, payments: list[dict]) -> dict:
    """Tính target NEW state cho một OLD DA_GUI invoice."""
    subtotal = _money_int(old.get("subtotal"))
    surcharge = 0
    return_credit = 0
    paid = 0
    for p in payments:
        method = str(p.get("method") or "").strip()
        amt = _money_int(p.get("amount"))
        if method == "CONG_THEM":
            surcharge += amt
        elif method == "HANG_TRA":
            return_credit += amt
        else:
            paid += amt
    balance = max(subtotal + surcharge - return_credit - paid, 0)
    if balance == 0:
        status = "PAID"
    elif paid or return_credit:
        status = "PARTIALLY_PAID"
    else:
        status = "SENT"
    return {
        "status": status,
        "subtotal_amount": subtotal,
        "surcharge_amount": surcharge,
        "return_credit_amount": return_credit,
        "paid_amount": paid,
        "balance_amount": balance,
        "issued_at": old.get("finalized_at") or old.get("created_at"),
        "captured_at": old.get("finalized_at"),
    }


def _link_amounts(old: dict, payments: list[dict], lines: list[dict], item_unit: dict) -> dict:
    """amount per unit_id (int) theo OLD invoice_lines -> order_items (per invoice)."""
    _ = old
    _ = payments
    amounts: dict = {}
    for ln in lines:
        unit_id = item_unit.get(ln.get("source_item_id"))
        if unit_id is None:
            continue
        amounts[unit_id] = amounts.get(unit_id, 0) + _money_int(ln.get("line_total"))
    return amounts


# --------------------------------------------------------------------------
# Plan
# --------------------------------------------------------------------------
def build_plan(
    old_invoices: dict[str, dict],
    old_payments: dict[str, list[dict]],
    old_links: dict[str, list],
    old_lines: dict[str, list[dict]],
    item_unit: dict,
    new_invoices: dict[str, dict],
    new_link_amounts: dict[str, dict] | None = None,
    order_units_map: dict[str, str] | None = None,
) -> dict:
    """So sánh OLD DA_GUI vs NEW và tính plan đồng bộ (không đụng DB).

    order_units_map: legacy unit_id (str) -> NEW order id (uuid str), từ
    legacy_id_mapping, để map invoice_lines -> invoice_orders.
    """
    new_link_amounts = new_link_amounts or {}
    order_units_map = order_units_map or {}
    source = sorted(code for code, o in old_invoices.items() if o.get("status") == "DA_GUI")

    missing: list[dict] = []
    already_sent: list[str] = []
    amount_mismatch: list[dict] = []
    will_finalize: list[dict] = []
    will_update_links: list[dict] = []
    conflicts: list[dict] = []

    for code in source:
        old = old_invoices[code]
        pays = old_payments.get(code, [])
        target = compute_target(old, pays)
        new = new_invoices.get(code)

        if new is None:
            link_amounts = _link_amounts(old, pays, old_lines.get(code, []), item_unit)
            missing.append({
                "invoice_code": code,
                "legacy_id": old.get("legacy_id"),
                "customer_id": old.get("customer_id"),
                "target": target,
                "link_unit_ids": old_links.get(code, []),
                "link_amounts": link_amounts,
                "payments": pays,
            })
            continue

        new_status = _as_str(new.get("status"))
        if new_status in SENT_STATUSES:
            already_sent.append(code)
            # amount reconciliation (audit-only; không tự sửa nếu lệch)
            new_total = _money_int(new.get("subtotal_amount")) + _money_int(new.get("surcharge_amount")) - _money_int(new.get("return_credit_amount"))
            old_total = target["subtotal_amount"] + target["surcharge_amount"] - target["return_credit_amount"]
            if new_total != old_total:
                amount_mismatch.append({
                    "invoice_code": code,
                    "old_total": old_total,
                    "new_total": new_total,
                    "new_breakdown": {
                        "subtotal": new.get("subtotal_amount"),
                        "surcharge": new.get("surcharge_amount"),
                        "return_credit": new.get("return_credit_amount"),
                    },
                    "note": "audit-only — chưa xác định business truth",
                })
            continue

        if new_status in BLOCKING_NEW_STATUSES:
            conflicts.append({"invoice_code": code, "reason": f"unexpected_new_status:{new_status}"})
            continue

        # DRAFT/READY hoặc status khác (chưa sent) -> có thể finalize.
        finalized_at = old.get("finalized_at")
        if finalized_at is None:
            conflicts.append({"invoice_code": code, "reason": "missing_finalized_at"})
            continue
        new_updated = new.get("updated_at")
        if new_updated is not None and _newer(new_updated, finalized_at):
            conflicts.append({
                "invoice_code": code, "reason": "modified_after_finalize",
                "new_status": new_status, "new_updated_at": new_updated,
                "old_finalized_at": finalized_at,
            })
            continue

        # Field-level diff cho finalize.
        debt_before = _money_int(new.get("debt_before_amount"))
        debt_after = debt_before + target["subtotal_amount"] + target["surcharge_amount"] - target["return_credit_amount"] - target["paid_amount"]
        fields = {
            "status": target["status"],
            "subtotal_amount": target["subtotal_amount"],
            "surcharge_amount": target["surcharge_amount"],
            "return_credit_amount": target["return_credit_amount"],
            "paid_amount": target["paid_amount"],
            "balance_amount": target["balance_amount"],
            "debt_after_amount": max(debt_after, 0),
            "issued_at": target["issued_at"],
            "captured_at": target["captured_at"],
        }
        diff = {k: v for k, v in fields.items() if _field_changed(k, v, new)}
        will_finalize.append({
            "invoice_code": code,
            "invoice_id": str(new.get("id") or ""),
            "legacy_id": old.get("legacy_id"),
            "new_status": new_status,
            "diff": diff,
        })

        # invoice_orders.amount reconcile (map legacy unit_id -> NEW order id).
        link_amounts = _link_amounts(old, pays, old_lines.get(code, []), item_unit)
        current = new_link_amounts.get(code, {})
        for unit_id, amt in link_amounts.items():
            new_order_id = order_units_map.get(str(unit_id))
            if new_order_id is None:
                continue
            cur = current.get(str(new_order_id))
            if cur is not None and cur != amt:
                will_update_links.append({
                    "invoice_code": code,
                    "invoice_id": str(new.get("id") or ""),
                    "order_id": str(new_order_id),
                    "old_amount": cur,
                    "new_amount": amt,
                })

    return {
        "source_missing_invoices": source,
        "already_exists": already_sent,
        "will_insert_invoices": missing,
        "will_insert_invoice_orders": [],
        "will_insert_payments": [],
        "will_insert_debt_entries": [],
        "will_finalize": will_finalize,
        "will_update_invoice_orders": will_update_links,
        "amount_mismatch": amount_mismatch,
        "conflicts": conflicts,
        "skipped": [],
    }


def _field_changed(key: str, target_value: Any, new: dict) -> bool:
    cur = new.get(key)
    if key == "status":
        return _as_str(cur) != _as_str(target_value)
    if key in ("issued_at", "captured_at"):
        # timestamp: so sánh theo chuẩn hóa string/None.
        if cur is None and target_value is None:
            return False
        return _as_str(cur) != _as_str(target_value)
    return _money_int(cur) != _money_int(target_value)


def _newer(a: Any, b: Any) -> bool:
    if a is None or b is None:
        return False
    try:
        return a > b
    except TypeError:
        from datetime import timezone
        a_utc = a.replace(tzinfo=timezone.utc) if a.tzinfo is None else a
        b_utc = b.replace(tzinfo=timezone.utc) if b.tzinfo is None else b
        return a_utc > b_utc


# --------------------------------------------------------------------------
# Readers (SELECT from OLD / NEW)
# --------------------------------------------------------------------------
def read_old_invoices(engine: Engine) -> dict[str, dict]:
    with engine.connect() as conn:
        rows = conn.execute(text(
            "SELECT id, invoice_code, customer_id, status, subtotal, invoice_image_path, "
            "finalized_at, created_at, old_debt_snapshot FROM invoices"
        )).mappings()
        out: dict[str, dict] = {}
        for r in rows:
            code = _as_str(r.get("invoice_code"))
            if not code:
                continue
            d = dict(r)
            d["legacy_id"] = r.get("id")
            out[code] = d
        return out


def read_old_payments(engine: Engine) -> dict[str, list[dict]]:
    with engine.connect() as conn:
        rows = conn.execute(text(
            "SELECT p.id, i.invoice_code, p.method, p.amount, p.payment_date, p.created_at "
            "FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id"
        )).mappings()
        out: dict[str, list[dict]] = {}
        for r in rows:
            code = _as_str(r.get("invoice_code"))
            if not code:
                continue
            out.setdefault(code, []).append(dict(r))
        return out


def read_old_links(engine: Engine) -> dict[str, list]:
    with engine.connect() as conn:
        rows = conn.execute(text(
            "SELECT i.invoice_code, l.unit_id FROM invoice_order_links l "
            "JOIN invoices i ON i.id = l.invoice_id"
        )).mappings()
        out: dict[str, list] = {}
        for r in rows:
            code = _as_str(r.get("invoice_code"))
            if code:
                out.setdefault(code, []).append(r.get("unit_id"))
        return out


def read_old_lines_and_item_unit(engine: Engine) -> tuple[dict[str, list[dict]], dict]:
    with engine.connect() as conn:
        lines = conn.execute(text(
            "SELECT i.invoice_code, l.source_item_id, l.line_total, l.product_name, "
            "l.quantity, l.unit_price FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id"
        )).mappings()
        items = conn.execute(text("SELECT id, unit_id FROM order_items")).mappings()
    lines_by: dict[str, list[dict]] = {}
    for r in lines:
        code = _as_str(r.get("invoice_code"))
        if code:
            lines_by.setdefault(code, []).append(dict(r))
    item_unit = {r.get("id"): r.get("unit_id") for r in items}
    return lines_by, item_unit


def read_new_invoices(engine: Engine) -> dict[str, dict]:
    with engine.connect() as conn:
        rows = conn.execute(text(
            "SELECT id, invoice_no, customer_id, status, subtotal_amount, surcharge_amount, "
            "return_credit_amount, paid_amount, balance_amount, debt_before_amount, debt_after_amount, "
            "issued_at, captured_at, updated_at FROM invoices"
        )).mappings()
        out: dict[str, dict] = {}
        for r in rows:
            code = _as_str(r.get("invoice_no"))
            if code:
                out[code] = dict(r)
        return out


def read_new_link_amounts(engine: Engine) -> dict[str, dict]:
    with engine.connect() as conn:
        rows = conn.execute(text(
            "SELECT i.invoice_no, io.order_id, io.amount FROM invoice_orders io "
            "JOIN invoices i ON i.id = io.invoice_id"
        )).mappings()
        out: dict[str, dict] = {}
        for r in rows:
            code = _as_str(r.get("invoice_no"))
            if code:
                out.setdefault(code, {})[str(r.get("order_id"))] = _money_int(r.get("amount"))
        return out


def read_legacy_mapping(engine: Engine) -> dict:
    """Map legacy_id -> new_uuid theo legacy_table (az_customers/order_units/invoices)."""
    with engine.connect() as conn:
        rows = conn.execute(text(
            "SELECT legacy_table, legacy_id, new_uuid FROM legacy_id_mapping "
            "WHERE legacy_table IN ('az_customers','order_units','invoices')"
        )).mappings()
    out: dict[str, dict] = {"az_customers": {}, "order_units": {}, "invoices": {}}
    for r in rows:
        t = r.get("legacy_table")
        if t in out:
            out[t][str(r.get("legacy_id"))] = r.get("new_uuid")
    return out


# --------------------------------------------------------------------------
# Apply (single transaction, idempotent)
# --------------------------------------------------------------------------
def apply_plan(engine: Engine, plan: dict) -> dict:
    updated = 0
    link_updated = 0
    with engine.begin() as conn:
        for item in plan.get("will_finalize", []):
            d = item["diff"]
            if not d:
                continue
            sets = [f"{_col(k)} = :{k}" for k in d]
            sets.append("updated_at = now()")
            params = {k: v for k, v in d.items()}
            params["id"] = item["invoice_id"]
            params["finalized_at"] = d.get("issued_at")
            res = conn.execute(text(
                f"UPDATE invoices SET {', '.join(sets)} "
                "WHERE id = CAST(:id AS uuid) AND status IN ('DRAFT','READY') "
                "AND updated_at <= :finalized_at "
                "RETURNING invoice_no"
            ), params)
            if res.fetchone():
                updated += 1
        for item in plan.get("will_update_invoice_orders", []):
            res = conn.execute(text(
                "UPDATE invoice_orders SET amount = :amt "
                "WHERE invoice_id = CAST(:iid AS uuid) AND order_id = CAST(:oid AS uuid) AND amount <> :amt "
                "RETURNING id"
            ), {"amt": item["new_amount"], "iid": item["invoice_id"], "oid": item["order_id"]})
            if res.fetchone():
                link_updated += 1
    return {"invoices_updated": updated, "invoice_orders_updated": link_updated}


def _col(key: str) -> str:
    # key đã là snake_case hợp lệ; tránh injection qua key.
    return key


# --------------------------------------------------------------------------
# Verify
# --------------------------------------------------------------------------
def sent_codes(old_invoices: dict[str, dict], new_invoices: dict[str, dict]) -> dict:
    old = {c for c, o in old_invoices.items() if o.get("status") == "DA_GUI"}
    new = {c for c, o in new_invoices.items() if _as_str(o.get("status")) in SENT_STATUSES}
    return {
        "sent_old": len(old),
        "sent_new": len(new),
        "only_old": sorted(old - new),
        "only_new": sorted(new - old),
        "mismatch_count": len((old - new) | (new - old)),
    }
