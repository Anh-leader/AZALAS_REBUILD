"""Download legacy invoice images (OLD Supabase) and upload/dedup to R2.

Tách biệt khỏi DB để dễ test và để dry-run không cần network tới OLD.
"""
from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass

import httpx

from .config import Config

MAGIC: dict[bytes, tuple[str, str]] = {
    b"\xff\xd8\xff": ("image/jpeg", "jpg"),
    b"\x89PNG\r\n\x1a\n": ("image/png", "png"),
}
ALLOWED = frozenset({"image/jpeg", "image/png", "image/webp"})

MIME_TO_EXT = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}


def detect_type(data: bytes) -> tuple[str, str] | None:
    for magic, (mime, ext) in MAGIC.items():
        if data.startswith(magic):
            return mime, ext
    if len(data) >= 12 and data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "image/webp", "webp"
    return None


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@dataclass
class DownloadResult:
    ok: bool
    data: bytes = b""
    content_type: str = ""
    ext: str = ""
    error: str = ""
    http_status: int | None = None


class LegacyInvoiceDownloader:
    """Read-only download of legacy invoice images over HTTP(S)."""

    def __init__(self, config: Config) -> None:
        self.config = config
        self._client = httpx.Client(
            timeout=config.timeout_seconds,
            follow_redirects=True,
            headers=config.auth_headers(),
        )

    def download(self, object_key: str) -> DownloadResult:
        result = self._get(self.config.legacy_url(object_key))
        if result.ok:
            return result
        signed = self._sign(object_key)
        if signed:
            signed_result = self._get(signed)
            if signed_result.ok:
                return signed_result
            result.error = f"{result.error} | signed_url:{signed_result.error}"
        return result

    def _get(self, url: str) -> DownloadResult:
        last_error = ""
        last_status: int | None = None
        for attempt in range(self.config.retries):
            try:
                resp = self._client.get(url)
                last_status = resp.status_code
                if resp.status_code == 200:
                    data = resp.content
                    detected = detect_type(data)
                    if detected is None:
                        return DownloadResult(ok=False, error="unsupported_content_type", http_status=200)
                    mime, ext = detected
                    if mime not in ALLOWED:
                        return DownloadResult(ok=False, error=f"disallowed_content_type:{mime}", http_status=200)
                    return DownloadResult(ok=True, data=data, content_type=mime, ext=ext)
                last_error = f"http_{resp.status_code}"
            except Exception as exc:  # noqa: BLE001
                last_error = f"{type(exc).__name__}: {exc}"
                last_status = None
            if attempt < self.config.retries - 1:
                time.sleep(0.5 * (2 ** attempt))
        return DownloadResult(ok=False, error=last_error, http_status=last_status)

    def _sign(self, object_key: str) -> str | None:
        url = self.config.sign_url(object_key)
        try:
            resp = self._client.post(url, json={"expiresIn": 3600})
            if resp.status_code == 200:
                data = resp.json()
                signed = data.get("signedURL") or data.get("signedUrl")
                if signed and str(signed).startswith("/"):
                    signed = f"https://{self.config.legacy_supabase_project_ref}.supabase.co{signed}"
                return signed
        except Exception:  # noqa: BLE001
            return None
        return None

    def close(self) -> None:
        self._client.close()


@dataclass
class UploadResult:
    ok: bool
    object_key: str = ""
    error: str = ""
    http_status: int | None = None


class R2Uploader:
    """Upload bytes to Cloudflare R2 via S3-compatible API."""

    def __init__(self, config: Config) -> None:
        self.config = config
        self._client_cache = None

    def _client(self):
        if self._client_cache is None:
            import boto3  # lazy: dry-run không cần S3 client khi không probe

            self._client_cache = boto3.client("s3", **self.config.r2_client_kwargs())
        return self._client_cache

    def upload(self, *, object_key: str, data: bytes, content_type: str, sha256: str) -> UploadResult:
        try:
            self._client().put_object(
                Bucket=self.config.r2_bucket,
                Key=object_key,
                Body=data,
                ContentType=content_type,
                Metadata={"sha256": sha256, "checksum": sha256},
            )
            return UploadResult(ok=True, object_key=object_key)
        except Exception as exc:  # noqa: BLE001
            http_status = getattr(getattr(exc, "response", None), "status_code", None)
            return UploadResult(ok=False, error=f"{type(exc).__name__}: {exc}", http_status=http_status)

    def head(self, object_key: str) -> tuple[bool, int | None, str | None]:
        """Return (exists, size_bytes, metadata_sha256)."""
        try:
            obj = self._client().head_object(Bucket=self.config.r2_bucket, Key=object_key)
            meta = obj.get("Metadata", {}) or {}
            return True, obj.get("ContentLength"), meta.get("sha256")
        except Exception:  # noqa: BLE001
            return False, None, None

    def list_keys(self, prefix: str, max_keys: int = 5000) -> list[tuple[str, int]]:
        """Liệt kê (key, size) theo prefix — read-only, dùng cho verify."""
        keys: list[tuple[str, int]] = []
        token = None
        while True:
            kwargs = {"Bucket": self.config.r2_bucket, "Prefix": prefix, "MaxKeys": 1000}
            if token:
                kwargs["ContinuationToken"] = token
            resp = self._client().list_objects_v2(**kwargs)
            for obj in resp.get("Contents", []):
                keys.append((obj["Key"], obj.get("Size", 0)))
                if len(keys) >= max_keys:
                    return keys
            if resp.get("IsTruncated"):
                token = resp.get("NextContinuationToken")
            else:
                break
        return keys
