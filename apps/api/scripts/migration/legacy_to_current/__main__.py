"""CLI: python -m scripts.migration.legacy_to_current [--dry-run | --apply [--resume] | --verify-only]

Default (no flags) is DRY-RUN (read-only). --apply writes to NEW only after
pre-flight + dry-run gates pass. --resume skips the "target must be empty" check
and reuses the persisted legacy_id_mapping. --verify-only only checks NEW counts
and debt/invoice reconciliation without writing.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from .applier import Applier
from .runner import Runner
from .report import write_report


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


def _host(u: str) -> str:
    try:
        from urllib.parse import urlparse
        return urlparse(u).hostname or "?"
    except Exception:  # noqa: BLE001
        return "?"


def _resolve_urls(file_env: dict[str, str]) -> tuple[str, str]:
    old_url = os.environ.get("OLD_SUPABASE_DATABASE_URL") or file_env.get("OLD_SUPABASE_DATABASE_URL")
    new_url = (
        os.environ.get("NEW_SUPABASE_DATABASE_URL")
        or file_env.get("NEW_SUPABASE_DATABASE_URL")
        or file_env.get("SUPABASE_DATABASE_URL")
        or file_env.get("DATABASE_URL")
    )
    return old_url, new_url


def main(argv: list[str] | None = None) -> int:
    _fix_console()
    parser = argparse.ArgumentParser(description="AZALAS legacy -> current migration")
    parser.add_argument("--dry-run", action="store_true", help="Chỉ đọc & báo cáo (mặc định)")
    parser.add_argument("--apply", action="store_true", help="Ghi dữ liệu vào NEW (sau pre-flight + gates)")
    parser.add_argument("--resume", action="store_true", help="Bỏ qua kiểm tra 'target rỗng'; tái sử dụng legacy_id_mapping")
    parser.add_argument("--verify-only", action="store_true", help="Chỉ kiểm tra NEW (counts + debt + invoice), không ghi")
    parser.add_argument("--from-date", dest="from_date", default=None, metavar="YYYY-MM-DD",
                        help="Incremental: chỉ lấy dữ liệu từ ngày này (00:00 Asia/Ho_Chi_Minh, inclusive)")
    parser.add_argument("--to-date", dest="to_date", default=None, metavar="YYYY-MM-DD",
                        help="Incremental: đến trước ngày này (00:00 Asia/Ho_Chi_Minh, exclusive)")
    parser.add_argument("--out", type=Path, default=Path("migration_reports"), help="Thư mục xuất báo cáo")
    args = parser.parse_args(argv)

    repo_root = Path(__file__).resolve().parents[5]  # .../apps/api/scripts/migration/legacy_to_current
    file_env = _load_env_file(repo_root / ".env.production")

    old_url, new_url = _resolve_urls(file_env)
    if not old_url:
        print("Thiếu OLD_SUPABASE_DATABASE_URL (env hoặc .env.production)")
        return 2
    if not new_url:
        print("Thiếu NEW_SUPABASE_DATABASE_URL (env hoặc .env.production)")
        return 2

    if args.verify_only:
        applier = Applier(old_url, new_url, temp_password="", owner_temp_password="",
                          from_date=args.from_date, to_date=args.to_date)
        try:
            result = applier.verify()
        finally:
            applier.close()
        print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
        return 0 if result["ok"] else 1

    if args.apply:
        temp_password = os.environ.get("MIGRATION_TEMP_PASSWORD") or file_env.get("MIGRATION_TEMP_PASSWORD") or ""
        owner_temp_password = os.environ.get("MIGRATION_TEMP_PASSWORD_OWNER") or file_env.get("MIGRATION_TEMP_PASSWORD_OWNER") or ""
        applier = Applier(old_url, new_url, temp_password=temp_password, owner_temp_password=owner_temp_password,
                          from_date=args.from_date, to_date=args.to_date)
        try:
            mode = "APPLY" + ("+INCREMENTAL" if args.from_date else "")
            print(f"[legacy_to_current] OLD={_host(old_url)} NEW={_host(new_url)} mode={mode} resume={args.resume}")
            errors = applier.preflight(resume=args.resume)
            if errors:
                print("PREFLIGHT ABORT:")
                for e in errors:
                    print(f"  - {e}")
                return 2

            payload, gates_ok = applier._dry_run_gates()
            if not gates_ok:
                print("DRY-RUN GATES FAILED — ABORT trước khi write:")
                sec = payload.get("sections", {})
                print(json.dumps({
                    "PAYMENTS.unmapped_method": sec.get("PAYMENTS", {}).get("unmapped_method"),
                    "ORDERS.unmapped_status": sec.get("ORDERS", {}).get("unmapped_status"),
                    "ORPHANS": len(payload.get("orphans", [])),
                    "DEBT.difference_count": sec.get("DEBT", {}).get("difference_count"),
                    "DEBT.old_total": sec.get("DEBT", {}).get("old_total"),
                    "DEBT.projected_new_total": sec.get("DEBT", {}).get("projected_new_total"),
                }, ensure_ascii=False, indent=2))
                return 2

            applier.run(resume=args.resume)
            print("\nAPPLY PHASES DONE:")
            for row in applier.log:
                print(json.dumps(row, ensure_ascii=False))

            print("\nPOST-APPLY VERIFICATION:")
            verification = applier.verify()
            print(json.dumps(verification, ensure_ascii=False, indent=2, default=str))
            if not verification["ok"]:
                return 1
            print("\nREADY FOR REAL APPLY: YES" if verification["ok"] else "READY FOR REAL APPLY: NO")
            return 0
        finally:
            applier.close()

    # Default: DRY-RUN (read-only).
    mode = "DRY-RUN" + ("+INCREMENTAL" if args.from_date else "")
    print(f"[legacy_to_current] OLD={_host(old_url)} NEW={_host(new_url)} mode={mode}")
    runner = Runner(old_url, new_url, from_date=args.from_date, to_date=args.to_date)
    try:
        payload = runner.run()
    finally:
        runner.close()

    out_dir = write_report(payload, args.out)
    print(f"[legacy_to_current] Báo cáo: {out_dir}")
    if payload.get("incremental"):
        inc = payload["incremental"]
        print(f"INCREMENTAL from={inc['from_date']} to={inc['to_date']} anchor_orders={inc['anchor_orders']}")
        print("MISSING_TIME_COLS=", json.dumps(inc.get("missing_time_cols", {}), ensure_ascii=False))
        print(json.dumps(inc["per_phase"], ensure_ascii=False, indent=2))
    print(json.dumps(payload["sections"], ensure_ascii=False, indent=2))
    print(f"ID_MAPPINGS={payload['id_map_count']}")
    print(f"UNMAPPED_STATUS={len(payload['unmapped_status'])} ORPHANS={len(payload['orphans'])} DEBT_DIFFERENCES={len(payload['debt_differences'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
