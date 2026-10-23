"""Resolve invoice-image migration config from .env / .env.production.

Secrets (R2 keys, legacy service-role key) không bao giờ được in ra log.
Precedence cố ý tách riêng:
  * NEW database  -> .env (vừa được sửa password đúng), rồi process env.
  * OLD database  -> .env.production (pooler URL hoạt động), rồi .env, rồi env.
  * R2 / legacy   -> process env > .env > .env.production.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[5]  # .../apps/api/scripts/migration/invoice_images


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
    value = (value or "").strip()
    prefix = f"{key}="
    if value.startswith(prefix):
        value = value[len(prefix):]
    return value.strip()


@dataclass
class Config:
    new_database_url: str = ""
    old_database_url: str = ""
    # OLD Supabase Storage (source of invoice images)
    legacy_supabase_project_ref: str = "ztpysvksgaaskjoevlnb"
    legacy_supabase_bucket: str = "az-invoice-images"
    legacy_supabase_service_role_key: str = ""
    # NEW Cloudflare R2 (destination)
    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket: str = "azalas-prod-media"
    r2_endpoint_url: str = ""
    r2_public_base_url: str = ""
    timeout_seconds: int = 30
    retries: int = 3
    workers: int = 5
    extra: dict = field(default_factory=dict)

    def r2_client_kwargs(self) -> dict:
        return {
            "endpoint_url": self.r2_endpoint_url,
            "region_name": "auto",
            "aws_access_key_id": self.r2_access_key_id,
            "aws_secret_access_key": self.r2_secret_access_key,
        }

    def legacy_url(self, object_key: str) -> str:
        from urllib.parse import quote

        path = quote(object_key, safe="/")
        endpoint = "authenticated" if self.legacy_supabase_service_role_key else "public"
        return (
            f"https://{self.legacy_supabase_project_ref}.supabase.co"
            f"/storage/v1/object/{endpoint}/{self.legacy_supabase_bucket}/{path}"
        )

    def sign_url(self, object_key: str) -> str:
        from urllib.parse import quote

        path = quote(object_key, safe="/")
        return (
            f"https://{self.legacy_supabase_project_ref}.supabase.co"
            f"/storage/v1/object/sign/{self.legacy_supabase_bucket}/{path}"
        )

    def auth_headers(self) -> dict[str, str]:
        key = self.legacy_supabase_service_role_key
        if not key:
            return {}
        headers = {"apikey": key}
        if key.startswith("eyJ"):
            headers["Authorization"] = f"******"
        return headers

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
        if not self.legacy_supabase_project_ref:
            return ["LEGACY_SUPABASE_PROJECT_REF"]
        if not self.legacy_supabase_bucket:
            return ["LEGACY_SUPABASE_BUCKET"]
        if not self.legacy_supabase_service_role_key:
            return ["LEGACY_SUPABASE_SERVICE_ROLE_KEY (bắt buộc khi --apply tải file private)"]
        return []


def resolve(env: dict[str, str] | None = None) -> Config:
    env_file = load_env_file(REPO_ROOT / ".env")
    prod_file = load_env_file(REPO_ROOT / ".env.production")
    process = dict(os.environ)
    if env:
        process.update(env)

    # NEW: .env (password đã sửa) > process env > .env.production
    def new_pick(key: str) -> str:
        return (process.get(key) or env_file.get(key) or prod_file.get(key) or "").strip()

    # OLD: .env.production (pooler hoạt động) > process env > .env
    def old_pick(key: str) -> str:
        return (process.get(key) or prod_file.get(key) or env_file.get(key) or "").strip()

    endpoint_url = _strip_self_prefix("R2_ENDPOINT_URL", new_pick("R2_ENDPOINT_URL"))
    if not endpoint_url:
        acct = new_pick("R2_ACCOUNT_ID")
        if acct:
            endpoint_url = f"https://{acct}.r2.cloudflarestorage.com"

    cfg = Config(
        new_database_url=new_pick("DATABASE_URL"),
        old_database_url=old_pick("OLD_SUPABASE_DATABASE_URL"),
        r2_account_id=new_pick("R2_ACCOUNT_ID"),
        r2_access_key_id=new_pick("R2_ACCESS_KEY_ID"),
        r2_secret_access_key=new_pick("R2_SECRET_ACCESS_KEY"),
        r2_bucket=new_pick("R2_BUCKET") or "azalas-prod-media",
        r2_endpoint_url=endpoint_url,
        r2_public_base_url=new_pick("R2_PUBLIC_BASE_URL"),
        legacy_supabase_project_ref=new_pick("LEGACY_SUPABASE_PROJECT_REF") or "ztpysvksgaaskjoevlnb",
        legacy_supabase_bucket=new_pick("LEGACY_SUPABASE_BUCKET") or "az-invoice-images",
        legacy_supabase_service_role_key=new_pick(
            "LEGACY_SUPABASE_SERVICE_ROLE_KEY",
        ),
    )
    for key, cast in (("RETRIES", int), ("WORKERS", int), ("TIMEOUT", int)):
        val = new_pick(key)
        if val and re.fullmatch(r"\d+", val):
            setattr(cfg, key.lower(), cast(val))
    cfg.extra = {
        k: v for k, v in {**prod_file, **env_file, **process}.items()
        if k not in ("R2_SECRET_ACCESS_KEY", "R2_ACCESS_KEY_ID", "LEGACY_SUPABASE_SERVICE_ROLE_KEY")
    }
    return cfg
