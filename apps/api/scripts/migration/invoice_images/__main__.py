"""CLI: python -m scripts.migration.invoice_images --dry-run | --apply | --resume | --verify-only.

Mặc định là --dry-run (read-only). --apply tải + upload + ghi DB production.
--resume = --apply nhưng tiếp tục các lần chạy trước. --verify-only chỉ kiểm tra
R2 + DB, không ghi.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .config import Config, resolve
from .report import write_report
from .runner import InvoiceImageMigrator


def _fix_console() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        except Exception:  # noqa: BLE001
            pass


def _print_dict(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2, default=str))


def _plan_rows(items) -> list[dict]:
    return [{
        "old_invoice_id": it.old_invoice_id,
        "invoice_code": it.invoice_code,
        "image_path": it.image_path,
        "new_invoice_id": it.new_invoice_id,
        "new_invoice_no": it.new_invoice_no,
        "source_exists": it.source_exists,
        "source_size": it.source_size,
        "source_mimetype": it.source_mimetype,
        "source_md5": it.source_md5,
        "object_key": it.object_key,
        "already_on_r2": it.already_on_r2,
    } for it in items]


def main(argv: list[str] | None = None) -> int:
    _fix_console()
    parser = argparse.ArgumentParser(description="AZALAS invoice images -> Cloudflare R2 migration")
    parser.add_argument("--dry-run", action="store_true", help="Chỉ đọc & báo cáo (mặc định)")
    parser.add_argument("--apply", action="store_true", help="Tải + upload + ghi DB production")
    parser.add_argument("--resume", action="store_true", help="Như --apply, tiếp tục lần chạy trước")
    parser.add_argument("--verify-only", action="store_true", help="Chỉ kiểm tra R2 + DB, không ghi")
    parser.add_argument("--no-probe-r2", action="store_true",
                        help="(dry-run) không HEAD R2, chỉ phân loại theo DB")
    parser.add_argument("--out", type=Path, default=Path("migration_reports"), help="Thư mục xuất báo cáo")
    args = parser.parse_args(argv)

    config: Config = resolve()

    if not config.new_database_url:
        print("Thiếu DATABASE_URL (NEW)")
        return 2
    if not config.old_database_url:
        print("Thiếu OLD_SUPABASE_DATABASE_URL")
        return 2

    migrator = InvoiceImageMigrator(config)
    try:
        if args.verify_only:
            if config.missing_r2:
                print("Thiếu cấu hình R2: " + ", ".join(config.missing_r2))
                return 2
            result = migrator.verify()
            _print_dict(result)
            print("VERIFY OK" if result["ok"] else "VERIFY FAILED")
            return 0 if result["ok"] else 1

        if args.apply or args.resume:
            stats = migrator.apply(resume=args.resume)
            summary = stats.as_dict()
            _print_dict(summary)
            out_dir = write_report(args.out, mode="resume" if args.resume else "apply",
                                   payload=summary, failed=stats.failed_items)
            print(f"Báo cáo: {out_dir}")
            print(f"APPLY SUMMARY processed={stats.processed} uploaded={stats.uploaded} "
                  f"deduplicated={stats.deduplicated} reused={stats.reused} "
                  f"created_media={stats.created_media_objects} "
                  f"created_captures={stats.created_invoice_captures} "
                  f"set_media_id={stats.set_captured_invoice_media_id} failed={stats.failed}")
            return 0 if stats.failed == 0 else 1

        # Default: DRY-RUN
        result = migrator.dry_run(probe_r2=not args.no_probe_r2)
        _print_dict(result)
        items = migrator.build_plan()
        out_dir = write_report(
            args.out, mode="dry-run", payload=result,
            plan=_plan_rows(items),
            failed=result.get("conflict_details", []),
        )
        print(f"Báo cáo: {out_dir}")
        print(
            f"DRY RUN SUMMARY old_with_image={result['old_invoices_with_image']} "
            f"matches={result['new_invoice_matches']} "
            f"downloadable={result['source_downloadable']} "
            f"already_on_r2={result['already_on_r2']} will_upload={result['will_upload']} "
            f"missing_source={result['missing_source']} unmapped={result['unmapped_invoice']} "
            f"conflicts={result['conflicts']}"
        )
        return 0
    finally:
        migrator.close()


if __name__ == "__main__":
    sys.exit(main())
