"""Orchestrate invoice-image migration: OLD Supabase Storage -> NEW R2.

Read-only by default (dry_run). apply/resume ghi DB production chỉ khi được gọi
tường minh từ CLI.
"""
from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from .config import Config
from .transfer import (
    MIME_TO_EXT,
    LegacyInvoiceDownloader,
    R2Uploader,
    sha256_hex,
)

# Namespace ổn định cho media UUID deterministic (idempotent + resume).
MEDIA_NAMESPACE = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")
LEGACY_IMAGE_TABLE = "invoice_images"  # key trong legacy_id_mapping


def _deterministic_media_uuid(old_invoice_id: str, image_path: str) -> str:
    return str(uuid.uuid5(MEDIA_NAMESPACE, f"invoice_image:{old_invoice_id}:{image_path}"))


def _ext_from_mime(mime: str | None) -> str:
    return MIME_TO_EXT.get((mime or "").lower(), "png")


def _date_path(ts: str | None) -> tuple[str, str]:
    """Trả (year, month) cho object key từ timestamp OLD (finalized_at/created_at)."""
    if ts:
        try:
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            return f"{dt.year:04d}", f"{dt.month:02d}"
        except Exception:  # noqa: BLE001
            pass
    now = datetime.now(timezone.utc)
    return f"{now.year:04d}", f"{now.month:02d}"


@dataclass
class PlanItem:
    old_invoice_id: str
    invoice_code: str
    image_path: str
    status: str
    finalized_at: str | None
    created_at: str | None
    # source (OLD storage)
    source_exists: bool
    source_size: int
    source_mimetype: str | None
    source_md5: str | None
    source_http_ok: bool
    # NEW mapping
    new_invoice_id: str | None
    new_invoice_no: str | None
    new_customer_id: str | None
    new_order_ids: list[str]
    has_existing_media: bool
    # target
    media_uuid: str
    ext: str
    object_key: str
    already_on_r2: bool = False
    r2_size: int | None = None
    r2_sha256: str | None = None


@dataclass
class ApplyStats:
    processed: int = 0
    uploaded: int = 0
    deduplicated: int = 0
    reused: int = 0
    skipped_existing_media: int = 0
    failed: int = 0
    created_media_objects: int = 0
    created_invoice_captures: int = 0
    set_captured_invoice_media_id: int = 0
    failed_items: list[dict] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "processed": self.processed,
            "uploaded": self.uploaded,
            "deduplicated": self.deduplicated,
            "reused": self.reused,
            "skipped_existing_media": self.skipped_existing_media,
            "failed": self.failed,
            "created_media_objects": self.created_media_objects,
            "created_invoice_captures": self.created_invoice_captures,
            "set_captured_invoice_media_id": self.set_captured_invoice_media_id,
        }


class InvoiceImageMigrator:
    def __init__(self, config: Config) -> None:
        self.config = config
        self.engine: Engine = create_engine(config.new_database_url, pool_pre_ping=True, future=True)
        self.old_engine: Engine = create_engine(config.old_database_url, pool_pre_ping=True, future=True)
        self.downloader = LegacyInvoiceDownloader(config)
        self.uploader = R2Uploader(config)
        self._checksum_index: dict[str, dict] = {}

    def close(self) -> None:
        self.engine.dispose()
        self.old_engine.dispose()
        self.downloader.close()

    # ------------------------------------------------------------------ DB helpers
    def _rows(self, sql: str, old: bool = False, **params) -> list[dict]:
        engine = self.old_engine if old else self.engine
        with engine.connect() as conn:
            return [dict(r) for r in conn.execute(text(sql), params or None).mappings()]

    def _scalar(self, sql: str, old: bool = False, **params) -> Any:
        engine = self.old_engine if old else self.engine
        with engine.connect() as conn:
            return conn.execute(text(sql), params or None).scalar()

    # ------------------------------------------------------------------ OLD source
    def _old_invoices_with_image(self) -> list[dict]:
        rows = self._rows(
            "SELECT id, invoice_code, status, invoice_image_path, finalized_at, created_at "
            "FROM invoices WHERE invoice_image_path IS NOT NULL AND invoice_image_path <> '' "
            "ORDER BY id",
            old=True,
        )
        # storage.objects metadata theo name (path), chọn bản mới nhất không phải delete marker.
        objs = self._rows(
            "SELECT name, metadata, is_delete_marker, updated_at "
            "FROM storage.objects WHERE bucket_id = :b",
            old=True,
            b=self.config.legacy_supabase_bucket,
        )
        by_name: dict[str, dict] = {}
        for o in objs:
            if o.get("is_delete_marker"):
                continue
            name = o.get("name")
            if name not in by_name or (o.get("updated_at") and by_name[name].get("updated_at")
                                       and o["updated_at"] > by_name[name]["updated_at"]):
                by_name[name] = o
        for r in rows:
            obj = by_name.get(r.get("invoice_image_path"))
            r["_storage"] = obj
        return rows

    # ------------------------------------------------------------------ NEW mapping
    def _legacy_invoice_map(self) -> dict[str, str]:
        """OLD invoice id (str) -> NEW invoice uuid (str)."""
        rows = self._rows(
            "SELECT legacy_id, new_uuid::text AS new_uuid FROM legacy_id_mapping "
            "WHERE legacy_table = 'invoices'"
        )
        return {str(r["legacy_id"]): r["new_uuid"] for r in rows}

    def _new_invoices(self) -> dict[str, dict]:
        rows = self._rows(
            "SELECT id::text AS id, invoice_no, customer_id::text AS customer_id, "
            "captured_invoice_media_id::text AS captured_invoice_media_id "
            "FROM invoices"
        )
        return {r["id"]: r for r in rows}

    def _new_invoice_orders(self) -> dict[str, list[str]]:
        rows = self._rows(
            "SELECT invoice_id::text AS invoice_id, order_id::text AS order_id "
            "FROM invoice_orders ORDER BY invoice_id"
        )
        out: dict[str, list[str]] = {}
        for r in rows:
            out.setdefault(r["invoice_id"], []).append(r["order_id"])
        return out

    def _existing_media_map(self) -> dict[str, str]:
        """invoice_images legacy_id -> media uuid đã map trước đó (resume/idempotent)."""
        rows = self._rows(
            "SELECT legacy_id, new_uuid::text AS new_uuid FROM legacy_id_mapping "
            "WHERE legacy_table = :t",
            t=LEGACY_IMAGE_TABLE,
        )
        return {str(r["legacy_id"]): r["new_uuid"] for r in rows}

    def _existing_capture_media_ids(self) -> set[str]:
        rows = self._rows("SELECT media_id::text AS media_id FROM invoice_captures")
        return {r["media_id"] for r in rows}

    # ------------------------------------------------------------------ target
    def _object_key_for(self, media_uuid: str, ext: str, ts: str | None) -> str:
        y, m = _date_path(ts)
        return f"legacy-media/{y}/{m}/{media_uuid}.{ext}"

    # ------------------------------------------------------------------ plan
    def build_plan(self) -> list[PlanItem]:
        old_rows = self._old_invoices_with_image()
        legacy_map = self._legacy_invoice_map()
        new_invoices = self._new_invoices()
        invoice_orders = self._new_invoice_orders()

        # fallback: NEW invoice_no -> id
        by_no: dict[str, str] = {}
        for inv in new_invoices.values():
            no = inv.get("invoice_no")
            if no:
                by_no[no] = inv["id"]

        items: list[PlanItem] = []
        for old in old_rows:
            old_id = str(old["id"])
            code = old.get("invoice_code") or ""
            path = (old.get("invoice_image_path") or "").strip()
            obj = old.get("_storage") or {}
            meta = obj.get("metadata") or {}
            size = int(meta.get("size") or meta.get("contentLength") or 0)
            mime = meta.get("mimetype")
            http_code = meta.get("httpStatusCode")
            http_ok = http_code is None or int(http_code) == 200
            source_exists = bool(obj) and size > 0
            md5 = (meta.get("eTag") or "").strip().strip('"') or None

            # map NEW
            new_id = legacy_map.get(old_id)
            if new_id is None and code:
                new_id = by_no.get(code)
            new_inv = new_invoices.get(new_id) if new_id else None

            has_existing_media = bool(new_inv and new_inv.get("captured_invoice_media_id"))
            new_no = new_inv.get("invoice_no") if new_inv else None
            new_customer = new_inv.get("customer_id") if new_inv else None
            order_ids = invoice_orders.get(new_id, []) if new_id else []

            media_uuid = _deterministic_media_uuid(old_id, path)
            ext = _ext_from_mime(mime)
            object_key = self._object_key_for(media_uuid, ext, old.get("finalized_at") or old.get("created_at"))

            items.append(PlanItem(
                old_invoice_id=old_id,
                invoice_code=code,
                image_path=path,
                status=old.get("status") or "",
                finalized_at=old.get("finalized_at"),
                created_at=old.get("created_at"),
                source_exists=source_exists,
                source_size=size,
                source_mimetype=mime,
                source_md5=md5,
                source_http_ok=http_ok,
                new_invoice_id=new_id,
                new_invoice_no=new_no,
                new_customer_id=new_customer,
                new_order_ids=order_ids,
                has_existing_media=has_existing_media,
                media_uuid=media_uuid,
                ext=ext,
                object_key=object_key,
            ))
        return items

    def _probe_r2(self, items: list[PlanItem]) -> None:
        """HEAD từng target key trên R2 (read-only). Cần R2 creds."""
        if not self.config.missing_r2:
            with ThreadPoolExecutor(max_workers=self.config.workers) as pool:
                futs = {pool.submit(self.uploader.head, it.object_key): it for it in items}
                for fut in as_completed(futs):
                    it = futs[fut]
                    exists, size, sha = fut.result()
                    it.already_on_r2 = exists
                    it.r2_size = size
                    it.r2_sha256 = sha

    # ------------------------------------------------------------------ DRY-RUN
    def dry_run(self, *, probe_r2: bool = True) -> dict:
        items = self.build_plan()
        if probe_r2 and not self.config.missing_r2:
            self._probe_r2(items)

        old_invoices_with_image = len(items)
        new_invoice_matches = sum(1 for it in items if it.new_invoice_id)
        unmapped_invoice = sum(1 for it in items if not it.new_invoice_id)
        conflicts = [it for it in items if it.new_invoice_id and it.has_existing_media]
        conflict_count = len(conflicts)

        # Chỉ tính "actionable" = đã map + có source + chưa có media.
        actionable = [it for it in items if it.new_invoice_id and it.source_exists and not it.has_existing_media]
        source_downloadable = sum(1 for it in items if it.source_exists and it.source_http_ok)
        missing_source = sum(1 for it in items if not it.source_exists)

        already_on_r2 = sum(1 for it in actionable if it.already_on_r2)
        will_upload = sum(1 for it in actionable if not it.already_on_r2)

        will_create_media_object = len(actionable)
        will_create_invoice_capture = len(actionable)
        will_set_captured_invoice_media_id = len(actionable)

        # chi tiết conflicts / unmapped / missing
        conflict_details = [
            {"old_invoice_id": it.old_invoice_id, "invoice_code": it.invoice_code,
             "new_invoice_id": it.new_invoice_id, "existing_media_id": None}
            for it in conflicts
        ]
        unmapped_details = [
            {"old_invoice_id": it.old_invoice_id, "invoice_code": it.invoice_code,
             "image_path": it.image_path}
            for it in items if not it.new_invoice_id
        ]
        missing_details = [
            {"old_invoice_id": it.old_invoice_id, "invoice_code": it.invoice_code,
             "image_path": it.image_path}
            for it in items if not it.source_exists
        ]

        return {
            "old_invoices_with_image": old_invoices_with_image,
            "new_invoice_matches": new_invoice_matches,
            "source_downloadable": source_downloadable,
            "already_on_r2": already_on_r2,
            "will_upload": will_upload,
            "will_create_media_object": will_create_media_object,
            "will_create_invoice_capture": will_create_invoice_capture,
            "will_set_captured_invoice_media_id": will_set_captured_invoice_media_id,
            "missing_source": missing_source,
            "unmapped_invoice": unmapped_invoice,
            "conflicts": conflict_count,
            "conflict_details": conflict_details,
            "unmapped_details": unmapped_details,
            "missing_details": missing_details,
            "estimated_bytes": sum(it.source_size for it in actionable),
        }

    # ------------------------------------------------------------------ APPLY
    def _load_checksum_index(self) -> None:
        rows = self._rows(
            "SELECT checksum, object_key, bucket, size_bytes, content_type "
            "FROM media_objects WHERE storage_provider = 'r2' AND status = 'READY' "
            "AND checksum <> ''"
        )
        for r in rows:
            cs = (r.get("checksum") or "").strip()
            if cs and cs not in self._checksum_index:
                self._checksum_index[cs] = {
                    "object_key": r.get("object_key"),
                    "bucket": r.get("bucket"),
                    "size_bytes": r.get("size_bytes"),
                    "content_type": r.get("content_type"),
                }

    def apply(self, *, resume: bool = False) -> ApplyStats:
        missing_r2 = self.config.missing_r2
        missing_src = self.config.missing_legacy_source
        if missing_r2 or missing_src:
            problems = []
            if missing_r2:
                problems.append("R2: " + ", ".join(missing_r2))
            if missing_src:
                problems.append("legacy source: " + ", ".join(missing_src))
            raise RuntimeError("ABORT — thiếu cấu hình:\n  " + "\n  ".join(problems))

        self._load_checksum_index()
        existing_media_map = self._existing_media_map()
        items = self.build_plan()
        stats = ApplyStats()

        for it in items:
            if not it.new_invoice_id:
                stats.failed += 1
                stats.failed_items.append({"old_invoice_id": it.old_invoice_id,
                                           "reason": "unmapped_invoice"})
                continue
            if it.has_existing_media:
                stats.skipped_existing_media += 1
                continue
            if not it.source_exists:
                stats.failed += 1
                stats.failed_items.append({"old_invoice_id": it.old_invoice_id,
                                           "reason": "missing_source"})
                continue
            stats.processed += 1
            try:
                self._apply_one(it, existing_media_map, stats)
            except Exception as exc:  # noqa: BLE001
                stats.failed += 1
                stats.failed_items.append({"old_invoice_id": it.old_invoice_id,
                                           "reason": f"{type(exc).__name__}: {exc}"})

        return stats

    def _apply_one(self, it: PlanItem, existing_media_map: dict[str, str], stats: ApplyStats) -> None:
        import json

        # 1) media uuid đã tồn tại từ lần trước?
        media_uuid = existing_media_map.get(it.old_invoice_id, it.media_uuid)

        # 2) tải + dedup + upload nếu cần
        dl = self.downloader.download(it.image_path)
        if not dl.ok:
            raise RuntimeError(f"download_failed: {dl.error}")
        checksum = sha256_hex(dl.data)
        ext = dl.ext or it.ext
        target_key = self._object_key_for(media_uuid, ext, it.finalized_at or it.created_at)

        exists, _, _ = self.uploader.head(target_key)
        if not exists:
            existing = self._checksum_index.get(checksum)
            if existing:
                # reuse object đã có cùng checksum
                target_key = existing["object_key"]
                stats.deduplicated += 1
            else:
                up = self.uploader.upload(object_key=target_key, data=dl.data,
                                          content_type=dl.content_type, sha256=checksum)
                if not up.ok:
                    raise RuntimeError(f"upload_failed: {up.error}")
                stats.uploaded += 1
                self._checksum_index[checksum] = {"object_key": target_key, "content_type": dl.content_type}
        else:
            stats.reused += 1

        # 3) ghi DB trong transaction
        with self.engine.begin() as conn:
            # media_object (idempotent theo id)
            media_exists = conn.execute(
                text("SELECT 1 FROM media_objects WHERE id = :id"),
                {"id": media_uuid},
            ).scalar()
            if not media_exists:
                conn.execute(
                    text(
                        "INSERT INTO media_objects "
                        "(id, storage_provider, storage, bucket, object_key, version_id, "
                        " original_name, content_type, size_bytes, checksum, sha256, status) "
                        "VALUES (:id, 'r2', 'S3', :bucket, :object_key, NULL, "
                        "        :original_name, :content_type, :size_bytes, :checksum, :checksum, 'READY')"
                    ),
                    {
                        "id": media_uuid,
                        "bucket": self.config.r2_bucket,
                        "object_key": target_key,
                        "original_name": it.image_path.rsplit("/", 1)[-1],
                        "content_type": dl.content_type,
                        "size_bytes": len(dl.data),
                        "checksum": checksum,
                    },
                )
                stats.created_media_objects += 1
            # persist mapping
            conn.execute(
                text(
                    "INSERT INTO legacy_id_mapping (legacy_table, legacy_id, new_table, new_uuid, business_key) "
                    "VALUES (:t, :i, 'media_objects', :u, :b) "
                    "ON CONFLICT (legacy_table, legacy_id) DO NOTHING"
                ),
                {"t": LEGACY_IMAGE_TABLE, "i": it.old_invoice_id, "u": media_uuid, "b": it.image_path},
            )

            # invoice_capture (idempotent theo media_id — bảng không có invoice_id)
            cap_exists = conn.execute(
                text("SELECT 1 FROM invoice_captures WHERE media_id = :media_id"),
                {"media_id": media_uuid},
            ).scalar()
            if not cap_exists:
                conn.execute(
                    text(
                        "INSERT INTO invoice_captures (id, customer_id, order_ids, media_id, captured_by) "
                        "VALUES (:id, :customer_id, CAST(:order_ids AS jsonb), :media_id, NULL)"
                    ),
                    {
                        "id": str(uuid.uuid4()),
                        "customer_id": it.new_customer_id,
                        "order_ids": json.dumps(it.new_order_ids),
                        "media_id": media_uuid,
                    },
                )
                stats.created_invoice_captures += 1

            # invoices.captured_invoice_media_id
            conn.execute(
                text("UPDATE invoices SET captured_invoice_media_id = :media_id, "
                     "captured_at = COALESCE(captured_at, :captured_at) "
                     "WHERE id = :invoice_id AND captured_invoice_media_id IS NULL"),
                {
                    "media_id": media_uuid,
                    "captured_at": it.finalized_at,
                    "invoice_id": it.new_invoice_id,
                },
            )
            stats.set_captured_invoice_media_id += 1

    # ------------------------------------------------------------------ VERIFY
    def verify(self) -> dict:
        invoice_captures = int(self._scalar("SELECT count(*) FROM invoice_captures") or 0)
        invoices_with_media_id = int(self._scalar(
            "SELECT count(*) FROM invoices WHERE captured_invoice_media_id IS NOT NULL") or 0)
        media_ready = int(self._scalar(
            "SELECT count(*) FROM media_objects WHERE storage_provider = 'r2' AND status = 'READY'") or 0)

        # Kiểm tra invoice image media trên R2 (media được invoices.captured_invoice_media_id trỏ tới).
        rows = self._rows(
            "SELECT m.id::text AS id, m.object_key, m.size_bytes, m.checksum "
            "FROM media_objects m "
            "JOIN invoices i ON i.captured_invoice_media_id = m.id"
        )
        missing_on_r2 = 0
        size_mismatch = 0
        checksum_mismatch = 0
        for r in rows:
            exists, size, sha = self.uploader.head(r["object_key"])
            if not exists:
                missing_on_r2 += 1
                continue
            if r["size_bytes"] and size is not None and int(r["size_bytes"]) != int(size):
                size_mismatch += 1
            if r["checksum"] and sha and r["checksum"] != sha:
                checksum_mismatch += 1

        # invoice image mapping mismatch: invoice có media nhưng thiếu capture,
        # hoặc capture bị mồ côi (không có invoice nào trỏ tới media đó).
        invoice_missing_capture = int(self._scalar(
            "SELECT count(*) FROM invoices i "
            "WHERE i.captured_invoice_media_id IS NOT NULL "
            "  AND NOT EXISTS (SELECT 1 FROM invoice_captures c WHERE c.media_id = i.captured_invoice_media_id)"
        ) or 0)
        orphan_capture = int(self._scalar(
            "SELECT count(*) FROM invoice_captures c "
            "WHERE NOT EXISTS (SELECT 1 FROM invoices i WHERE i.captured_invoice_media_id = c.media_id)"
        ) or 0)
        mapping_mismatch = invoice_missing_capture + orphan_capture

        ok = missing_on_r2 == 0 and size_mismatch == 0 and checksum_mismatch == 0 and mapping_mismatch == 0
        return {
            "ok": ok,
            "invoice_captures": invoice_captures,
            "invoices_with_media_id": invoices_with_media_id,
            "media_ready": media_ready,
            "missing_on_r2": missing_on_r2,
            "size_mismatch": size_mismatch,
            "checksum_mismatch": checksum_mismatch,
            "invoice_image_mapping_mismatch": mapping_mismatch,
        }
