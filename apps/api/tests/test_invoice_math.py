"""Regression tests cho công thức công nợ hóa đơn (invoice_math).

Đảm bảo remaining_receivable = old_debt + invoice_total - received_amount (không âm),
KHÔNG được tính remaining chỉ từ invoice_total.
"""
from app.services.invoice_math import invoice_total, remaining_receivable, total_debt


def test_invoice_total_with_surcharge_and_return_credit():
    assert invoice_total(100000, 5000, 0) == 105000
    assert invoice_total(100000, 0, 20000) == 80000
    assert invoice_total(100000, 0, 150000) == 0  # không âm


def test_total_debt_adds_old_debt_and_invoice_total():
    assert total_debt(5227, 9) == 5236
    assert total_debt(500000, 100000) == 600000
    assert total_debt(None, 100000) == 100000


def test_remaining_case_a_no_old_debt():
    assert remaining_receivable(total_debt(0, 100000), 0) == 100000


def test_remaining_case_b_old_debt_no_payment():
    # HD2610210013084: invoice_total=9, old_debt=5227, received=0 => 5236 (KHÔNG được ra 9)
    assert remaining_receivable(total_debt(5227, 9), 0) == 5236


def test_remaining_case_c_partial_payment():
    assert remaining_receivable(total_debt(500000, 100000), 200000) == 400000


def test_remaining_case_d_paid_in_full():
    assert remaining_receivable(5236, 5236) == 0


def test_remaining_case_e_overpayment_clamps_to_zero():
    assert remaining_receivable(total_debt(500000, 100000), 600000) == 0


def test_remaining_case_h_multiple_payments_combined():
    received = 150000 + 50000
    assert remaining_receivable(total_debt(500000, 100000), received) == 400000
