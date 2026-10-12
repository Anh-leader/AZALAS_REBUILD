import hashlib
import uuid
from datetime import date
from pathlib import Path

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import FileResponse, RedirectResponse
from datetime import date
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.db import get_db
from ..core.deps import current_user, require_permission
from ..core.errors import ApiError
from ..models import MediaObject, User
from ..services import media as media_svc
from ..services.printing_partners import printing_partner
from ..services.storage import put_object, read_url

router = APIRouter(prefix="/media", tags=["media"])

# Nhận dạng MIME từ magic bytes, không tin extension
MAGIC = {b"\xff\xd8\xff": ("image/jpeg", "jpg"), b"\x89PNG\r\n\x1a\n": ("image/png", "png"),
         b"%PDF-": ("application/pdf", "pdf")}


async def _store_upload(
    file: UploadFile,
    db: Session,
    user: User,
    *,
    folder: str | None = None,
    expected_content_type: str | None = None,
):
    data = await file.read(settings.max_upload_bytes + 1)
    if len(data) > settings.max_upload_bytes:
        raise ApiError(413, "FILE_TOO_LARGE", "File vượt quá 10MB.")
    kind = next((v for k, v in MAGIC.items() if data.startswith(k)), None)
    if not kind and len(data) >= 12 and data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        kind = ("image/webp", "webp")
    if not kind:
        raise ApiError(415, "UNSUPPORTED_MEDIA", "Chỉ chấp nhận JPEG, PNG, WEBP hoặc PDF.")
    mime, ext = kind
    if expected_content_type and mime != expected_content_type:
        raise ApiError(415, "UNSUPPORTED_MEDIA", "Chỉ chấp nhận file PDF.")
    media_id = uuid.uuid4()
    folder_path = f"{folder}/" if folder else ""
    key = f"private-media/{folder_path}{media_id}.{ext}"
    storage, bucket, version_id = put_object(object_key=key, data=data, content_type=mime)
    m = MediaObject(
        id=media_id,
        storage=storage,
        bucket=bucket,
        object_key=key,
        version_id=version_id,
        original_name=file.filename,
        content_type=mime,
        size_bytes=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
        uploaded_by=user.id,
    )
    db.add(m)
    db.commit()
    return {"data": {"id": str(m.id), "url": f"/api/v1/media/{m.id}/view", "content_type": mime}}


async def _store_printing_pdf(file: UploadFile, db: Session, user: User, partner_key: str):
    config = printing_partner(partner_key)
    return await _store_upload(
        file,
        db,
        user,
        folder=config.code,
        expected_content_type="application/pdf",
    )


@router.post("/upload", status_code=201)
async def upload(file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(current_user)):
    return await _store_upload(file, db, user)


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
def view(media_id: uuid.UUID, db: Session = Depends(get_db)):
    """Serve a persisted media object by id. Local files are streamed directly;
    S3 objects redirect to a short-lived presigned URL. Only rows present in
    ``media_objects`` are served — never an arbitrary filesystem path."""
    media = db.get(MediaObject, media_id)
    if not media:
        raise ApiError(404, "MEDIA_NOT_FOUND", "Không tìm thấy ảnh.")
    if media.storage == "S3":
        if not media.bucket:
            raise ApiError(500, "MEDIA_STORAGE_ERROR", "Ảnh thiếu thông tin bucket.")
        return RedirectResponse(url=read_url(storage="S3", bucket=media.bucket, object_key=media.object_key))
    root = Path(settings.upload_dir).resolve()
    path = (root / media.object_key).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise ApiError(404, "MEDIA_FILE_MISSING", "File ảnh không tồn tại.")
    return FileResponse(path, media_type=media.content_type, filename=media.original_name)
