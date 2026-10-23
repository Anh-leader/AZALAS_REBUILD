"""Write R2 reorganize migration reports to migration_reports/r2_reorganize_<ts>/."""
from __future__ import annotations

import csv
import json
from datetime import datetime
from pathlib import Path


def _write_csv(path: Path, fieldnames: list[str], rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({k: ("" if row.get(k) is None else row.get(k)) for k in fieldnames})


PLAN_FIELDS = [
    "media_id", "category", "business_code", "old_key", "new_key",
    "thumbnail_old_key", "thumbnail_new_key", "size_bytes", "created_at",
    "business_date", "status",
]


def write_dry_run(report_dir: Path, payload: dict, plan: list[dict], conflicts: list[dict] | None = None) -> Path:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    target = report_dir / f"r2_reorganize_{stamp}"
    target.mkdir(parents=True, exist_ok=True)
    (target / "report.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, default=str), encoding="utf-8"
    )
    _write_csv(target / "plan.csv", PLAN_FIELDS, plan)
    _write_csv(
        target / "conflicts.csv",
        ["media_id", "category", "business_code", "conflict_category", "conflict_business_code"],
        conflicts or [],
    )
    return target


def write_apply(report_dir: Path, payload: dict, mapping: list[dict], failed: list[dict]) -> Path:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    target = report_dir / f"r2_reorganize_{stamp}"
    target.mkdir(parents=True, exist_ok=True)
    (target / "report.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, default=str), encoding="utf-8"
    )
    _write_csv(target / "mapping.csv",
               ["media_id", "old_key", "new_key", "size_bytes"], mapping)
    (target / "failed.json").write_text(
        json.dumps(failed, ensure_ascii=False, indent=2, default=str), encoding="utf-8"
    )
    return target


def write_cleanup_plan(report_dir: Path, plan: list[dict]) -> Path:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    target = report_dir / f"r2_reorganize_{stamp}"
    target.mkdir(parents=True, exist_ok=True)
    _write_csv(target / "cleanup_plan.csv", ["media_id", "old_key", "new_key"], plan)
    return target
