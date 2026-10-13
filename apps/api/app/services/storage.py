"""Private object storage adapters for local development and Cloudflare R2."""

from __future__ import annotations

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
    def put(self, *, object_key: str, data: bytes, content_type: str) -> StoredObject:
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

    def put(self, *, object_key: str, data: bytes, content_type: str) -> StoredObject:
        del content_type
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

    def _client(self):
        import boto3

        return boto3.client(
            "s3",
            endpoint_url=self.endpoint_url,
            region_name="auto",
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
        )

    def put(self, *, object_key: str, data: bytes, content_type: str) -> StoredObject:
        result = self._client().put_object(
            Bucket=settings.r2_bucket,
            Key=object_key,
            Body=data,
            ContentType=content_type,
        )
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


class LegacyS3StorageService(StorageService):
    """Read-only adapter for objects written before the R2 migration."""

    def put(self, *, object_key: str, data: bytes, content_type: str) -> StoredObject:
        del object_key, data, content_type
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


def get_storage_service(driver: str | None = None) -> StorageService:
    driver = (driver or settings.storage_driver).strip().lower()
    if driver == "local":
        return LocalStorageService()
    if driver == "r2":
        return R2StorageService()
    if driver == "s3":
        return LegacyS3StorageService()
    raise RuntimeError(f"Unsupported STORAGE_DRIVER: {settings.storage_driver}")


def put_object(*, object_key: str, data: bytes, content_type: str) -> tuple[str, str | None, str | None]:
    """Compatibility wrapper for the production demo seeder."""
    stored = get_storage_service().put(object_key=object_key, data=data, content_type=content_type)
    legacy_provider = "S3" if stored.storage_provider == "r2" else "LOCAL"
    return legacy_provider, stored.bucket, stored.version_id


def media_view_url(media_id) -> str:
    """Build the authenticated API URL clients use to view a media object."""
    return f"/api/v1/media/{media_id}/view"
