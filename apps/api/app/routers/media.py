import hashlib
import re
import uuid
from datetime import date

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import RedirectResponse, Response
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.db import get_db
from ..core.deps import current_user, require_permission
from ..core.errors import ApiError
from ..core.rbac import has_permission
from ..models import (
    Invoice,
    InvoiceCapture,
    MediaObject,
    OrderMedia,
    PartnerFile,
    PartnerSettlement,
    PatternNote,
    ProductionBatchMedia,
    User,
)
from ..services import media as media_svc
from ..services.printing_partners import printing_partner
from ..services.storage import LegacyS3StorageService, R2StorageService, get_storage_service

router = APIRouter(prefix="/media", tags=["media"])

# Nhận dạng MIME từ magic bytes, không tin extension
MAGIC = {b"\xff\xd8\xff": ("image/jpeg", "jpg"), b"\x89PNG\r\n\x1a\n": ("image/png", "png"),
         b"%PDF-": ("application/pdf", "pdf")}


async def _store_upload(
    file: UploadFile,
    db: Session,
    user: User,
    *,
    module: str = "general",
    expected_content_type: str | None = None,
):
    data = await file.read(settings.max_upload_bytes + 1)
    if len(data) > settings.max_upload_bytes:
        raise ApiError(413, "FILE_TOO_LARGE", f"File vượt quá {settings.max_upload_mb}MB.")
    kind = next((v for k, v in MAGIC.items() if data.startswith(k)), None)
    if not kind and len(data) >= 12 and data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        kind = ("image/webp", "webp")
    if not kind:
        raise ApiError(415, "UNSUPPORTED_MEDIA", "Chỉ chấp nhận JPEG, PNG, WEBP hoặc PDF.")
    mime, ext = kind
    if expected_content_type and mime != expected_content_type:
        raise ApiError(415, "UNSUPPORTED_MEDIA", "Chỉ chấp nhận file PDF.")
    if mime != "application/pdf" and mime not in settings.allowed_image_type_set:
        raise ApiError(415, "UNSUPPORTED_MEDIA", "Loại ảnh này chưa được cho phép.")
    if file.content_type and file.content_type.lower() != mime:
        raise ApiError(415, "UNSUPPORTED_MEDIA", "Content-Type không khớp với nội dung file.")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,31}", module):
        raise ApiError(422, "INVALID_MEDIA_MODULE", "Tên module upload không hợp lệ.")
    media_id = uuid.uuid4()
    created_date = date.today()
    key = f"private-media/{module}/{created_date:%Y/%m}/{media_id}.{ext}"
    stored = get_storage_service().put(object_key=key, data=data, content_type=mime)
    legacy_storage = "S3" if stored.storage_provider == "r2" else "LOCAL"
    checksum = hashlib.sha256(data).hexdigest()
    m = MediaObject(
        id=media_id,
        storage_provider=stored.storage_provider,
        storage=legacy_storage,
        bucket=stored.bucket,
        object_key=key,
        version_id=stored.version_id,
        original_name=re.split(r"[/\\]", file.filename or "")[-1] or None,
        content_type=mime,
        size_bytes=len(data),
        checksum=checksum,
        sha256=checksum,
        uploaded_by=user.id,
        status="READY",
    )
    db.add(m)
    db.commit()
    return {"data": {
        "id": str(m.id),
        "view_url": f"/api/v1/media/{m.id}/view",
        "url": f"/api/v1/media/{m.id}/view",
        "content_type": mime,
    }}


async def _store_printing_pdf(file: UploadFile, db: Session, user: User, partner_key: str):
    config = printing_partner(partner_key)
    return await _store_upload(
        file,
        db,
        user,
        module=config.code,
        expected_content_type="application/pdf",
    )


@router.post("/upload", status_code=201)
async def upload(
    file: UploadFile = File(...),
    module: str = Query(default="general"),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    return await _store_upload(file, db, user, module=module)


@router.post(
    "/upload/printing/{partner_key}",
    status_code=201,
    dependencies=[Depends(require_permission("materials.settle"))],
)
async def upload_printing_pdf(
    partner_key: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    return await _store_printing_pdf(file, db, user, partner_key)


@router.post(
    "/upload/nhat-in",
    status_code=201,
    dependencies=[Depends(require_permission("materials.settle"))],
    include_in_schema=False,
)
async def upload_nhat_in_pdf(file: UploadFile = File(...), db: Session = Depends(get_db),
                             user: User = Depends(current_user)):
    return await _store_printing_pdf(file, db, user, "nhat")


@router.get("/recent")
def recent(
    days: int = 10,
    sort: str = "desc",
    limit: int = 300,
    offset: int = 0,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("sales.view")),
):
    """Kho ảnh 10 ngày: danh sách ảnh đơn hàng persisted, gom theo ngày."""
    if sort not in ("asc", "desc"):
        raise ApiError(422, "INVALID_SORT", "sort phải là 'asc' hoặc 'desc'.")
    data, meta = media_svc.recent_images(db, days=days, sort=sort, limit=limit, offset=offset)
    return {"data": data, "meta": meta}


@router.get("/customer-order-gallery")
def customer_order_gallery(
    q: str | None = None,
    date_filter: date | None = Query(default=None, alias="date"),
    status: str | None = None,
    sort: str = "created_desc",
    days: int = 10,
    limit: int = 500,
    offset: int = 0,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("sales.view")),
):
    """Kho ảnh khách đặt, nhóm ảnh theo từng đơn hoặc order group."""
    if sort not in ("created_asc", "created_desc"):
        raise ApiError(422, "INVALID_SORT", "sort phải là 'created_asc' hoặc 'created_desc'.")
    data, meta = media_svc.customer_order_gallery(
        db,
        days=days,
        sort=sort,
        q=q,
        date_filter=date_filter,
        status=status,
        limit=limit,
        offset=offset,
    )
    return {"data": data, "meta": meta}


@router.get("/{media_id}/view")
def view(
    media_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """Serve a persisted media object after checking the linked module permission."""
    media = db.get(MediaObject, media_id)
    if not media:
        raise ApiError(404, "MEDIA_NOT_FOUND", "Không tìm thấy ảnh.")
    if not _may_view_media(db, user, media):
        raise ApiError(403, "FORBIDDEN", "Bạn không có quyền xem file này.")

    provider = (media.storage_provider or "").lower()
    if provider == "s3" or (not provider and media.storage == "S3"):
        provider = "s3"
    storage = get_storage_service(provider or "local")
    if provider == "r2":
        if not isinstance(storage, R2StorageService):
            raise ApiError(500, "MEDIA_STORAGE_ERROR", "Cấu hình lưu trữ R2 không khớp với ảnh.")
        return RedirectResponse(
            url=storage.signed_url(bucket=media.bucket, object_key=media.object_key),
            status_code=307,
            headers={"Cache-Control": "private, no-store"},
        )
    if provider == "s3":
        if not isinstance(storage, LegacyS3StorageService):
            raise ApiError(500, "MEDIA_STORAGE_ERROR", "Cấu hình lưu trữ S3 cũ không khớp với ảnh.")
        return RedirectResponse(
            url=storage.signed_url(bucket=media.bucket, object_key=media.object_key),
            status_code=307,
            headers={"Cache-Control": "private, no-store"},
        )
    if provider not in ("", "local"):
        raise ApiError(500, "MEDIA_STORAGE_ERROR", "Nhà cung cấp lưu trữ ảnh không được hỗ trợ.")
    try:
        data = storage.read(bucket=media.bucket, object_key=media.object_key)
    except FileNotFoundError as exc:
        raise ApiError(404, "MEDIA_FILE_MISSING", "File ảnh không tồn tại.") from exc
    except ValueError as exc:
        raise ApiError(404, "MEDIA_FILE_MISSING", "File ảnh không tồn tại.") from exc
    if not data:
        raise ApiError(404, "MEDIA_FILE_MISSING", "File ảnh không tồn tại.")
    return Response(content=data, media_type=media.content_type, headers={"Cache-Control": "private, no-store"})


def _may_view_media(db: Session, user: User, media: MediaObject) -> bool:
    permissions: set[str] = set()
    if db.query(OrderMedia.order_id).filter(OrderMedia.media_id == media.id).first():
        permissions.add("sales.view")
    if db.query(InvoiceCapture.id).filter(InvoiceCapture.media_id == media.id).first() or db.query(
        Invoice.id
    ).filter(Invoice.captured_invoice_media_id == media.id).first():
        permissions.add("sales.invoice")
    if db.query(ProductionBatchMedia.batch_id).filter(ProductionBatchMedia.media_id == media.id).first():
        permissions.add("production.view")
    if db.query(PartnerSettlement.id).filter(PartnerSettlement.media_id == media.id).first() or db.query(
        PartnerFile.id
    ).filter(PartnerFile.media_id == media.id).first():
        permissions.add("materials.view")
    if permissions:
        return any(has_permission(db, user, permission) for permission in permissions)

    # Pattern notes use a JSON media_ids field instead of a join table.
    notes = db.query(PatternNote.media_ids).all()
    if any(str(media.id) in (media_ids or []) for (media_ids,) in notes):
        return has_permission(db, user, "production.manage")
    return media.uploaded_by == user.id
