"""CLI reconciliation OLD (legacy) -> NEW (current).

Subcommands (mỗi cái có --dry-run | --apply | --verify-only):
  deleted-orders   FIX ĐỢT 1 — backfill/sync billing_status=DELETED
  invoices         FIX ĐỢT 2A — finalize/reconcile sent invoices (stale DRAFT)

Mặc định (không subcommand) = deleted-orders (tương thích cũ).

KHÔNG tự ghi production: chỉ ghi khi chạy với --apply.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from sqlalchemy import create_engine

from . import deleted_orders as D
from . import invoices as I


def _fix_console() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        except Exception:  # noqa: BLE001
            pass


def _load_env_file(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def _find_repo_root() -> Path:
    p = Path(__file__).resolve().parent
    for _ in range(8):
        if (p / ".git").exists() or (p / ".env.production").exists():
            return p
        p = p.parent
    return Path(__file__).resolve().parents[4]


def _resolve_urls(file_env: dict[str, str]) -> tuple[str, str]:
    old_url = os.environ.get("OLD_SUPABASE_DATABASE_URL") or file_env.get("OLD_SUPABASE_DATABASE_URL")
    new_url = (
        os.environ.get("NEW_SUPABASE_DATABASE_URL")
        or file_env.get("NEW_SUPABASE_DATABASE_URL")
        or file_env.get("SUPABASE_DATABASE_URL")
        or file_env.get("DATABASE_URL")
    )
    return old_url, new_url


def _host(u: str) -> str:
    try:
        from urllib.parse import urlparse
        return urlparse(u).hostname or "?"
    except Exception:  # noqa: BLE001
        return "?"


def _add_common_flags(p: argparse.ArgumentParser) -> None:
    p.add_argument("--dry-run", action="store_true", help="Chỉ đọc & báo cáo (mặc định)")
    p.add_argument("--apply", action="store_true", help="Ghi vào NEW (idempotent)")
    p.add_argument("--verify-only", action="store_true", help="Chỉ so sánh theo business key")


def _run_deleted_orders(old_engine, new_engine, args) -> int:
    old_deleted = D.read_old_deleted(old_engine)
    new_orders = D.read_new_orders(new_engine)

    if args.verify_only:
        diff = D.compute_deleted_diff(list(old_deleted), D.new_deleted_eligible(new_orders))
        print(json.dumps(diff, ensure_ascii=False, indent=2, default=str))
        return 0 if diff["mismatch_count"] == 0 else 1

    linked = D.read_invoice_links(new_engine)
    plan = D.build_plan(old_deleted, new_orders, linked)

    if args.apply:
        result = D.apply_plan(new_engine, plan)
        new_after = D.read_new_orders(new_engine)
        diff = D.compute_deleted_diff(list(old_deleted), D.new_deleted_eligible(new_after))
        print("APPLY RESULT:", json.dumps(result, ensure_ascii=False, default=str))
        print("POST-APPLY VERIFY:", json.dumps(diff, ensure_ascii=False, indent=2, default=str))
        return 0

    print("DRY-RUN SUMMARY:", json.dumps({
        "source_deleted_old": len(plan["source_deleted_old"]),
        "already_correct": len(plan["already_correct"]),
        "will_backfill_billing_status": len(plan["will_backfill_billing_status"]),
        "will_sync_post_cutover": len(plan["will_sync_post_cutover"]),
        "conflicts": len(plan["conflicts"]),
        "skipped": len(plan["skipped"]),
        "to_update_total": len(plan["will_backfill_billing_status"]) + len(plan["will_sync_post_cutover"]),
    }, ensure_ascii=False, indent=2))
    print("PLAN:", json.dumps(plan, ensure_ascii=False, indent=2, default=str))
    diff = D.compute_deleted_diff(list(old_deleted), D.new_deleted_eligible(new_orders))
    print("CURRENT DIFF:", json.dumps(diff, ensure_ascii=False, indent=2, default=str))
    return 0


def _run_invoices(old_engine, new_engine, args) -> int:
    old_invoices = I.read_old_invoices(old_engine)
    new_invoices = I.read_new_invoices(new_engine)

    if args.verify_only:
        print(json.dumps(I.sent_codes(old_invoices, new_invoices), ensure_ascii=False, indent=2, default=str))
        return 0

    old_payments = I.read_old_payments(old_engine)
    old_links = I.read_old_links(old_engine)
    old_lines, item_unit = I.read_old_lines_and_item_unit(old_engine)
    new_link_amounts = I.read_new_link_amounts(new_engine)
    mapping = I.read_legacy_mapping(new_engine)
    order_units_map = {k: str(v) for k, v in mapping["order_units"].items()}
    plan = I.build_plan(old_invoices, old_payments, old_links, old_lines, item_unit,
                        new_invoices, new_link_amounts, order_units_map)

    if args.apply:
        result = I.apply_plan(new_engine, plan)
        new_after = I.read_new_invoices(new_engine)
        print("APPLY RESULT:", json.dumps(result, ensure_ascii=False, default=str))
        print("POST-APPLY VERIFY:", json.dumps(I.sent_codes(old_invoices, new_after), ensure_ascii=False, indent=2, default=str))
        return 0

    summary = {
        "source_missing_invoices": len(plan["source_missing_invoices"]),
        "already_exists": len(plan["already_exists"]),
        "will_insert_invoices": len(plan["will_insert_invoices"]),
        "will_insert_invoice_orders": len(plan["will_insert_invoice_orders"]),
        "will_insert_payments": len(plan["will_insert_payments"]),
        "will_insert_debt_entries": len(plan["will_insert_debt_entries"]),
        "will_finalize": len(plan["will_finalize"]),
        "will_update_invoice_orders": len(plan["will_update_invoice_orders"]),
        "amount_mismatch": len(plan["amount_mismatch"]),
        "conflicts": len(plan["conflicts"]),
        "skipped": len(plan["skipped"]),
    }
    print("DRY-RUN SUMMARY:", json.dumps(summary, ensure_ascii=False, indent=2))
    print("PLAN:", json.dumps(plan, ensure_ascii=False, indent=2, default=str))
    print("CURRENT SENT DIFF:", json.dumps(I.sent_codes(old_invoices, new_invoices), ensure_ascii=False, indent=2, default=str))
    return 0


def main(argv: list[str] | None = None) -> int:
    _fix_console()
    parser = argparse.ArgumentParser(description="AZALAS reconciliation (OLD -> NEW)")
    sub = parser.add_subparsers(dest="command")
    d_orders = sub.add_parser("deleted-orders", help="FIX ĐỢT 1 — deleted orders")
    _add_common_flags(d_orders)
    d_invoices = sub.add_parser("invoices", help="FIX ĐỢT 2A — invoices")
    _add_common_flags(d_invoices)
    # Backward-compatible top-level flags -> deleted-orders.
    _add_common_flags(parser)
    args = parser.parse_args(argv)

    command = args.command or "deleted-orders"

    repo_root = _find_repo_root()
    file_env = _load_env_file(repo_root / ".env.production")
    old_url, new_url = _resolve_urls(file_env)
    if not old_url:
        print("Thiếu OLD_SUPABASE_DATABASE_URL (env hoặc .env.production)")
        return 2
    if not new_url:
        print("Thiếu NEW_SUPABASE_DATABASE_URL (env hoặc .env.production)")
        return 2

    old_engine = create_engine(old_url, connect_args={"connect_timeout": 20})
    new_engine = create_engine(new_url, connect_args={"connect_timeout": 20})
    print(f"[reconcile.{command}] OLD={_host(old_url)} NEW={_host(new_url)}")

    if command == "invoices":
        return _run_invoices(old_engine, new_engine, args)
    return _run_deleted_orders(old_engine, new_engine, args)


if __name__ == "__main__":
    sys.exit(main())
