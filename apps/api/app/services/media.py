"""Kho ảnh (gallery) — truy vấn ảnh đơn hàng đã persisted trong 10 ngày gần nhất.

Ánh xạ legacy ``getAllImagesLast10Days`` (Code.gs): nguồn là các ảnh của
``tbl_DonHang``, lọc theo ngày tạo đơn trong cửa sổ [hôm nay - days, hôm nay],
bỏ đơn đã xóa, gom theo ngày ``dd/MM/yyyy``. Trong hệ mới nguồn là
``media_objects`` liên kết qua ``order_media`` tới ``orders``.
"""

import io
import threading
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session, aliased

from ..core.errors import ApiError
from ..core.text import fold
from ..models import Customer, Invoice, InvoiceOrder, MediaObject, Order, OrderGroup, OrderMedia, User
from .storage import (
    get_storage_service,
    media_thumbnail_url,
    media_view_url,
    thumbnail_object_key,
)

TZ = ZoneInfo("Asia/Ho_Chi_Minh")

GALLERY_STATUS_BY_ORDER_STATUS = {
    "NEW": "NOT_PICKED",
    "PICKING": "PICKING",
    "PICKED": "PICKED",
    "DEBT_ORDER": "PICKED",
    "SHIPPING": "SENT",
    "COMPLETED": "SENT",
    "CANCELLED": "CANCELLED",
    "RETURNED": "SENT",
}
GALLERY_STATUS_PRIORITY = ("SENT", "PICKED", "PICKING", "NOT_PICKED", "CANCELLED")


def recent_images(
    db: Session, *, days: int = 10, sort: str = "desc", limit: int = 300, offset: int = 0
) -> tuple[list[dict], dict]:
    """Trả về danh sách ảnh gom theo ngày và meta phân trang.

    ``days`` là số ngày lịch trừ lùi tính từ hôm nay (giống legacy:
    ``today - days`` làm cận dưới, ngày hôm nay là cận trên).
    """
    days = max(1, min(int(days), 365))
    limit = max(1, min(int(limit), 1000))
    offset = max(0, int(offset))

    today = datetime.now(TZ).date()
    cutoff = today - timedelta(days=days)

    stmt = (
        select(MediaObject, Order, Customer.name)
        .join(OrderMedia, OrderMedia.media_id == MediaObject.id)
        .join(Order, Order.id == OrderMedia.order_id)
        .join(Customer, Customer.id == Order.customer_id)
        .where(MediaObject.status == "READY")
        .where(Order.status != "DELETED")
        .where(Order.created_date >= cutoff)
        .where(Order.created_date <= today)
    )
    rows = db.execute(stmt).all()

    # Dedup theo media_id: đơn "Tân Xuân và Cá Koi" sinh 2 order con cùng tham
    # chiếu một bộ ảnh, không được hiện một file hai lần.
    seen: set[uuid.UUID] = set()
    flat: list[dict] = []
    for media, order, customer_name in rows:
        if media.id in seen:
            continue
        seen.add(media.id)
        flat.append({
            "id": str(media.id),
            "order_id": str(order.id),
            "order_no": order.order_no,
            "customer_id": str(order.customer_id),
            "customer_name": customer_name,
            "order_date": order.created_date.isoformat(),
            "created_at": media.created_at.isoformat() if media.created_at else None,
            "url": media_view_url(media.id),
            "view_url": media_view_url(media.id),
        })

    # Sort theo ngày thật (không sort chuỗi dd/MM/yyyy).
    flat.sort(key=lambda x: (x["order_date"], x["created_at"] or ""), reverse=(sort != "asc"))

    total = len(flat)
    page = flat[offset:offset + limit]

    # Gom theo ngày, giữ nguyên thứ tự đã sort.
    grouped: dict[str, list[dict]] = {}
    for item in page:
        y, m, d = item["order_date"].split("-")
        label = f"{d}/{m}/{y}"
        grouped.setdefault(label, []).append(item)

    data = [
        {"date": label, "date_iso": items[0]["order_date"], "images": items}
        for label, items in grouped.items()
    ]
    meta = {
        "total": total,
        "limit": limit,
        "offset": offset,
        "next_offset": offset + limit if offset + limit < total else None,
    }
    return data, meta


def _gallery_datetime_key(value: datetime | None) -> float:
    if value is None:
        return float("-inf")
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.timestamp()


def customer_order_gallery(
    db: Session,
    *,
    days: int = 10,
    sort: str = "created_desc",
    q: str | None = None,
    date_filter: date | None = None,
    status: str | None = None,
    page: int = 1,
    page_size: int = 40,
) -> tuple[list[dict], dict]:
    """Return persisted customer-order images grouped once per order/group.

    Paginated at the card level: the number of database queries is fixed (one
    media/order fetch ordered in SQL plus one batched invoice lookup) and never
    scales with the number of images returned.
    """
    days = max(1, min(int(days), 365))
    page = max(1, int(page))
    page_size = max(1, min(int(page_size), 100))
    offset = (page - 1) * page_size
    today = datetime.now(TZ).date()
    cutoff = today - timedelta(days=days)
    if status and status not in set(GALLERY_STATUS_BY_ORDER_STATUS.values()):
        raise ApiError(422, "INVALID_GALLERY_STATUS", "Trạng thái lọc Kho ảnh không hợp lệ.")

    creator = aliased(User)
    uploader = aliased(User)
    stmt = (
        select(
            MediaObject.id,
            MediaObject.original_name,
            MediaObject.content_type,
            MediaObject.created_at,
            MediaObject.storage_provider,
            MediaObject.storage,
            MediaObject.bucket,
            MediaObject.object_key,
            Order.id,
            Order.order_no,
            Order.order_group_id,
            Order.created_date,
            Order.created_at,
            Order.customer_note,
            Order.status,
            Customer.id,
            Customer.name,
            Customer.customer_code,
            OrderGroup.group_no,
            OrderGroup.created_at,
            creator.display_name,
            uploader.display_name,
        )
        .select_from(MediaObject)
        .join(OrderMedia, OrderMedia.media_id == MediaObject.id)
        .join(Order, Order.id == OrderMedia.order_id)
        .join(Customer, Customer.id == Order.customer_id)
        .outerjoin(OrderGroup, OrderGroup.id == Order.order_group_id)
        .outerjoin(creator, creator.id == Order.created_by)
        .outerjoin(uploader, uploader.id == MediaObject.uploaded_by)
        .where(
            MediaObject.status == "READY",
            Order.status != "DELETED",
            Order.created_date >= cutoff,
            Order.created_date <= today,
        )
        .order_by(
            Order.created_at.desc() if sort == "created_desc" else Order.created_at.asc(),
            Order.order_no.asc(),
        )
    )
    if date_filter:
        stmt = stmt.where(Order.created_date == date_filter)

    # Reuse one storage client per provider for fast batched presigned URLs
    # (boto3 client construction is the expensive part; presign is local).
    storage_services: dict[str, object] = {}

    def _storage(provider: str):
        provider = provider or "local"
        svc = storage_services.get(provider)
        if svc is None:
            svc = get_storage_service(provider)
            storage_services[provider] = svc
        return svc

    grouped: dict[tuple[str, str], dict] = {}
    for row in db.execute(stmt).all():
        (
            media_id,
            original_name,
            content_type,
            media_created_at,
            storage_provider,
            legacy_storage,
            bucket,
            object_key,
            order_id,
            order_no,
            order_group_id,
            order_created_date,
            order_created_at,
            customer_note,
            order_status,
            customer_id,
            customer_name,
            customer_code,
            group_no,
            order_group_created_at,
            creator_name,
            uploader_name,
        ) = row
        group_key = ("group", str(order_group_id)) if order_group_id else ("order", str(order_id))
        card = grouped.get(group_key)
        if card is None:
            card = {
                "group_id": str(order_group_id or order_id),
                "customer_id": str(customer_id),
                "customer_name": customer_name,
                "customer_code": customer_code,
                "group_no": group_no,
                "date": order_created_date,
                "created_at": order_group_created_at if order_group_id else order_created_at,
                "notes": set(),
                "creators": set(),
                "orders": {},
                "images": {},
            }
            grouped[group_key] = card
        if order_created_date > card["date"]:
            card["date"] = order_created_date
        if customer_note:
            card["notes"].add(customer_note)
        if creator_name:
            card["creators"].add(creator_name)
        card["orders"][str(order_id)] = {
            "id": str(order_id),
            "order_no": order_no,
            "status": order_status,
            "created_at": order_created_at,
        }
        # Defer presigning: store the raw storage metadata now and sign only the
        # images that actually land on the current page (presign is per-object and
        # was the dominant cost when done for every media in the 10-day window).
        card["images"].setdefault(str(media_id), {
            "id": str(media_id),
            "url": media_view_url(media_id),
            "view_url": None,
            "thumbnail_url": None,
            "_storage_provider": storage_provider,
            "_legacy_storage": legacy_storage,
            "_bucket": bucket,
            "_object_key": object_key,
            "original_name": original_name,
            "content_type": content_type,
            "created_at": media_created_at.isoformat() if media_created_at else None,
            "uploaded_by_name": uploader_name,
        })

    query = fold(q)
    order_ids = [uuid.UUID(order_id) for card in grouped.values() for order_id in card["orders"]]
    invoice_numbers_by_order: dict[str, set[str]] = {}
    if order_ids:
        invoice_rows = db.execute(
            select(InvoiceOrder.order_id, Invoice.invoice_no)
            .join(Invoice, Invoice.id == InvoiceOrder.invoice_id)
            .where(InvoiceOrder.order_id.in_(order_ids))
        ).all()
        for order_id, invoice_no in invoice_rows:
            invoice_numbers_by_order.setdefault(str(order_id), set()).add(invoice_no)

    cards = []
    for card in grouped.values():
        order_rows = list(card["orders"].values())
        status_values = {
            GALLERY_STATUS_BY_ORDER_STATUS[row["status"]]
            for row in order_rows
            if row["status"] in GALLERY_STATUS_BY_ORDER_STATUS
        }
        gallery_status = next(
            (candidate for candidate in GALLERY_STATUS_PRIORITY if candidate in status_values),
            "NOT_PICKED",
        )
        images = list(card["images"].values())
        order_numbers = sorted(row["order_no"] for row in order_rows)
        invoice_numbers = sorted({
            invoice_no
            for row in order_rows
            for invoice_no in invoice_numbers_by_order.get(row["id"], set())
        })
        created_at = card["created_at"] or min(
            (row["created_at"] for row in order_rows if row["created_at"]),
            key=_gallery_datetime_key,
            default=None,
        )
        created_by_names = sorted(card["creators"])
        note = " · ".join(sorted(card["notes"]))
        date_iso = card["date"].isoformat()
        searchable = fold(" ".join([
            card["customer_name"],
            card["customer_code"],
            card["group_no"] or "",
            " ".join(order_numbers),
            " ".join(invoice_numbers),
            note,
            " ".join(created_by_names),
            " ".join(image["uploaded_by_name"] or "" for image in images),
            date_iso,
            card["date"].strftime("%d/%m/%Y"),
        ]))
        if query and query not in searchable:
            continue
        if status and gallery_status != status:
            continue
        orders = sorted(order_rows, key=lambda row: row["order_no"])
        cards.append({
            "group_id": card["group_id"],
            "order_id": orders[0]["id"],
            "order_ids": [row["id"] for row in orders],
            "order_no": ", ".join(order_numbers),
            "order_numbers": order_numbers,
            "invoice_numbers": invoice_numbers,
            "customer_id": card["customer_id"],
            "customer_name": card["customer_name"],
            "customer_code": card["customer_code"],
            "created_at": created_at.isoformat() if created_at else None,
            "order_date": date_iso,
            "note": note,
            "status": gallery_status,
            "created_by_names": created_by_names,
            "image_count": len(images),
            "images": images,
        })

    cards.sort(
        key=lambda row: (_gallery_datetime_key(
            datetime.fromisoformat(row["created_at"]) if row["created_at"] else None
        ), row["order_no"]),
        reverse=(sort == "created_desc"),
    )
    summary = {
        "orders_with_images": len(cards),
        "total_images": sum(card["image_count"] for card in cards),
    }
    total = len(cards)
    page_cards = cards[offset:offset + page_size]

    # Presign only the current page's images (thumbnail + full-size), leaving the
    # original object untouched and avoiding hundreds of discarded signed URLs.
    for card in page_cards:
        for img in card["images"]:
            provider = (img.pop("_storage_provider") or "").lower()
            legacy_storage = img.pop("_legacy_storage")
            bucket = img.pop("_bucket")
            object_key = img.pop("_object_key")
            if provider == "s3" or (not provider and legacy_storage == "S3"):
                provider = "s3"
            storage = _storage(provider)
            signer = getattr(storage, "signed_url", None)
            if signer is None:
                img["view_url"] = img["url"]
                img["thumbnail_url"] = media_thumbnail_url(img["id"])
            else:
                img["view_url"] = signer(bucket=bucket, object_key=object_key)
                img["thumbnail_url"] = signer(bucket=bucket, object_key=thumbnail_object_key(object_key))

    by_date: dict[str, list[dict]] = {}
    for card in page_cards:
        by_date.setdefault(card["order_date"], []).append(card)
    data = [
        {
            "date": datetime.strptime(date_iso, "%Y-%m-%d").strftime("%d/%m/%Y"),
            "date_iso": date_iso,
            "orders": orders,
        }
        for date_iso, orders in by_date.items()
    ]
    has_more = offset + page_size < total
    return data, {
        "summary": summary,
        "total": total,
        "page": page,
        "page_size": page_size,
        "has_more": has_more,
        "next_page": page + 1 if has_more else None,
    }


# --- Thumbnail rendering ----------------------------------------------------
#
# Thumbnails are stored as a derived R2 object ``<original>.thumb.webp`` with an
# immutable Cache-Control header. The first request generates and persists the
# thumbnail; every later request (any user/device) is served by R2/CDN directly,
# with no backend resize and no full-object download.
_THUMB_CACHE: dict[tuple[str, int], tuple[float, bytes]] = {}
_THUMB_LOCK = threading.Lock()
_THUMB_TTL_SECONDS = 15 * 60
_THUMB_MAX_ENTRIES = 256
THUMB_CACHE_CONTROL = "public, max-age=31536000, immutable"


def resize_to_webp(data: bytes, *, max_width: int = 400) -> tuple[bytes, str] | None:
    """Resize raw image bytes to a WebP thumbnail. Returns None for non-images."""
    try:
        from PIL import Image
    except ImportError:  # pragma: no cover - dependency is declared
        return None

    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except Exception:  # noqa: BLE001 - corrupt/unreadable or non-image bytes
        return None

    if image.mode not in ("RGB", "L"):
        image = image.convert("RGB")
    image.thumbnail((max_width, max_width))
    buffer = io.BytesIO()
    image.save(buffer, format="WEBP", quality=80, method=4)
    return buffer.getvalue(), "image/webp"


def ensure_thumbnail_object(media: MediaObject, *, max_width: int = 400) -> bytes | None:
    """Generate + persist a thumbnail object if it does not exist, return bytes.

    Returns the cached thumbnail bytes on success, or None if the media is not a
    supported image (e.g. PDF). The original object is never modified.
    """
    if not (media.content_type or "").startswith("image/"):
        return None

    provider = (media.storage_provider or "").lower()
    if provider == "s3" or (not provider and media.storage == "S3"):
        provider = "s3"
    thumb_key = thumbnail_object_key(media.object_key)

    storage = get_storage_service(provider or "local")
    if provider == "r2":
        # If the immutable thumbnail object already exists, reuse it.
        if storage.exists(bucket=media.bucket, object_key=thumb_key):
            with _THUMB_LOCK:
                cached = _THUMB_CACHE.get((str(media.id), max_width))
            return cached[1] if cached else None

        data = storage.read(bucket=media.bucket, object_key=media.object_key)
        resized = resize_to_webp(data, max_width=max_width)
        if resized is None:
            return None
        payload, mime = resized
        storage.put(object_key=thumb_key, data=payload, content_type=mime, cache_control=THUMB_CACHE_CONTROL)
        with _THUMB_LOCK:
            if len(_THUMB_CACHE) >= _THUMB_MAX_ENTRIES:
                _THUMB_CACHE.clear()
            _THUMB_CACHE[(str(media.id), max_width)] = (time.monotonic(), payload)
        return payload

    # Local/legacy: no persisted thumbnail object; serve from memory only.
    data = storage.read(bucket=media.bucket, object_key=media.object_key)
    return (resize_to_webp(data, max_width=max_width) or (None,))[0]


def media_thumbnail_bytes(media: MediaObject, *, max_width: int = 400) -> tuple[bytes, str]:
    """Return (bytes, content_type) for a resized thumbnail of an image."""
    if not (media.content_type or "").startswith("image/"):
        raise ApiError(415, "NOT_AN_IMAGE", "Không thể tạo thumbnail cho file không phải ảnh.")

    max_width = max(80, min(int(max_width), 1200))
    key = (str(media.id), max_width)
    with _THUMB_LOCK:
        cached = _THUMB_CACHE.get(key)
        if cached is not None and time.monotonic() - cached[0] < _THUMB_TTL_SECONDS:
            return cached[1], "image/webp"

    payload = ensure_thumbnail_object(media, max_width=max_width)
    if payload is None:
        raise ApiError(415, "UNSUPPORTED_IMAGE", "Không thể đọc ảnh để tạo thumbnail.")
    return payload, "image/webp"
