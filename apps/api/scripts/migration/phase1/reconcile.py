"""Đối soát công nợ: source tbl_CongNo_TongHop vs target DebtLedgerEntry.

Quy tắc:
- Nguồn sự thật target = SUM(debt_ledger_entries.amount_delta) theo customer.
- Nguồn chính để đối soát = tbl_CongNo_TongHop (SoNo/NoHienTai).
- Nếu lệch -> đề xuất opening adjustment (entry_type=ADJUSTMENT) để đưa về khớp.
- Không tự ghi; chỉ báo cáo. Apply sẽ tạo adjustment riêng khi user xác nhận.
"""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Customer, DebtLedgerEntry
from . import mappings
from .source import SourceSheet, money_int


def compute_target_debt(db: Session) -> dict[str, int]:
    """Debt hiện có trong ledger (chưa tính dữ liệu nguồn sắp import)."""
    rows = db.execute(
        select(DebtLedgerEntry.party_id, func.sum(DebtLedgerEntry.amount_delta))
        .where(DebtLedgerEntry.party_type == "CUSTOMER")
        .group_by(DebtLedgerEntry.party_id)
    ).all()
    codes = {cid: code for code, cid in db.execute(select(Customer.customer_code, Customer.id)).all()}
    return {codes[cid]: int(total) for cid, total in rows if cid in codes}


def _source_ledger_delta(ledger_sheet: SourceSheet | None, customer_code: str) -> int:
    """Tổng delta sẽ được import cho 1 khách từ tbl_NhatKyNo (mô phỏng post-import)."""
    if not ledger_sheet:
        return 0
    total = 0
    for row in ledger_sheet.rows:
        if row.values.get("customer_code") != customer_code:
            continue
        entry_type = mappings.map_debt_entry_type(row.values.get("entry_type"))
        if entry_type is None:
            continue
        amount = money_int(row.values.get("amount"), sheet=ledger_sheet.sheet, row=row.row_number, field="SoTien")
        signed = amount if entry_type not in mappings.DEBT_DECREASING_TYPES else -amount
        total += signed
    return total


def debt_reconciliation(
    db: Session,
    ledger_sheet: SourceSheet | None,
    summary_sheet: SourceSheet,
) -> list[dict]:
    target = compute_target_debt(db)
    result: list[dict] = []
    for row in summary_sheet.rows:
        customer_code = row.values.get("customer_code")
        if not customer_code:
            continue
        source_debt = money_int(row.values.get("debt"), sheet=summary_sheet.sheet, row=row.row_number, field="SoNo")
        target_debt = target.get(customer_code, 0) + _source_ledger_delta(ledger_sheet, customer_code)
        diff = source_debt - target_debt
        result.append({
            "customer_code": customer_code,
            "source_debt": source_debt,
            "target_calculated_debt": target_debt,
            "difference": diff,
            "proposed_adjustment": -diff,
            "ok": diff == 0,
        })
    return result


def reconciliation_summary(rows: list[dict]) -> dict:
    return {
        "source_customer_count": len(rows),
        "source_total_debt": sum(r["source_debt"] for r in rows),
        "reconciled_count": sum(1 for r in rows if r["ok"]),
        "difference_count": sum(1 for r in rows if not r["ok"]),
        "total_difference": sum(r["difference"] for r in rows),
    }
