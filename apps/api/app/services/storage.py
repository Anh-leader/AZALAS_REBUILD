"""Private object storage adapters for local development and Cloudflare R2."""

from __future__ import annotations

import threading
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote

from ..core.config import settings


@dataclass(frozen=True)
class StoredObject:
    storage_provider: str
    bucket: str | None = None
    version_id: str | None = None


class StorageService(ABC):
    @abstractmethod
    def put(self, *, object_key: str, data: bytes, content_type: str, cache_control: str | None = None) -> StoredObject:
        """Persist an object and return its storage metadata."""

    @abstractmethod
    def read(self, *, bucket: str | None, object_key: str) -> bytes:
        """Read an object without exposing its storage location to callers."""


class LocalStorageService(StorageService):
    def __init__(self, root: str | Path | None = None) -> None:
        self.root = Path(root or settings.upload_dir).resolve()

    def _path(self, object_key: str) -> Path:
        path = (self.root / object_key).resolve()
        if not path.is_relative_to(self.root):
            raise ValueError("Invalid object key")
        return path

    def put(self, *, object_key: str, data: bytes, content_type: str, cache_control: str | None = None) -> StoredObject:
        del content_type, cache_control
        path = self._path(object_key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return StoredObject(storage_provider="local")

    def read(self, *, bucket: str | None, object_key: str) -> bytes:
        del bucket
        return self._path(object_key).read_bytes()


class R2StorageService(StorageService):
    def __init__(self) -> None:
        if not (settings.r2_access_key_id and settings.r2_secret_access_key and settings.r2_bucket):
            raise RuntimeError("STORAGE_DRIVER=r2 requires R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET")
        endpoint_url = settings.r2_endpoint_url
        if not endpoint_url and settings.r2_account_id:
            endpoint_url = f"https://{settings.r2_account_id}.r2.cloudflarestorage.com"
        if not endpoint_url:
            raise RuntimeError("STORAGE_DRIVER=r2 requires R2_ENDPOINT_URL or R2_ACCOUNT_ID")
        self.endpoint_url = endpoint_url
        self._client_cache = None
        self._client_lock = threading.Lock()

    def _client(self):
        # boto3 client construction is expensive (~100ms). Reuse it so batched
        # presigned-URL generation for a gallery page stays fast.
        if self._client_cache is None:
            with self._client_lock:
                if self._client_cache is None:
                    import boto3

                    self._client_cache = boto3.client(
                        "s3",
                        endpoint_url=self.endpoint_url,
                        region_name="auto",
                        aws_access_key_id=settings.r2_access_key_id,
                        aws_secret_access_key=settings.r2_secret_access_key,
                    )
        return self._client_cache

    def put(self, *, object_key: str, data: bytes, content_type: str, cache_control: str | None = None) -> StoredObject:
        kwargs: dict = {
            "Bucket": settings.r2_bucket,
            "Key": object_key,
            "Body": data,
            "ContentType": content_type,
        }
        if cache_control:
            kwargs["CacheControl"] = cache_control
        result = self._client().put_object(**kwargs)
        return StoredObject(
            storage_provider="r2",
            bucket=settings.r2_bucket,
            version_id=result.get("VersionId"),
        )

    def read(self, *, bucket: str | None, object_key: str) -> bytes:
        target_bucket = bucket or settings.r2_bucket
        if not target_bucket:
            raise RuntimeError("R2 media is missing its bucket")
        result = self._client().get_object(Bucket=target_bucket, Key=object_key)
        return result["Body"].read()

    def exists(self, *, bucket: str | None, object_key: str) -> bool:
        target_bucket = bucket or settings.r2_bucket
        if not target_bucket:
            return False
        try:
            self._client().head_object(Bucket=target_bucket, Key=object_key)
            return True
        except Exception:  # noqa: BLE001 - head_object raises on 404
            return False

    def signed_url(self, *, bucket: str | None, object_key: str) -> str:
        if settings.r2_public_base_url:
            return f"{settings.r2_public_base_url.rstrip('/')}/{quote(object_key, safe='/')}"
        target_bucket = bucket or settings.r2_bucket
        if not target_bucket:
            raise RuntimeError("R2 media is missing its bucket")
        return self._client().generate_presigned_url(
            "get_object",
            Params={"Bucket": target_bucket, "Key": object_key},
            ExpiresIn=settings.r2_signed_url_expire_seconds,
        )

    def copy_object(self, *, source_key: str, dest_key: str, metadata: dict | None = None) -> dict:
        """Server-side copy of an object within the same bucket (no download).

        Used by the media reorganization migration. Returns the copy result.
        Metadata is preserved unless ``metadata`` is supplied, in which case the
        object metadata is replaced with the given values.
        """
        kwargs: dict = {
            "Bucket": settings.r2_bucket,
            "Key": dest_key,
            "CopySource": {"Bucket": settings.r2_bucket, "Key": source_key},
        }
        if metadata is not None:
            kwargs["Metadata"] = metadata
            kwargs["MetadataDirective"] = "REPLACE"
        return self._client().copy_object(**kwargs)

    def head_object(self, *, object_key: str) -> dict | None:
        """Return HEAD metadata for an object, or None if it does not exist."""
        try:
            return self._client().head_object(Bucket=settings.r2_bucket, Key=object_key)
        except Exception:  # noqa: BLE001 - head raises on 404
            return None


class LegacyS3StorageService(StorageService):
    """Read-only adapter for objects written before the R2 migration."""

    def put(self, *, object_key: str, data: bytes, content_type: str, cache_control: str | None = None) -> StoredObject:
        del object_key, data, content_type, cache_control
        raise RuntimeError("Legacy S3 storage is read-only")

    def _client(self):
        import boto3

        return boto3.client("s3", region_name=settings.s3_region)

    def read(self, *, bucket: str | None, object_key: str) -> bytes:
        if not bucket:
            raise RuntimeError("Legacy S3 media is missing its bucket")
        result = self._client().get_object(Bucket=bucket, Key=object_key)
        return result["Body"].read()

    def signed_url(self, *, bucket: str | None, object_key: str) -> str:
        if not bucket:
            raise RuntimeError("Legacy S3 media is missing its bucket")
        return self._client().generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": object_key},
            ExpiresIn=300,
        )


_storage_service_cache: dict[str, StorageService] = {}
_storage_service_lock = threading.Lock()


def get_storage_service(driver: str | None = None) -> StorageService:
    driver = (driver or settings.storage_driver).strip().lower()
    if driver == "local":
        return LocalStorageService()
    if driver in ("r2", "s3"):
        with _storage_service_lock:
            svc = _storage_service_cache.get(driver)
            if svc is None:
                svc = R2StorageService() if driver == "r2" else LegacyS3StorageService()
                _storage_service_cache[driver] = svc
            return svc
    raise RuntimeError(f"Unsupported STORAGE_DRIVER: {settings.storage_driver}")


def put_object(*, object_key: str, data: bytes, content_type: str) -> tuple[str, str | None, str | None]:
    """Compatibility wrapper for the production demo seeder."""
    stored = get_storage_service().put(object_key=object_key, data=data, content_type=content_type)
    legacy_provider = "S3" if stored.storage_provider == "r2" else "LOCAL"
    return legacy_provider, stored.bucket, stored.version_id


def media_view_url(media_id) -> str:
    """Build the authenticated API URL clients use to view a media object."""
    return f"/api/v1/media/{media_id}/view"


def media_direct_url(media) -> str:
    """Return the best direct URL for a media object.

    For private R2/S3 objects this is a short-lived signed URL so the browser
    loads the image straight from object storage without a backend proxy or an
    extra CORS-sensitive fetch. Local media keeps the authenticated proxy URL.
    """
    provider = (media.storage_provider or "").lower()
    if provider == "s3" or (not provider and getattr(media, "storage", None) == "S3"):
        provider = "s3"
    if provider in ("r2", "s3"):
        storage = get_storage_service(provider)
        signer = getattr(storage, "signed_url", None)
        if signer:
            return signer(bucket=media.bucket, object_key=media.object_key)
    return media_view_url(media.id)


def media_thumbnail_url(media_id, *, width: int = 400) -> str:
    """Build the authenticated thumbnail URL used for gallery grids."""
    return f"/api/v1/media/{media_id}/thumbnail?w={width}"


def thumbnail_object_key(object_key: str) -> str:
    """Derive the immutable, cacheable thumbnail object key from the original.

    The key is deterministic and unique per media (the original key already
    contains the media UUID), so a thumbnail can be cached with
    ``Cache-Control: public, max-age=31536000, immutable`` without a stale-cache
    risk: media objects are never mutated after upload.
    """
    return f"{object_key}.thumb.webp"


# Content type -> file extension. Falls back to parsing the existing object key
# when the content type is unknown.
_EXT_BY_CONTENT_TYPE = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/pdf": "pdf",
}


def media_extension(content_type: str | None, object_key: str | None = None) -> str:
    if content_type and content_type in _EXT_BY_CONTENT_TYPE:
        return _EXT_BY_CONTENT_TYPE[content_type]
    if object_key:
        stem = object_key.split("?")[0].rsplit("/", 1)[-1]
        if "." in stem:
            return stem.rsplit(".", 1)[-1].lower() or "bin"
    return "bin"


def sanitize_key_segment(value: str | None, *, fallback: str = "unknown") -> str:
    """Make a business code safe to use as a single URL path segment."""
    import re

    if not value:
        return fallback
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip())
    cleaned = re.sub(r"-{2,}", "-", cleaned).strip(".-")
    return cleaned or fallback


def build_media_object_key(
    *,
    category: str,
    business_code: str | None,
    media_id: str,
    extension: str,
    created_at,
) -> str:
    """Build a stable, observable R2 object key.

    Structure:
        <category>/YYYY/MM/DD/<business_code>/<media_id>.<ext>   (business)
        <category>/YYYY/MM/DD/<media_id>.<ext>                    (no code yet)
        other/YYYY/MM/DD/<media_id>.<ext>                         (unmapped)

    ``created_at`` must be timezone-aware; it is converted to Asia/Ho_Chi_Minh
    before deriving YYYY/MM/DD so files just past midnight VN-time do not fall
    into the previous UTC day.
    """
    from datetime import datetime
    from zoneinfo import ZoneInfo

    tz = ZoneInfo("Asia/Ho_Chi_Minh")
    if created_at is None:
        created_at = datetime.now(tz)
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=tz)
    local = created_at.astimezone(tz)
    date_part = f"{local:%Y/%m/%d}"
    if not business_code:
        # No business code yet (e.g. an upload that happens before the order/
        # invoice/batch exists). Still grouped under the category folder; the
        # migration/reorganize pass assigns the business-code subfolder once the
        # relation exists. `other` never has a business code.
        return f"{category}/{date_part}/{media_id}.{extension}"
    code = sanitize_key_segment(business_code)
    return f"{category}/{date_part}/{code}/{media_id}.{extension}"
