"""Ghi báo cáo migration ra migration_reports/<timestamp>/."""
from __future__ import annotations

import csv
import json
from datetime import datetime
from pathlib import Path

from .importer import Report
from .reconcile import reconciliation_summary


def write_report(report: Report, debt_rows: list[dict], out_dir: Path) -> Path:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    target_dir = out_dir / stamp
    target_dir.mkdir(parents=True, exist_ok=True)

    payload = report.as_dict()
    payload["debt_reconciliation"] = {
        "summary": reconciliation_summary(debt_rows),
        "rows": debt_rows,
    }

    (target_dir / "report.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # CSV: đối soát công nợ
    if debt_rows:
        with (target_dir / "debt_reconciliation.csv").open("w", encoding="utf-8-sig", newline="") as fh:
            writer = csv.DictWriter(
                fh,
                fieldnames=["customer_code", "source_debt", "target_calculated_debt", "difference", "proposed_adjustment", "ok"],
            )
            writer.writeheader()
            for row in debt_rows:
                writer.writerow(row)

    # CSV: media mapping cho phase R2
    if report.media_mapping:
        with (target_dir / "media_mapping.csv").open("w", encoding="utf-8-sig", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=["ma_anh", "media_id", "order_no", "drive_link", "uploader", "note", "created_at"])
            writer.writeheader()
            for row in report.media_mapping:
                writer.writerow(row)

    return target_dir
