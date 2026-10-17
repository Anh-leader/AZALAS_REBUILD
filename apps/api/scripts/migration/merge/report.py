"""Ghi báo cáo merge ra report_dir/<timestamp>/."""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path


def write_merge_report(payload: dict, report_dir: Path) -> Path:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    target = report_dir / stamp
    target.mkdir(parents=True, exist_ok=True)
    (target / "merge_report.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return target
