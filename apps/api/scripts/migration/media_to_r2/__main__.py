"""CLI: python -m scripts.migration.media_to_r2 --dry-run | --apply | --resume | --verify-only.

Default action is --dry-run (read-only). --apply uploads legacy media to R2 and
marks them READY. --resume is equivalent to --apply but also retries FAILED rows.
--verify-only checks that READY rows exist on R2 and reports counts.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .config import Config, resolve
from .report import write_report
from .runner import MediaMigrator


def _fix_console() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        except Exception:  # noqa: BLE001
            pass


def _print_dict(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2, default=str))


def main(argv: list[str] | None = None) -> int:
    _fix_console()
    parser = argparse.ArgumentParser(description="AZALAS legacy media -> Cloudflare R2 migration")
    parser.add_argument("--dry-run", action="store_true", help="Chỉ đọc & báo cáo (mặc định)")
    parser.add_argument("--apply", action="store_true", help="Upload legacy media lên R2 & cập nhật DB")
    parser.add_argument("--resume", action="store_true", help="Như --apply nhưng cũng thử lại các row FAILED")
    parser.add_argument("--verify-only", action="store_true", help="Chỉ kiểm tra R2 + DB, không ghi")
    parser.add_argument("--probe", action="store_true", help="(dry-run) HEAD từng file legacy để phân loại thật")
    parser.add_argument("--from-date", dest="from_date", default=None, metavar="YYYY-MM-DD",
                        help="Incremental: chỉ media thuộc batch [from_date, to_date)")
    parser.add_argument("--to-date", dest="to_date", default=None, metavar="YYYY-MM-DD",
                        help="Incremental: đến trước ngày này (exclusive)")
    parser.add_argument("--media-id", dest="media_id", default=None,
                        help="Chẩn đoán 1 media (uuid) thay vì toàn bộ batch")
    parser.add_argument("--probe-download", action="store_true",
                        help="Với --media-id: download + checksum 1 media (read-only, không upload)")
    parser.add_argument("--probe-upload", action="store_true",
                        help="Với --media-id: download + upload test lên R2 (KHÔNG ghi DB)")
    parser.add_argument("--out", type=Path, default=Path("migration_reports"), help="Thư mục xuất báo cáo")
    args = parser.parse_args(argv)

    if args.media_id and not (args.probe_download or args.probe_upload):
        parser.error("--media-id cần --probe-download hoặc --probe-upload")
    if (args.probe_download or args.probe_upload) and not args.media_id:
        parser.error("--probe-download/--probe-upload cần --media-id")

    config: Config = resolve()

    if not config.new_database_url:
        print("Thiếu NEW_SUPABASE_DATABASE_URL / DATABASE_URL (env hoặc .env.production)")
        return 2

    if args.media_id:
        migrator = MediaMigrator(config)
        try:
            result = migrator.probe_single(args.media_id, upload=args.probe_upload)
        finally:
            migrator.close()
        _print_dict(result)
        print(f"PROBE {'OK' if result.get('ok') else 'FAILED'}"
              + (f" media={args.media_id} stage={result.get('stage')}" if not result.get('ok') else ""))
        return 0 if result.get("ok") else 1

    if args.verify_only:
        missing_r2 = config.missing_r2
        if missing_r2:
            print("Thiếu cấu hình R2: " + ", ".join(missing_r2))
            return 2
        migrator = MediaMigrator(config, from_date=args.from_date, to_date=args.to_date)
        try:
            result = migrator.verify()
        finally:
            migrator.close()
        _print_dict(result)
        print("VERIFY OK" if result["ok"] else "VERIFY FAILED")
        return 0 if result["ok"] else 1

    if args.apply or args.resume:
        missing_r2 = config.missing_r2
        missing_src = config.missing_legacy_source
        if missing_r2 or missing_src:
            problems = []
            if missing_r2:
                problems.append("R2: " + ", ".join(missing_r2))
            if missing_src:
                problems.append("legacy source: " + ", ".join(missing_src))
            print("ABORT — thiếu cấu hình:\n  " + "\n  ".join(problems))
            return 2

        migrator = MediaMigrator(config, from_date=args.from_date, to_date=args.to_date)
        try:
            stats = migrator.apply(resume=args.resume)
        finally:
            migrator.close()

        summary = stats.as_dict()
        _print_dict(summary)
        out_dir = write_report(
            args.out,
            mode="resume" if args.resume else "apply",
            payload=summary,
            failed=stats.failed_items,
            uploaded=stats.uploaded_items,
            duplicates=stats.deduplicated_items,
        )
        print(f"Báo cáo: {out_dir}")
        print(
            f"APPLY SUMMARY processed={stats.processed} uploaded={stats.uploaded} "
            f"deduplicated={stats.deduplicated} failed={stats.failed} bytes_uploaded={stats.bytes_uploaded}"
        )
        return 0 if stats.failed == 0 else 1

    # Default: DRY-RUN.
    migrator = MediaMigrator(config, from_date=args.from_date, to_date=args.to_date)
    try:
        result = migrator.dry_run(probe=args.probe)
    finally:
        migrator.close()

    _print_dict(result)
    out_dir = write_report(args.out, mode="dry-run", payload=result, failed=result.get("invalid_details", []))
    print(f"Báo cáo: {out_dir}")
    print(
        f"DRY RUN SUMMARY total={result['total']} downloadable={result['downloadable']} "
        f"missing={result['missing']} invalid_url={result['invalid_url']} "
        f"already_ready={result['already_ready']} duplicate_checksum={result['duplicate_checksum']} "
        f"estimated_bytes={result['estimated_bytes']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
