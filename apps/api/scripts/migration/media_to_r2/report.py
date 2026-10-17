"""Write media -> R2 migration reports to migration_reports/media_r2_<timestamp>/."""
from __future__ import annotations

import csv
import json
from datetime import datetime
from pathlib import Path


def write_report(
    report_dir: Path,
    *,
    mode: str,
    payload: dict,
    failed: list[dict] | None = None,
    uploaded: list[dict] | None = None,
    duplicates: list[dict] | None = None,
) -> Path:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    target = report_dir / f"media_r2_{stamp}"
    target.mkdir(parents=True, exist_ok=True)

    (target / "report.json").write_text(
        json.dumps({"mode": mode, **payload}, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )
    (target / "failed.json").write_text(
        json.dumps(failed or [], ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )
    _write_csv(target / "uploaded.csv",
               ["media_id", "legacy_object_key", "r2_object_key", "checksum", "size_bytes", "content_type"],
               uploaded or [])
    _write_csv(target / "duplicate.csv",
               ["media_id", "legacy_object_key", "r2_object_key", "checksum", "size_bytes"],
               duplicates or [])
    return target


def _write_csv(path: Path, fieldnames: list[str], rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({k: ("" if row.get(k) is None else row.get(k)) for k in fieldnames})
