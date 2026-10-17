"""Mapping tập trung legacy schema -> current schema.

Nguyên tắc:
- Status không map được => UNMAPPED_STATUS (KHÔNG tự đoán).
- Business keys giữ nguyên: customer_code, order_code (order_no), invoice_code (invoice_no).
- Debt KHÔNG copy balance trực tiếp; projected debt được tính lại từ ledger.
"""
from __future__ import annotations

# Business keys
UNMAPPED_STATUS = "UNMAPPED_STATUS"

# --------------------------------------------------------------------------
# Status maps (legacy enum value -> current status)
# --------------------------------------------------------------------------
ORDER_STATUS_MAP: dict[str, str] = {
    "MOI": "NEW",
    "DANG_SOAN": "PICKING",
    "NO_DON": "DEBT_ORDER",
    "DA_SOAN": "PICKED",
    "DA_XOA": "DELETED",
}

INVOICE_STATUS_MAP: dict[str, str] = {
    "CHUA_CHOT": "DRAFT",
    "DA_GUI": "SENT",
    "DA_XOA": "DELETED",
}

RETURN_STATUS_MAP: dict[str, str] = {
    "CHUA_DUYET": "NEW",
    "DA_DUYET": "APPROVED",
    "DA_XOA": "CANCELLED",
}

# az_role enum values are identical to current users.role codes.
ROLE_MAP: dict[str, str] = {
    "OWNER": "OWNER",
    "ADMIN": "ADMIN",
    "KHO": "KHO",
    "KE_TOAN": "KE_TOAN",
    "NHAN_SU": "NHAN_SU",
    "MEMBER": "MEMBER",
}

ORDER_TYPE_MAP: dict[str, str] = {
    "THUONG": "NORMAL",
    "KHACH_DAT": "CUSTOMER_ORDER",
}

STAFF_STATUS_MAP: dict[str, str] = {
    "DANG_LAM": "ACTIVE",
    "DA_NGHI": "INACTIVE",
}

# supply_partners.category -> partners.partner_type
SUPPLY_CATEGORY_TO_PARTNER_TYPE: dict[str, str] = {
    "DAY_KEO": "ZIPPER_SUPPLIER",
    "THEU": "EMBROIDERY",
    "IN": "PRINTING",
    "VAI": "FABRIC_SUPPLIER",
}

# invoice_payments.method -> payments.method
PAYMENT_METHOD_MAP: dict[str, str] = {
    "CHUYEN_KHOAN": "BANK_TRANSFER",
    "TIEN_MAT": "CASH",
}

# invoice_payments.method -> debt_ledger_entries.entry_type (non-cash methods).
# Business rule (legacy az_invoice_finalize / az_customer_balance):
#   v_paid  = SUM(amount) WHERE method <> 'CONG_THEM'   -> reduces debt
#   v_extra = SUM(amount) WHERE method =  'CONG_THEM'   -> increases debt ("cộng thêm")
# So CONG_THEM is a surcharge line on the invoice, NOT a cash payment.
INVOICE_PAYMENT_DEBT_ENTRY_TYPE: dict[str, str] = {
    "CONG_THEM": "SURCHARGE",
    "HANG_TRA": "RETURN_CREDIT",
}

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
def map_or_unmapped(value: str | None, table: dict[str, str]) -> str:
    """Return the mapped value, or UNMAPPED_STATUS when the value is absent/unknown."""
    if value is None:
        return UNMAPPED_STATUS
    return table.get(str(value).strip(), UNMAPPED_STATUS)


def norm(value: str | None) -> str | None:
    """Normalize a nullable string (strip, empty -> None)."""
    if value is None:
        return None
    s = str(value).strip()
    return s or None
