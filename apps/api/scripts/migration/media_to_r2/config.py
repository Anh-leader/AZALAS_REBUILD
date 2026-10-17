"""Resolve media -> R2 migration configuration from env / .env.production.

Precedence: real process environment variables win over the .env.production file.
R2 secrets are never logged.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import quote


def load_env_file(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def _strip_self_prefix(key: str, value: str) -> str:
    """Fix a value that accidentally embeds its own key (e.g. R2_ENDPOINT_URL=https://...)."""
    value = (value or "").strip()
    prefix = f"{key}="
    if value.startswith(prefix):
        value = value[len(prefix):]
    return value.strip()


@dataclass
class Config:
    new_database_url: str = ""
    old_database_url: str = ""
    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket: str = ""
    r2_endpoint_url: str = ""
    r2_public_base_url: str = ""
    # Legacy media source
    legacy_media_base_url: str = ""
    legacy_supabase_project_ref: str = "ztpysvksgaaskjoevlnb"
    legacy_supabase_bucket: str = "az-order-images"
    legacy_supabase_service_role_key: str = ""
    batch_size: int = 15
    workers: int = 5
    retries: int = 3
    timeout_seconds: int = 30
    extra: dict = field(default_factory=dict)

    def r2_client_kwargs(self) -> dict:
        return {
            "endpoint_url": self.r2_endpoint_url,
            "region_name": "auto",
            "aws_access_key_id": self.r2_access_key_id,
            "aws_secret_access_key": self.r2_secret_access_key,
        }

    def legacy_url(self, object_key: str) -> str:
        """Build the download URL for a legacy object path.

        ``LEGACY_MEDIA_BASE_URL`` (if set) is used verbatim, supporting an optional
        ``{path}`` placeholder. Otherwise a Supabase Storage URL is constructed.
        """
        path = quote(object_key, safe="/")
        base = self.legacy_media_base_url.strip()
        if base:
            if "{path}" in base:
                return base.replace("{path}", path)
            return base.rstrip("/") + "/" + path
        endpoint = "authenticated" if self.legacy_supabase_service_role_key else "public"
        return (
            f"https://{self.legacy_supabase_project_ref}.supabase.co"
            f"/storage/v1/object/{endpoint}/{self.legacy_supabase_bucket}/{path}"
        )

    def auth_headers(self) -> dict[str, str]:
        """Headers for Supabase Storage requests.

        Supabase's new publishable/secret keys (``sb_publishable_...`` /
        ``sb_secret_...``) are NOT JWTs. The gateway resolves them from the
        ``apikey`` header, not ``Authorization``. Sending a new-style key on
        ``Authorization: Bearer`` makes the gateway try to parse it as a JWT and
        return HTTP 400. Legacy ``anon``/``service_role`` keys *are* JWTs
        (``eyJ...``) and are sent on both headers for backward compatibility.
        """
        key = self.legacy_supabase_service_role_key
        if not key:
            return {}
        headers = {"apikey": key}
        if key.startswith("eyJ"):
            headers["Authorization"] = f"Bearer {key}"
        return headers

    def sign_url(self, object_key: str) -> str:
        """URL used to create a signed URL for a private object.

        Server-side downloads of private objects can use a time-limited signed URL:
            POST /storage/v1/object/sign/{bucket}/{path}
        which is independent of Auth JWT signing keys.
        """
        path = quote(object_key, safe="/")
        return (
            f"https://{self.legacy_supabase_project_ref}.supabase.co"
            f"/storage/v1/object/sign/{self.legacy_supabase_bucket}/{path}"
        )

    @property
    def missing_r2(self) -> list[str]:
        missing = []
        for key in ("r2_access_key_id", "r2_secret_access_key", "r2_bucket"):
            if not getattr(self, key):
                missing.append(key.upper())
        if not self.r2_endpoint_url and not self.r2_account_id:
            missing.append("R2_ENDPOINT_URL or R2_ACCOUNT_ID")
        return missing

    @property
    def missing_legacy_source(self) -> list[str]:
        if self.legacy_media_base_url:
            return []
        if not self.legacy_supabase_project_ref:
            return ["LEGACY_SUPABASE_PROJECT_REF"]
        if not self.legacy_supabase_bucket:
            return ["LEGACY_SUPABASE_BUCKET"]
        return []


def resolve(env: dict[str, str] | None = None) -> Config:
    repo_root = Path(__file__).resolve().parents[5]  # .../apps/api/scripts/migration/media_to_r2
    file_env = load_env_file(repo_root / ".env.production")
    merged = dict(file_env)
    merged.update(os.environ)
    if env:
        merged.update(env)

    def pick(*keys: str, default: str = "") -> str:
        for k in keys:
            if k in merged and str(merged[k]).strip():
                return str(merged[k]).strip()
        return default

    endpoint_url = _strip_self_prefix("R2_ENDPOINT_URL", pick("R2_ENDPOINT_URL"))
    if not endpoint_url:
        acct = pick("R2_ACCOUNT_ID")
        if acct:
            endpoint_url = f"https://{acct}.r2.cloudflarestorage.com"

    cfg = Config(
        new_database_url=pick("NEW_SUPABASE_DATABASE_URL", "SUPABASE_DATABASE_URL", "DATABASE_URL"),
        old_database_url=pick("OLD_SUPABASE_DATABASE_URL"),
        r2_account_id=pick("R2_ACCOUNT_ID"),
        r2_access_key_id=pick("R2_ACCESS_KEY_ID"),
        r2_secret_access_key=pick("R2_SECRET_ACCESS_KEY"),
        r2_bucket=pick("R2_BUCKET"),
        r2_endpoint_url=endpoint_url,
        r2_public_base_url=pick("R2_PUBLIC_BASE_URL"),
        legacy_media_base_url=pick("LEGACY_MEDIA_BASE_URL"),
        legacy_supabase_project_ref=pick("LEGACY_SUPABASE_PROJECT_REF", default="ztpysvksgaaskjoevlnb"),
        legacy_supabase_bucket=pick("LEGACY_SUPABASE_BUCKET", default="az-order-images"),
        legacy_supabase_service_role_key=pick(
            "LEGACY_SUPABASE_SERVICE_ROLE_KEY",
            "LEGACY_SUPABASE_SECRET_KEY",
            "LEGACY_SUPABASE_KEY",
        ),
    )
    for key, cast in (("BATCH_SIZE", int), ("WORKERS", int), ("RETRIES", int), ("TIMEOUT", int)):
        val = pick(key)
        if val and re.fullmatch(r"\d+", val):
            setattr(cfg, key.lower(), cast(val))
    cfg.extra = {k: v for k, v in merged.items() if k not in (
        "R2_SECRET_ACCESS_KEY", "R2_ACCESS_KEY_ID", "LEGACY_SUPABASE_SERVICE_ROLE_KEY",
    )}
    return cfg
