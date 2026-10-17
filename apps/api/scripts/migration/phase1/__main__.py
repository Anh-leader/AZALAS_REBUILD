"""CLI Phase 1: python -m scripts.migration.phase1 --dry-run --source-dir <dir>

Mặc định DRY-RUN (chỉ đọc, không write). --apply phải được chỉ định rõ ràng.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from app.core.db import SessionLocal

from .importer import (
    Report,
    import_customers,
    import_debt_ledger,
    import_inventory,
    import_media,
    import_orders,
    import_payments,
)
from .reconcile import debt_reconciliation
from .report import write_report
from .source import (
    PHASE1_SHEETS,
    SHEET_CUSTOMERS,
    SHEET_DEBT_LEDGER,
    SHEET_DEBT_SUMMARY,
    SHEET_INVENTORY,
    SHEET_MEDIA,
    SHEET_ORDER_ITEMS,
    SHEET_ORDERS,
    SHEET_PAYMENTS,
    SHEET_STATUS_HISTORY,
    SHEET_VARIANTS,
    discover_sheets,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="AZALAS Phase 1 data migration (Google Sheets -> Supabase)")
    parser.add_argument("--source-dir", type=Path, required=True, help="Thư mục chứa file export .xlsx/.csv/.tsv")
    parser.add_argument("--dry-run", action="store_true", help="Chỉ đọc & báo cáo, KHÔNG write (mặc định)")
    parser.add_argument("--apply", action="store_true", help="Ghi dữ liệu thật vào DB (cần xác nhận rõ)")
    parser.add_argument("--out", type=Path, default=Path("migration_reports"), help="Thư mục xuất báo cáo")
    return parser


def _fix_console() -> None:
    # Console Windows cp1252 không encode được tiếng Việt có dấu.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        except Exception:  # noqa: BLE001
            pass


def main(argv: list[str] | None = None) -> int:
    _fix_console()
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.dry_run and args.apply:
        parser.error("Chỉ chọn MỘT trong --dry-run hoặc --apply")
    dry_run = not args.apply

    print(f"[phase1] source-dir={args.source_dir} mode={'DRY-RUN' if dry_run else 'APPLY'}")

    try:
        sheets = discover_sheets(args.source_dir, PHASE1_SHEETS.keys())
    except ValueError as exc:
        print(f"[phase1] LỖI: {exc}")
        return 2

    report = Report(dry_run=dry_run)

    # Dependencies ordering: customers -> orders/items/history -> debt/payments -> inventory -> media
    try:
        with SessionLocal() as db:
            if SHEET_CUSTOMERS.sheet in sheets:
                import_customers(db, sheets[SHEET_CUSTOMERS.sheet], report)

            if SHEET_ORDERS.sheet in sheets:
                import_orders(
                    db,
                    sheets[SHEET_ORDERS.sheet],
                    sheets.get(SHEET_ORDER_ITEMS.sheet),
                    sheets.get(SHEET_STATUS_HISTORY.sheet),
                    report,
                )

            if SHEET_DEBT_LEDGER.sheet in sheets:
                import_debt_ledger(db, sheets[SHEET_DEBT_LEDGER.sheet], report)
            if SHEET_PAYMENTS.sheet in sheets:
                import_payments(db, sheets[SHEET_PAYMENTS.sheet], report)

            if SHEET_INVENTORY.sheet in sheets:
                import_inventory(
                    db,
                    sheets.get(SHEET_VARIANTS.sheet),
                    sheets[SHEET_INVENTORY.sheet],
                    report,
                )

            if SHEET_MEDIA.sheet in sheets:
                import_media(db, sheets[SHEET_MEDIA.sheet], report)

            # Reconciliation (chỉ đọc, không write)
            debt_rows = []
            if SHEET_DEBT_SUMMARY.sheet in sheets:
                debt_rows = debt_reconciliation(
                    db,
                    sheets.get(SHEET_DEBT_LEDGER.sheet),
                    sheets[SHEET_DEBT_SUMMARY.sheet],
                )

            if dry_run:
                db.rollback()
            else:
                db.commit()
    except Exception as exc:  # noqa: BLE001 - báo cáo lỗi rõ cho operator
        report.errors.append(f"{type(exc).__name__}: {exc}")
        print(f"[phase1] LỖI KHÔNG MONG ĐỢI: {exc}")
        return 1

    out_dir = write_report(report, debt_rows, args.out)
    print(f"[phase1] {('DRY-RUN' if dry_run else 'APPLIED')} hoàn tất. Báo cáo: {out_dir}")
    print(json.dumps({k: v for k, v in report.sections.items()}, ensure_ascii=False, indent=2))
    if report.errors:
        print(f"[phase1] {len(report.errors)} lỗi:")
        for err in report.errors:
            print(f"  - {err}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
