"""Write invoice-image migration reports to migration_reports/invoice_images_<timestamp>/."""
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
    plan: list[dict] | None = None,
    failed: list[dict] | None = None,
) -> Path:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    target = report_dir / f"invoice_images_{stamp}"
    target.mkdir(parents=True, exist_ok=True)

    (target / "report.json").write_text(
        json.dumps({"mode": mode, **payload}, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )
    if plan:
        _write_csv(
            target / "plan.csv",
            ["old_invoice_id", "invoice_code", "image_path", "new_invoice_id", "new_invoice_no",
             "source_exists", "source_size", "source_mimetype", "source_md5",
             "object_key", "already_on_r2"],
            plan,
        )
    if failed:
        (target / "failed.json").write_text(
            json.dumps(failed, ensure_ascii=False, indent=2, default=str),
            encoding="utf-8",
        )
    return target


def _write_csv(path: Path, fieldnames: list[str], rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({k: ("" if row.get(k) is None else row.get(k)) for k in fieldnames})
