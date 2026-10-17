"""Download legacy media bytes and upload them to Cloudflare R2 (no DB access here)."""
from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass

import httpx

from .config import Config

# Magic bytes -> (content_type, extension). We never trust the file extension.
MAGIC: dict[bytes, tuple[str, str]] = {
    b"\xff\xd8\xff": ("image/jpeg", "jpg"),
    b"\x89PNG\r\n\x1a\n": ("image/png", "png"),
}
ALLOWED = frozenset({"image/jpeg", "image/png", "image/webp"})


def detect_type(data: bytes) -> tuple[str, str] | None:
    for magic, (mime, ext) in MAGIC.items():
        if data.startswith(magic):
            return mime, ext
    if len(data) >= 12 and data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "image/webp", "webp"
    return None


@dataclass
class DownloadResult:
    ok: bool
    data: bytes = b""
    content_type: str = ""
    ext: str = ""
    error: str = ""
    error_type: str = ""
    http_status: int | None = None


class LegacyDownloader:
    """Read-only download of legacy files over HTTP(S)."""

    def __init__(self, config: Config) -> None:
        self.config = config
        self._client = httpx.Client(
            timeout=config.timeout_seconds,
            follow_redirects=True,
            headers=config.auth_headers(),
        )

    def download(self, object_key: str) -> DownloadResult:
        # 1) authenticated object endpoint (apikey header is the fix for the
        #    new sb_secret_... key which is not a JWT).
        result = self._get(self.config.legacy_url(object_key), object_key)
        if result.ok:
            return result
        # 2) signed URL fallback: server-side private object access via
        #    /storage/v1/object/sign (signed with a key independent of Auth JWT).
        signed = self._sign(object_key)
        if signed:
            signed_result = self._get(signed, object_key)
            if signed_result.ok:
                return signed_result
            result.error = f"{result.error} | signed_url:{signed_result.error}"
        return result

    def _get(self, url: str, object_key: str) -> DownloadResult:
        last_error = ""
        last_type = ""
        last_status: int | None = None
        for attempt in range(self.config.retries):
            try:
                resp = self._client.get(url)
                last_status = resp.status_code
                if resp.status_code == 200:
                    data = resp.content
                    detected = detect_type(data)
                    if detected is None:
                        return DownloadResult(ok=False, error=f"unsupported_content_type", error_type="validate", http_status=200)
                    mime, ext = detected
                    if mime not in ALLOWED:
                        return DownloadResult(ok=False, error=f"disallowed_content_type:{mime}", error_type="validate", http_status=200)
                    return DownloadResult(ok=True, data=data, content_type=mime, ext=ext)
                last_error = f"http_{resp.status_code}"
                last_type = "http"
            except Exception as exc:  # noqa: BLE001
                last_error = f"{type(exc).__name__}: {exc}"
                last_type = type(exc).__name__
                last_status = None
            if attempt < self.config.retries - 1:
                time.sleep(0.5 * (2 ** attempt))
        return DownloadResult(ok=False, error=last_error, error_type=last_type, http_status=last_status)

    def _sign(self, object_key: str) -> str | None:
        """Create a time-limited signed URL for a private object.

        Supabase returns the ``signedURL`` as a relative path
        (``/object/sign/...?token=...``); we resolve it against the project host.
        """
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

    def head(self, object_key: str) -> tuple[str, int | None]:
        """HEAD probe for dry-run --probe. Returns ('ok'|'missing'|'error', size)."""
        url = self.config.legacy_url(object_key)
        try:
            resp = self._client.head(url)
            if resp.status_code == 200:
                length = resp.headers.get("content-length")
                size = int(length) if length and length.isdigit() else None
                return "ok", size
            if resp.status_code == 404:
                return "missing", None
            return "error", None
        except Exception:  # noqa: BLE001
            return "error", None

    def close(self) -> None:
        self._client.close()


@dataclass
class UploadResult:
    ok: bool
    object_key: str = ""
    error: str = ""
    error_type: str = ""
    http_status: int | None = None


class R2Uploader:
    """Upload bytes to Cloudflare R2 via the S3-compatible API."""

    def __init__(self, config: Config) -> None:
        self.config = config
        self._client_cache = None

    def _client(self):
        if self._client_cache is None:
            import boto3  # lazy: dry-run never needs the S3 client

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
            return UploadResult(ok=False, error=f"{type(exc).__name__}: {exc}",
                                error_type=type(exc).__name__, http_status=http_status)

    def head(self, object_key: str) -> tuple[bool, int | None, str | None]:
        """Return (exists, size_bytes, metadata_sha256)."""
        try:
            obj = self._client().head_object(Bucket=self.config.r2_bucket, Key=object_key)
            meta = obj.get("Metadata", {}) or {}
            return True, obj.get("ContentLength"), meta.get("sha256")
        except Exception:  # noqa: BLE001
            return False, None, None


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
