"""Mapping tập trung: Google Sheet -> target table -> column -> transform -> validate.

KHÔNG tự đoán target table. Mỗi nhóm mapping ghi rõ cột nguồn, cột đích và
transform. Status/type không map được sẽ vào UNMAPPED_STATUS để báo cáo, không
ép giá trị.

Legacy identifiers (bảo toàn tuyệt đối):
- MaKhachHang -> customers.customer_code (unique)
- MaHoaDon      -> orders.order_no          (unique)
- MaAnh         -> media_objects.object_key (key dạng "legacy:<MaAnh>")
"""
from __future__ import annotations

from app.import_customers import _header_key  # reuse normalizer

# --------------------------------------------------------------------------
# 1. Warehouse: KhoXuat / Kho -> warehouses.code
# --------------------------------------------------------------------------
WAREHOUSE_MAP: dict[str, str] = {
    "tanxuan": "TAN_XUAN",
    "tan xuan": "TAN_XUAN",
    "khotx": "TAN_XUAN",
    "cakoi": "CA_KOI",
    "ca koi": "CA_KOI",
    "khock": "CA_KOI",
}

DEFAULT_WAREHOUSE_CODE = "TAN_XUAN"


def map_warehouse(value: str | None) -> str | None:
    if not value:
        return None
    key = _header_key(value)
    if key in WAREHOUSE_MAP:
        return WAREHOUSE_MAP[key]
    # Tên kho thật ("TÂN XUÂN", "CÁ KOI") — bình thường hóa để match.
    return WAREHOUSE_MAP.get(_header_key(value.replace(" ", "")), None)


# --------------------------------------------------------------------------
# 2. Order workflow status: TrangThai -> orders.status
# --------------------------------------------------------------------------
# Giá trị nguồn là tiếng Việt / mã legacy; chỉ map những gì chắc chắn.
ORDER_STATUS_MAP: dict[str, str] = {
    "moi": "NEW",
    "new": "NEW",
    "dangsoan": "PICKING",
    "picking": "PICKING",
    "dasoan": "PICKED",
    "picked": "PICKED",
    "danggiaohang": "SHIPPING",
    "shipping": "SHIPPING",
    "dagiao": "COMPLETED",
    "completed": "COMPLETED",
    "no": "DEBT_ORDER",
    "nodon": "DEBT_ORDER",
    "debt": "DEBT_ORDER",
    "huy": "CANCELLED",
    "cancelled": "CANCELLED",
    "dahuy": "CANCELLED",
    "xoa": "DELETED",
    "deleted": "DELETED",
    "hangtra": "RETURNED",
    "returned": "RETURNED",
}

# --------------------------------------------------------------------------
# 3. Billing status: TrangThaiHoaDon -> orders.billing_status
# --------------------------------------------------------------------------
BILLING_STATUS_MAP: dict[str, str] = {
    "draft": "DRAFT",
    "nhap": "DRAFT",
    "chuagui": "DRAFT",
    "ready": "READY",
    "sansang": "READY",
    "sent": "SENT",
    "dagui": "SENT",
    "paid": "PAID",
    "dathanhtoan": "PAID",
    "partial": "PARTIALLY_PAID",
    "thanhtoanmotphan": "PARTIALLY_PAID",
}


def map_status(value: str | None, table: dict[str, str]) -> str | None:
    if not value:
        return None
    return table.get(_header_key(value))


# --------------------------------------------------------------------------
# 4. Order type: KieuDon / LoaiDon -> orders.order_type
# --------------------------------------------------------------------------
ORDER_TYPE_MAP: dict[str, str] = {
    "khachdat": "CUSTOMER_ORDER",
    "khachhangdat": "CUSTOMER_ORDER",
    "customer": "CUSTOMER_ORDER",
    "customer_order": "CUSTOMER_ORDER",
    "thuong": "NORMAL",
    "normal": "NORMAL",
}

# KenhBan -> orders.source_channel (giữ nguyên nếu hợp lệ, else ZALO)
SOURCE_CHANNEL_MAP: dict[str, str] = {
    "zalo": "ZALO",
    "facebook": "FACEBOOK",
    "shopee": "SHOPEE",
    "tiktok": "TIKTOK",
    "offline": "OFFLINE",
    "ch": "OFFLINE",
}


def map_order_type(value: str | None) -> str | None:
    return map_status(value, ORDER_TYPE_MAP)


def map_source_channel(value: str | None) -> str:
    if not value:
        return "ZALO"
    return SOURCE_CHANNEL_MAP.get(_header_key(value), value.strip().upper())


# --------------------------------------------------------------------------
# 5. Debt ledger entry_type: tbl_NhatKyNo (loại phát sinh) -> entry_type
# --------------------------------------------------------------------------
DEBT_ENTRY_TYPE_MAP: dict[str, str] = {
    "hoadon": "INVOICE",
    "invoice": "INVOICE",
    "no": "INVOICE",
    "tanggiam": "ADJUSTMENT",
    "dieuchinh": "ADJUSTMENT",
    "adjustment": "ADJUSTMENT",
    "thanhtoan": "PAYMENT",
    "payment": "PAYMENT",
    "tratien": "PAYMENT",
    "hangtra": "RETURN_CREDIT",
    "return": "RETURN_CREDIT",
    "phuthu": "SURCHARGE",
    "surcharge": "SURCHARGE",
}

# Hướng dấu của amount_delta (source có thể ghi nợ/có riêng hoặc 1 cột có dấu).
# entry "PAYMENT"/"RETURN_CREDIT" phải làm GIẢM nợ (amount_delta âm).
DEBT_DECREASING_TYPES = {"PAYMENT", "RETURN_CREDIT"}


def map_debt_entry_type(value: str | None) -> str | None:
    if not value:
        return None
    return DEBT_ENTRY_TYPE_MAP.get(_header_key(value))


# --------------------------------------------------------------------------
# 6. Payment: tbl_ThanhToanKhach -> payments
# --------------------------------------------------------------------------
PAYMENT_METHOD_MAP: dict[str, str] = {
    "tienmat": "CASH",
    "cash": "CASH",
    "chuyenkhoan": "BANK_TRANSFER",
    "bank": "BANK_TRANSFER",
    "ck": "BANK_TRANSFER",
    "zalo": "ZALO",
    "momo": "MOMO",
}


def map_payment_method(value: str | None) -> str:
    if not value:
        return "CASH"
    return PAYMENT_METHOD_MAP.get(_header_key(value), "CASH")


# --------------------------------------------------------------------------
# 7. Customer status
# --------------------------------------------------------------------------
def map_customer_status(value: str | None) -> tuple[str, bool]:
    """Trả (status, deleted). Không đoán: mặc định ACTIVE, chỉ INACTIVE/DELETED khi rõ."""
    key = _header_key(value)
    if key in {"daxoa", "deleted"}:
        return "INACTIVE", True
    if key in {"ngungmua", "inactive", "locked", "khoa"}:
        return "INACTIVE", False
    return "ACTIVE", False


# --------------------------------------------------------------------------
# 8. Media: tbl_DonHang_AnhZalo -> media_objects
# --------------------------------------------------------------------------
# Phase này CHƯA upload R2: chỉ tạo metadata. object_key giữ legacy id, Drive link
# được đưa vào report sidecar để phase R2 dùng.
MEDIA_LEGACY_PROVIDER = "google_drive"
MEDIA_LEGACY_STORAGE = "LEGACY_DRIVE"


def legacy_media_key(ma_anh: str) -> str:
    return f"legacy:{ma_anh}"


def guess_content_type(original_name: str | None) -> str:
    if original_name:
        low = original_name.lower()
        if low.endswith(".png"):
            return "image/png"
        if low.endswith(".webp"):
            return "image/webp"
    return "image/jpeg"


def is_drive_link(value: str | None) -> bool:
    if not value:
        return False
    return "drive.google.com" in value or "docs.google.com" in value
