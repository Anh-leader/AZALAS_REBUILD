"""Ghi báo cáo DRY-RUN ra migration_reports/<timestamp>/."""
from __future__ import annotations

import csv
import json
from datetime import datetime
from pathlib import Path


def _money_str(value) -> str:
    return f"{float(value):,.2f}"


def write_report(payload: dict, report_dir: Path) -> Path:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    target = report_dir / stamp
    target.mkdir(parents=True, exist_ok=True)

    (target / "report.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )

    (target / "payment_unmapped.json").write_text(
        json.dumps(payload.get("payment_unmapped", []), ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )
    (target / "debt_differences.json").write_text(
        json.dumps(payload.get("debt_details", []), ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )
    (target / "invoice_lines_reconciliation.json").write_text(
        json.dumps(payload.get("invoice_line_details", []), ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )
    (target / "media_classification.json").write_text(
        json.dumps(payload.get("media_classification", {}), ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )

    _write_csv(target / "id_mapping.csv",
               ["legacy_table", "legacy_id", "new_table", "new_uuid", "business_key"],
               payload.get("id_mapping", []))
    _write_csv(target / "debt_differences.csv",
               ["customer_id", "customer_code", "customer_name", "opening_debt",
                "invoice_effect", "slip_effect", "old_balance",
                "projected_new_balance", "difference"],
               payload.get("debt_details", []))
    _write_csv(target / "unmapped_status.csv",
               ["table", "legacy_id", "field", "raw"],
               payload.get("unmapped_status", []))
    _write_csv(target / "orphans.csv",
               ["table", "legacy_id", "unit_id"],
               payload.get("orphans", []))

    (target / "REPORT.md").write_text(_markdown(payload), encoding="utf-8")
    return target


def _write_csv(path: Path, fieldnames: list[str], rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({k: ("" if row.get(k) is None else row.get(k)) for k in fieldnames})


def _markdown(payload: dict) -> str:
    sec = payload.get("sections", {})
    lines: list[str] = ["# LEGACY -> CURRENT DRY-RUN REPORT", ""]

    inc = payload.get("incremental")
    if inc:
        lines += [
            "## INCREMENTAL RANGE",
            f"- from_date: {inc.get('from_date')}",
            f"- to_date: {inc.get('to_date')} (exclusive)",
            f"- anchor_orders: {inc.get('anchor_orders')}",
            f"- missing_time_cols: {json.dumps(inc.get('missing_time_cols', {}), ensure_ascii=False)}",
            "",
            "## INCREMENTAL PER-PHASE SUMMARY",
        ]
        lines.append("| phase | source_today | already_exists | will_insert | will_update | dependencies_added | skipped | failed |")
        lines.append("|---|---|---|---|---|---|---|---|")
        for phase, s in inc.get("per_phase", {}).items():
            lines.append(
                f"| {phase} | {s.get('source_today', 0)} | {s.get('already_exists', 0)} | "
                f"{s.get('will_insert', 0)} | {s.get('will_update', 0)} | "
                f"{s.get('dependencies_added', 0)} | {s.get('skipped', 0)} | {s.get('failed', 0)} |"
            )
        lines.append("")

    def kv(section: str, *keys: str) -> None:
        s = sec.get(section, {})
        lines.append(f"## {section}")
        for k in keys:
            lines.append(f"- {k}: {s.get(k, 0)}")
        lines.append("")

    kv("CUSTOMERS", "source_count", "mapped", "duplicate", "invalid")
    kv("ORDERS", "source_count", "mapped", "missing_customer", "unmapped_status")
    kv("ORDER_ITEMS", "source_count", "mapped", "orphan")
    kv("INVOICES", "source_count", "mapped", "invalid_link")
    kv("PAYMENTS", "source_count", "mapped", "unmapped_method")
    kv("DEBT", "customers_checked", "old_total", "projected_new_total", "difference_count")
    kv("RETURNS", "source_count", "mapped", "invalid", "unmapped_status")
    kv("WAREHOUSE", "source_count", "mapped")
    kv("PRODUCTION", "source_count", "mapped")
    kv("MATERIALS", "source_count", "mapped", "unmapped_category")
    kv("MEDIA", "source_count", "mapped", "missing_relation")
    kv("USERS", "source_count", "mapped", "invalid")
    kv("EMPLOYEES", "source_count", "mapped")

    lines += [
        "## UNMAPPED DATA",
        f"- unmapped_status: {len(payload.get('unmapped_status', []))}",
        f"- missing_customer: {len(payload.get('missing_customer', []))}",
        f"- missing_relation: {len(payload.get('missing_relation', []))}",
        f"- orphans: {len(payload.get('orphans', []))}",
        "",
        "## DEBT DIFFERENCES",
        f"- difference_count: {len(payload.get('debt_differences', []))}",
        "",
        "## ID MAPPING",
        f"- total mapped ids: {payload.get('id_map_count', 0)}",
        f"- persistent table design: {payload.get('id_mapping_table', 'legacy_id_mapping')}",
        "",
        "## RISKS",
    ]
    for r in payload.get("risks", []):
        lines.append(f"- {r}")

    lines += [
        "",
        "## READY FOR APPLY",
        _ready(payload),
        "",
    ]
    sec = payload.get("sections", {})
    lines += [
        "## READY GATE CHECKS",
        f"- PAYMENTS.unmapped_method == 0: {sec.get('PAYMENTS', {}).get('unmapped_method', 0) == 0}",
        f"- ORDERS.unmapped_status == 0: {sec.get('ORDERS', {}).get('unmapped_status', 0) == 0}",
        f"- ORPHANS == 0: {len(payload.get('orphans', [])) == 0}",
        f"- DEBT.difference_count == 0: {sec.get('DEBT', {}).get('difference_count', 0) == 0}",
        f"- DEBT.old_total == projected_new_total: {sec.get('DEBT', {}).get('old_total', 0) == sec.get('DEBT', {}).get('projected_new_total', 0)}",
    ]
    return "\n".join(lines)


def _ready(payload: dict) -> str:
    """Ready only when all gate conditions hold."""
    sec = payload.get("sections", {})
    checks = {
        "PAYMENTS.unmapped_method == 0": sec.get("PAYMENTS", {}).get("unmapped_method", 0) == 0,
        "ORDERS.unmapped_status == 0": sec.get("ORDERS", {}).get("unmapped_status", 0) == 0,
        "ORPHANS == 0": len(payload.get("orphans", [])) == 0,
        "DEBT.difference_count == 0": sec.get("DEBT", {}).get("difference_count", 0) == 0,
        "DEBT.old_total == projected_new_total": sec.get("DEBT", {}).get("old_total", 0) == sec.get("DEBT", {}).get("projected_new_total", 0),
    }
    return "YES" if all(checks.values()) else "NO"
