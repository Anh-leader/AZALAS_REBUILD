"""CLI: python -m scripts.migration.reorganize_r2_media [--dry-run | --apply | --resume | --verify-only | --cleanup-old].

Default is --dry-run (read-only). --apply copies old -> new and updates
media_objects.object_key; it NEVER deletes the old object. --cleanup-old deletes
old objects only after a successful apply+verify confirmed the new object exists
and the DB already points at it.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import SessionLocal
from app.services.storage import R2StorageService

from .report import write_apply, write_cleanup_plan, write_dry_run
from .runner import apply as run_apply
from .runner import build_dry_run, cleanup_old, verify


def _fix_console() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        except Exception:  # noqa: BLE001
            pass


def _print(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2, default=str))


def main(argv: list[str] | None = None) -> int:
    _fix_console()
    parser = argparse.ArgumentParser(description="AZALAS R2 media reorganize (orders/invoices/production/...)")
    parser.add_argument("--dry-run", action="store_true", help="Chỉ đọc & báo cáo (mặc định)")
    parser.add_argument("--apply", action="store_true", help="Copy old->new + cập nhật DB (KHÔNG xóa object cũ)")
    parser.add_argument("--resume", action="store_true", help="Như --apply (an toàn idempotent)")
    parser.add_argument("--verify-only", action="store_true", help="Kiểm tra DB key + R2 (không ghi)")
    parser.add_argument("--cleanup-old", action="store_true", help="Xóa object cũ SAU KHI verify ok (dry-run trước)")
    parser.add_argument("--no-probe", action="store_true", help="(dry-run) bỏ qua HEAD R2, chỉ dựa DB")
    parser.add_argument("--batch-size", type=int, default=100, help="Số media mỗi batch (apply)")
    parser.add_argument("--out", type=Path, default=Path("migration_reports"), help="Thư mục xuất báo cáo")
    args = parser.parse_args(argv)

    if args.cleanup_old and (args.apply or args.resume):
        parser.error("--cleanup-old không được chạy chung với --apply/--resume")
    if args.verify_only and (args.apply or args.resume or args.cleanup_old):
        parser.error("--verify-only không được chạy chung với --apply/--resume/--cleanup-old")

    storage = R2StorageService()
    db: Session = SessionLocal()

    try:
        if args.verify_only:
            result = verify(db, storage)
            payload = {
                "mode": "verify-only",
                "verified": result.verified,
                "missing_on_r2": result.missing_on_r2,
                "size_mismatch": result.size_mismatch,
                "checksum_mismatch": result.checksum_mismatch,
                "thumbnail_missing": result.thumbnail_missing,
                "db_mapping_mismatch": result.db_mapping_mismatch,
                "ok": result.ok,
            }
            _print(payload)
            print("VERIFY OK" if result.ok else "VERIFY FAILED")
            return 0 if result.ok else 1

        if args.apply or args.resume:
            result = run_apply(db, storage, batch_size=args.batch_size)
            payload = {
                "mode": "resume" if args.resume else "apply",
                "copied": result.copied,
                "skipped": result.skipped,
                "failed": result.failed,
                "bytes_copied": result.bytes_copied,
            }
            _print(payload)
            out_dir = write_apply(args.out, payload, result.mapping, result.failed_items)
            print(f"Báo cáo: {out_dir}")
            print(f"APPLY copied={result.copied} failed={result.failed} bytes={result.bytes_copied}")
            return 0 if result.failed == 0 else 1

        if args.cleanup_old:
            # Strictly require an existing apply manifest (mapping.csv) — cleanup
            # is only safe after a successful apply+verify. Without a manifest we
            # refuse to delete anything.
            mapping = _load_latest_mapping(args.out)
            if not mapping:
                print("Không tìm thấy apply manifest (mapping.csv). Chạy --apply trước, rồi --verify-only, rồi mới --cleanup-old.")
                return 2
            # Cleanup default is dry-run; --cleanup-old alone prints the plan.
            result = cleanup_old(db, storage, mapping, dry_run=True)
            payload = {"mode": "cleanup-old-dry-run", "would_delete": result.would_delete, "skipped": result.skipped}
            _print(payload)
            out_dir = write_cleanup_plan(args.out, result.plan)
            print(f"Báo cáo: {out_dir}")
            print(f"CLEANUP DRY-RUN would_delete={result.would_delete} skipped={result.skipped}")
            return 0

        # default dry-run
        result = build_dry_run(db, storage, probe=not args.no_probe)
        payload = {
            "mode": "dry-run",
            "total_media": result.total_media,
            "orders_count": result.orders_count,
            "orders_shared_count": result.orders_shared_count,
            "invoices_count": result.invoices_count,
            "production_count": result.production_count,
            "patterns_count": result.patterns_count,
            "partners_count": result.partners_count,
            "other_count": result.other_count,
            "legacy_media_count": result.legacy_media_count,
            "private_media_count": result.private_media_count,
            "will_copy": result.will_copy,
            "already_new_structure": result.already_new_structure,
            "missing_source": result.missing_source,
            "missing_thumbnail": result.missing_thumbnail,
            "conflicts": result.conflicts,
            "conflict_unresolved": result.conflict_unresolved,
            "unmapped": result.unmapped,
            "total_bytes_to_copy": result.total_bytes_to_copy,
        }
        _print(payload)
        out_dir = write_dry_run(args.out, payload, result.plan, result.conflict_rows)
        print(f"Báo cáo: {out_dir}")
        print(
            f"DRY RUN total={result.total_media} orders={result.orders_count} "
            f"orders_shared={result.orders_shared_count} "
            f"invoices={result.invoices_count} production={result.production_count} "
            f"patterns={result.patterns_count} partners={result.partners_count} other={result.other_count} "
            f"will_copy={result.will_copy} already_new={result.already_new_structure} "
            f"missing_source={result.missing_source} conflicts={result.conflicts} "
            f"conflict_unresolved={result.conflict_unresolved} "
            f"bytes_to_copy={result.total_bytes_to_copy}"
        )
        return 0
    finally:
        db.close()


def _load_latest_mapping(report_dir: Path) -> list[dict]:
    """Find the newest mapping.csv under report_dir and parse it."""
    candidates = sorted(report_dir.glob("r2_reorganize_*/mapping.csv"), reverse=True)
    if not candidates:
        return []
    import csv

    rows: list[dict] = []
    with candidates[0].open("r", encoding="utf-8-sig", newline="") as fh:
        for row in csv.DictReader(fh):
            rows.append(row)
    return rows


if __name__ == "__main__":
    sys.exit(main())
