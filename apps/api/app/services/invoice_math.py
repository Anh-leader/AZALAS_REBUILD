"""Công thức công nợ hóa đơn — pure functions, single source of truth.

Nghiệp vụ:
    invoice_total   = subtotal + surcharge - return_credit      (chỉ tiền hóa đơn hiện tại)
    received_amount = tổng tiền đã thu cho hóa đơn này
    total_debt      = old_debt + invoice_total                 (nợ cũ + hóa đơn hiện tại)
    remaining       = total_debt - received_amount             (không âm)

Tuyệt đối KHÔNG tính remaining chỉ từ invoice_total: nợ cũ của khách vẫn phải thu.
"""
from __future__ import annotations

from typing import Any


def _as_int(value: Any) -> int:
    if value is None:
        return 0
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return 0


def invoice_total(subtotal: Any, surcharge: Any = 0, return_credit: Any = 0) -> int:
    """Tổng tiền của riêng hóa đơn hiện tại (chưa gồm nợ cũ)."""
    return max(_as_int(subtotal) + _as_int(surcharge) - _as_int(return_credit), 0)


def total_debt(old_debt: Any, invoice_total_amount: Any) -> int:
    """TỔNG NỢ = NỢ CŨ + TỔNG ĐƠN HÀNG."""
    return _as_int(old_debt) + _as_int(invoice_total_amount)


def remaining_receivable(total_debt_amount: Any, received_amount: Any) -> int:
    """CÒN LẠI PHẢI THU = TỔNG NỢ - TIỀN NHẬN (không âm)."""
    return max(_as_int(total_debt_amount) - _as_int(received_amount), 0)
