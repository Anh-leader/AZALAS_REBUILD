"""Orchestrate the legacy media -> R2 migration (dry-run / apply / resume / verify)."""
from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from .config import Config
from .transfer import LegacyDownloader, R2Uploader, sha256_hex

THUMB_CACHE_CONTROL = "public, max-age=31536000, immutable"


def _resize_to_webp(data: bytes, *, max_width: int = 400) -> tuple[bytes, str] | None:
    """Resize raw image bytes to a WebP thumbnail (mirror of app.services.media)."""
    import io

    try:
        from PIL import Image
    except ImportError:  # pragma: no cover - dependency declared
        return None
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except Exception:  # noqa: BLE001 - corrupt/unreadable/non-image bytes
        return None
    if image.mode not in ("RGB", "L"):
        image = image.convert("RGB")
    image.thumbnail((max_width, max_width))
    buffer = io.BytesIO()
    image.save(buffer, format="WEBP", quality=80, method=4)
    return buffer.getvalue(), "image/webp"


def _thumbnail_key(object_key: str) -> str:
    """Derive the immutable thumbnail object key (``<original>.thumb.webp``)."""
    return f"{object_key}.thumb.webp"

def _chunks(items: list[str], size: int):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def _redact_url(url: str) -> str:
    """Bỏ query credentials (token/signature) khỏi URL khi in/log."""
    from urllib.parse import urlsplit, urlunsplit
    parts = urlsplit(url)
    query = parts.query
    if query:
        safe = []
        for pair in query.split("&"):
            k = pair.split("=", 1)[0]
            if k.lower() in ("token", "signature", "x-amz-signature", "x-amz-credential",
                             "x-amz-security-token", "key", "access_key"):
                safe.append(f"{k}=REDACTED")
            else:
                safe.append(pair)
        query = "&".join(safe)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, ""))


LEGACY_PROVIDER = "legacy"
PENDING_STATUS = "PENDING_UPLOAD"
FAILED_STATUS = "FAILED"
READY_STATUS = "READY"


@dataclass
class ItemResult:
    media_id: str
    object_key: str
    action: str  # 'uploaded' | 'deduplicated' | 'failed'
    error: str = ""
    stage: str = ""
    error_type: str = ""
    http_status: int | None = None
    legacy_table: str = ""
    legacy_id: str = ""
    r2_object_key: str = ""
    r2_bucket: str = ""
    checksum: str = ""
    size_bytes: int = 0
    content_type: str = ""
    ext: str = ""
    data: bytes = b""  # downloaded bytes carried from Phase A -> B (bounded per batch)


@dataclass
class ApplyStats:
    processed: int = 0
    uploaded: int = 0
    deduplicated: int = 0
    failed: int = 0
    bytes_uploaded: int = 0
    failed_items: list[dict] = field(default_factory=list)
    uploaded_items: list[dict] = field(default_factory=list)
    deduplicated_items: list[dict] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "processed": self.processed,
            "uploaded": self.uploaded,
            "deduplicated": self.deduplicated,
            "failed": self.failed,
            "bytes_uploaded": self.bytes_uploaded,
        }


class MediaMigrator:
    def __init__(
        self,
        config: Config,
        downloader: LegacyDownloader | None = None,
        uploader: R2Uploader | None = None,
        *,
        from_date: str | None = None,
        to_date: str | None = None,
    ) -> None:
        self.config = config
        self.engine: Engine = create_engine(config.new_database_url, pool_pre_ping=True, future=True)
        self.downloader = downloader or LegacyDownloader(config)
        self.uploader = uploader or R2Uploader(config)
        self.from_date = from_date
        self.to_date = to_date
        self._batch_media_ids: set[str] | None = None
        # checksum -> existing READY r2 object metadata (dedupe index)
        self._checksum_index: dict[str, dict[str, Any]] = {}

    # ------------------------------------------------------------------
    def _rows(self, sql: str, **params) -> list[dict]:
        with self.engine.connect() as conn:
            return [dict(r) for r in conn.execute(text(sql), params or None).mappings()]

    def _scalar(self, sql: str, **params) -> Any:
        with self.engine.connect() as conn:
            return conn.execute(text(sql), params or None).scalar()

    def _resolve_batch_media_ids(self) -> set[str]:
        """Xác định media_objects.id thuộc batch incremental [from_date, to_date).

        Tái sử dụng đúng closure của legacy_to_current (order_units -> order_images)
        + pattern_job_images theo cột thời gian, rồi map legacy id -> media UUID qua
        legacy_id_mapping. KHÔNG lọc mù theo media.created_at.
        """
        if not self.config.old_database_url:
            raise RuntimeError(
                "Incremental media cần OLD_SUPABASE_DATABASE_URL để tái tạo closure batch."
            )
        from ..legacy_to_current.incremental import build_filter
        from ..legacy_to_current.old import read_all

        old_engine = create_engine(self.config.old_database_url, pool_pre_ping=True, future=True)
        try:
            row_filter, _ = build_filter(old_engine, self.from_date, self.to_date)
            order_image_ids = row_filter.by_id.get("order_images", set())

            # pattern_job_images: bảng độc lập (lọc theo cột thời gian).
            pattern_job_image_ids: set[str] = set()
            try:
                pj = read_all(old_engine, "pattern_job_images")
                for r in row_filter.filter_rows("pattern_job_images", pj):
                    if r.get("id") is not None:
                        pattern_job_image_ids.add(str(r.get("id")))
            except Exception:  # noqa: BLE001
                pass
        finally:
            old_engine.dispose()

        media_ids: set[str] = set()
        for legacy_table, legacy_ids in (
            ("order_images", order_image_ids),
            ("pattern_job_images", pattern_job_image_ids),
        ):
            if not legacy_ids:
                continue
            for chunk in _chunks(sorted(legacy_ids), 500):
                rows = self._rows(
                    "SELECT new_uuid::text AS id FROM legacy_id_mapping "
                    "WHERE legacy_table = :t AND legacy_id = ANY(:ids)",
                    t=legacy_table,
                    ids=list(chunk),
                )
                media_ids.update(r["id"] for r in rows)
        return media_ids

    def _batch_selection(self) -> tuple[int, int]:
        """(selected, already_on_r2) cho incremental batch: toàn bộ media trong closure,
        chia theo trạng thái READY (r2). Không lọc mù theo created_at."""
        if self._batch_media_ids is None:
            self._batch_media_ids = self._resolve_batch_media_ids()
        if not self._batch_media_ids:
            return 0, 0
        rows = self._rows(
            "SELECT storage_provider, status, count(*) AS n FROM media_objects "
            "WHERE id::text = ANY(:ids) GROUP BY storage_provider, status",
            ids=list(self._batch_media_ids),
        )
        selected = 0
        already = 0
        for r in rows:
            n = r.get("n") or 0
            selected += n
            if r.get("storage_provider") == "r2" and r.get("status") == "READY":
                already += n
        return selected, already

    def load_candidates(self, *, resume: bool) -> list[dict]:
        status_clause = "status = :status"
        params: dict = {"status": PENDING_STATUS}
        if resume:
            status_clause = "status IN (:s1, :s2)"
            params = {"s1": PENDING_STATUS, "s2": FAILED_STATUS}
        sql = (
            "SELECT id, object_key, original_name, content_type, size_bytes, "
            "checksum, sha256, status, storage_provider, created_at "
            "FROM media_objects "
            f"WHERE storage_provider = 'legacy' AND {status_clause} "
            "ORDER BY created_at, id"
        )
        candidates = self._rows(sql, **params)

        if self.from_date or self.to_date:
            if self._batch_media_ids is None:
                self._batch_media_ids = self._resolve_batch_media_ids()
            allowed = self._batch_media_ids
            candidates = [c for c in candidates if str(c.get("id")) in allowed]

        # Annotate legacy identity (legacy_table + legacy_id) for diagnostics.
        if candidates:
            ids = [str(c["id"]) for c in candidates]
            idmap = {}
            for chunk in _chunks(ids, 500):
                for r in self._rows(
                    "SELECT new_uuid::text AS media_id, legacy_table, legacy_id "
                    "FROM legacy_id_mapping WHERE new_table = 'media_objects' "
                    "AND new_uuid::text = ANY(:ids)",
                    ids=list(chunk),
                ):
                    mid = r["media_id"]
                    if mid not in idmap:
                        idmap[mid] = (r.get("legacy_table"), r.get("legacy_id"))
            for c in candidates:
                lt, li = idmap.get(str(c["id"]), ("", ""))
                c["legacy_table"] = lt
                c["legacy_id"] = str(li) if li is not None else ""
        return candidates

    def load_ready_checksums(self) -> dict[str, dict[str, Any]]:
        rows = self._rows(
            "SELECT checksum, object_key, bucket, size_bytes, content_type "
            "FROM media_objects WHERE storage_provider = 'r2' AND status = 'READY' "
            "AND checksum <> ''"
        )
        index: dict[str, dict[str, Any]] = {}
        for r in rows:
            cs = (r.get("checksum") or "").strip()
            if cs and cs not in index:
                index[cs] = {
                    "object_key": r.get("object_key"),
                    "bucket": r.get("bucket"),
                    "size_bytes": r.get("size_bytes"),
                    "content_type": r.get("content_type"),
                }
        return index

    def object_key_for(self, media_id: str, ext: str, created_at: datetime | None) -> str:
        dt = created_at or datetime.now(timezone.utc)
        return f"legacy-media/{dt:%Y}/{dt:%m}/{media_id}.{ext}"

    # ------------------------------------------------------------------
    # DRY-RUN
    # ------------------------------------------------------------------
    def dry_run(self, *, probe: bool = False) -> dict:
        ready_count = self._scalar(
            "SELECT count(*) FROM media_objects WHERE storage_provider = 'r2' AND status = 'READY'"
        )
        candidates = self.load_candidates(resume=False)
        total = len(candidates)
        downloadable = missing = invalid_url = 0
        estimated_bytes = 0
        invalid_details: list[dict] = []

        for c in candidates:
            key = (c.get("object_key") or "").strip()
            if not key:
                missing += 1
                invalid_details.append({"media_id": str(c["id"]), "reason": "empty_object_key"})
                continue
            try:
                url = self.config.legacy_url(key)
            except Exception as exc:  # noqa: BLE001
                invalid_url += 1
                invalid_details.append({"media_id": str(c["id"]), "reason": f"bad_url:{exc}"})
                continue
            downloadable += 1

        if probe:
            downloadable = missing = invalid_url = 0
            estimated_bytes = 0
            heads: dict[str, Any] = {}
            with ThreadPoolExecutor(max_workers=self.config.workers) as pool:
                futs = {pool.submit(self.downloader.head, (c.get("object_key") or "").strip()): c for c in candidates}
                for fut in as_completed(futs):
                    c = futs[fut]
                    key = (c.get("object_key") or "").strip()
                    if not key:
                        missing += 1
                        continue
                    status, size = fut.result()
                    if status == "ok":
                        downloadable += 1
                        if size:
                            estimated_bytes += size
                    elif status == "missing":
                        missing += 1
                        invalid_details.append({"media_id": str(c["id"]), "reason": "missing_on_legacy"})
                    else:
                        invalid_url += 1
                        invalid_details.append({"media_id": str(c["id"]), "reason": "head_error"})
                    heads[key] = status

        # incremental: selected/already_on_r2 lấy theo toàn bộ batch closure (cả READY + PENDING).
        if self.from_date or self.to_date:
            selected_total, already_on_r2 = self._batch_selection()
        else:
            selected_total = total
            ready_index = self.load_ready_checksums()
            ready_keys = {v["object_key"] for v in ready_index.values()}
            already_on_r2 = sum(
                1 for c in candidates
                if (c.get("object_key") or "").strip() in ready_keys
                or (c.get("checksum") or "").strip() in ready_index
            )
        # deduplicated: legacy object trỏ cùng object_key với một media khác trong batch.
        seen_keys: set[str] = set()
        deduplicated = 0
        for c in candidates:
            k = (c.get("object_key") or "").strip()
            if k and k in seen_keys:
                deduplicated += 1
            else:
                seen_keys.add(k)

        return {
            "selected": selected_total,
            "already_on_r2": already_on_r2,
            "will_upload": max(0, selected_total - already_on_r2),
            "deduplicated": deduplicated,
            "missing_source": missing,
            "failed": invalid_url,
            "total_bytes": estimated_bytes,
            # backward-compat keys (giữ summary cũ)
            "total": total,
            "downloadable": downloadable,
            "missing": missing,
            "invalid_url": invalid_url,
            "already_ready": ready_count,
            "duplicate_checksum": deduplicated,
            "estimated_bytes": estimated_bytes,
            "invalid_details": invalid_details,
        }

    # ------------------------------------------------------------------
    # APPLY
    # ------------------------------------------------------------------
    def apply(self, *, resume: bool = False) -> ApplyStats:
        stats = ApplyStats()
        self._checksum_index = self.load_ready_checksums()
        candidates = self.load_candidates(resume=resume)
        stats.processed = 0

        batch_size = max(1, self.config.batch_size)
        for start in range(0, len(candidates), batch_size):
            batch = candidates[start:start + batch_size]
            # Phase A: parallel download + checksum (memory bounded to one batch).
            results: list[ItemResult] = []
            with ThreadPoolExecutor(max_workers=self.config.workers) as pool:
                futures = {pool.submit(self._transfer_one, c): c for c in batch}
                for fut in as_completed(futures):
                    results.append(fut.result())
            # Phase B: sequential dedupe/upload/persist to avoid duplicate uploads.
            for res in results:
                stats.processed += 1
                self._persist(res, stats)

        return stats

    def _transfer_one(self, c: dict) -> ItemResult:
        media_id = str(c["id"])
        key = (c.get("object_key") or "").strip()
        created_at = c.get("created_at")
        base = {
            "media_id": media_id,
            "object_key": key,
            "legacy_table": c.get("legacy_table") or "",
            "legacy_id": c.get("legacy_id") or "",
            "r2_bucket": self.config.r2_bucket,
        }
        if not key:
            return ItemResult(**base, action="failed", stage="resolve_source", error="empty_object_key")

        try:
            url = self.config.legacy_url(key)
        except Exception as exc:  # noqa: BLE001
            return ItemResult(**base, action="failed", stage="resolve_source",
                              error_type=type(exc).__name__, error=f"bad_url: {exc}")

        dl = self.downloader.download(key)
        if not dl.ok:
            return ItemResult(**base, action="failed", stage="download",
                              error_type=dl.error_type, http_status=dl.http_status, error=dl.error)

        checksum = sha256_hex(dl.data)
        return ItemResult(
            **base,
            action="uploaded",
            checksum=checksum,
            size_bytes=len(dl.data),
            content_type=dl.content_type,
            ext=dl.ext,
            data=dl.data,
            r2_object_key=self.object_key_for(media_id, dl.ext, created_at),
        )

    def _fail(self, res: ItemResult, stats: ApplyStats) -> None:
        """Ghi thất bại với đầy đủ diagnostic (không log secret)."""
        stats.failed += 1
        stats.failed_items.append({
            "media_id": res.media_id,
            "legacy_table": res.legacy_table,
            "legacy_id": res.legacy_id,
            "source_bucket": self.config.legacy_supabase_bucket,
            "source_path": res.object_key,
            "target_object_key": res.r2_object_key or self.object_key_for(res.media_id, res.ext or "bin", None),
            "stage": res.stage,
            "error_type": res.error_type,
            "error": res.error,
            "http_status": res.http_status,
        })

    def _persist(self, res: ItemResult, stats: ApplyStats) -> None:
        if res.action == "failed":
            self._mark_failed(res)
            self._fail(res, stats)
            return

        # Dedupe: reuse an existing READY object when checksum already known.
        existing = self._checksum_index.get(res.checksum)
        if existing:
            self._update_ready(
                res,
                object_key=existing["object_key"],
                bucket=existing["bucket"],
                size_bytes=existing.get("size_bytes") or res.size_bytes,
                content_type=existing.get("content_type") or res.content_type,
            )
            stats.deduplicated += 1
            stats.deduplicated_items.append({
                "media_id": res.media_id,
                "legacy_object_key": res.object_key,
                "r2_object_key": existing["object_key"],
                "checksum": res.checksum,
                "size_bytes": existing.get("size_bytes") or res.size_bytes,
            })
            return

        # Upload (only when the checksum is not already present on R2).
        up = self.uploader.upload(
            object_key=res.r2_object_key,
            data=res.data,
            content_type=res.content_type,
            sha256=res.checksum,
        )
        if not up.ok:
            res.stage = "upload_r2"
            res.error = up.error
            res.error_type = up.error_type
            res.http_status = up.http_status
            self._mark_failed(res)
            self._fail(res, stats)
            return

        # Best-effort thumbnail: gallery grids use <original>.thumb.webp directly,
        # so generate + persist it at upload time. A thumbnail failure must not
        # fail the (already successful) original upload.
        if (res.content_type or "").startswith("image/"):
            try:
                thumb = _resize_to_webp(res.data, max_width=400)
                if thumb is not None:
                    thumb_data, thumb_mime = thumb
                    self.uploader.upload(
                        object_key=_thumbnail_key(res.r2_object_key),
                        data=thumb_data,
                        content_type=thumb_mime,
                        sha256=sha256_hex(thumb_data),
                    )
            except Exception:  # noqa: BLE001 - thumbnail is non-critical
                pass

        self._update_ready(
            res,
            object_key=res.r2_object_key,
            bucket=res.r2_bucket,
            size_bytes=res.size_bytes,
            content_type=res.content_type,
        )
        self._checksum_index[res.checksum] = {
            "object_key": res.r2_object_key,
            "bucket": res.r2_bucket,
            "size_bytes": res.size_bytes,
            "content_type": res.content_type,
        }
        stats.uploaded += 1
        stats.bytes_uploaded += res.size_bytes
        stats.uploaded_items.append({
            "media_id": res.media_id,
            "legacy_object_key": res.object_key,
            "r2_object_key": res.r2_object_key,
            "checksum": res.checksum,
            "size_bytes": res.size_bytes,
            "content_type": res.content_type,
        })

    def probe_single(self, media_id: str, *, upload: bool) -> dict:
        """Chẩn đoán 1 media (read-only download; tùy chọn upload test lên R2, KHÔNG ghi DB).

        Trả về dict chi tiết từng stage, không nuốt exception, không log secret.
        """
        rows = self._rows(
            "SELECT m.id, m.object_key, m.content_type, m.size_bytes, m.checksum, m.sha256, "
            "       m.status, m.storage_provider, m.created_at, "
            "       l.legacy_table, l.legacy_id "
            "FROM media_objects m "
            "LEFT JOIN legacy_id_mapping l ON l.new_uuid = m.id AND l.new_table = 'media_objects' "
            "WHERE m.id::text = :id",
            id=media_id,
        )
        if not rows:
            return {"ok": False, "stage": "resolve_source", "error": "media_id not found", "media_id": media_id}
        c = rows[0]
        out: dict = {
            "media_id": media_id,
            "legacy_table": c.get("legacy_table"),
            "legacy_id": str(c.get("legacy_id")) if c.get("legacy_id") is not None else None,
            "source_bucket": self.config.legacy_supabase_bucket,
            "source_path": c.get("object_key"),
            "status": c.get("status"),
            "storage_provider": c.get("storage_provider"),
        }
        key = (c.get("object_key") or "").strip()
        if not key:
            out.update(ok=False, stage="resolve_source", error="empty_object_key")
            return out

        # stage: resolve_source
        try:
            url = self.config.legacy_url(key)
            out["source_url"] = _redact_url(url)
        except Exception as exc:  # noqa: BLE001
            out.update(ok=False, stage="resolve_source", error_type=type(exc).__name__, error=f"bad_url: {exc}")
            return out

        # stage: download
        dl = self.downloader.download(key)
        if not dl.ok:
            out.update(ok=False, stage="download", error_type=dl.error_type,
                       error=dl.error, http_status=dl.http_status)
            return out
        out["downloaded_bytes"] = len(dl.data)
        out["detected_content_type"] = dl.content_type

        # stage: checksum
        checksum = sha256_hex(dl.data)
        out["checksum"] = checksum

        # stage: upload_r2 (optional)
        target_key = self.object_key_for(media_id, dl.ext, c.get("created_at"))
        out["target_object_key"] = target_key
        if not upload:
            out.update(ok=True, stage="checksum", error=None,
                       error_type=None, http_status=None,
                       note="download+checksum OK (không upload vì --probe-download)")
            return out

        up = self.uploader.upload(object_key=target_key, data=dl.data, content_type=dl.content_type, sha256=checksum)
        if not up.ok:
            out.update(ok=False, stage="upload_r2", error_type=up.error_type,
                       error=up.error, http_status=up.http_status)
            return out
        out.update(ok=True, stage="upload_r2", error=None, error_type=None, http_status=None,
                   uploaded=True, r2_bucket=self.config.r2_bucket)
        return out

    def _mark_failed(self, res: ItemResult) -> None:
        with self.engine.begin() as conn:
            conn.execute(
                text("UPDATE media_objects SET status = :s WHERE id = :id"),
                {"s": FAILED_STATUS, "id": uuid.UUID(res.media_id)},
            )

    def _update_ready(
        self,
        res: ItemResult,
        *,
        object_key: str,
        bucket: str | None,
        size_bytes: int,
        content_type: str,
    ) -> None:
        with self.engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE media_objects SET storage_provider = 'r2', storage = 'R2', "
                    "bucket = :b, object_key = :k, content_type = :ct, size_bytes = :sz, "
                    "checksum = :cs, sha256 = :cs, status = 'READY' WHERE id = :id"
                ),
                {
                    "b": bucket,
                    "k": object_key,
                    "ct": content_type,
                    "sz": size_bytes,
                    "cs": res.checksum,
                    "id": uuid.UUID(res.media_id),
                },
            )

    # ------------------------------------------------------------------
    # VERIFY
    # ------------------------------------------------------------------
    def verify(self) -> dict:
        total = self._scalar("SELECT count(*) FROM media_objects")
        ready = self._rows(
            "SELECT id, object_key, bucket, checksum, size_bytes FROM media_objects "
            "WHERE storage_provider = 'r2' AND status = 'READY' ORDER BY id"
        )
        pending = self._scalar(
            f"SELECT count(*) FROM media_objects WHERE storage_provider = 'legacy' AND status IN ('{PENDING_STATUS}','{FAILED_STATUS}')"
        )
        order_media = self._scalar("SELECT count(*) FROM order_media")

        missing_on_r2 = 0
        size_mismatch = 0
        checksum_mismatch = 0
        total_bytes = 0
        with ThreadPoolExecutor(max_workers=self.config.workers) as pool:
            futs = {pool.submit(self.uploader.head, r["object_key"]): r for r in ready}
            for fut in as_completed(futs):
                r = futs[fut]
                exists, size, meta_sha = fut.result()
                if not exists:
                    missing_on_r2 += 1
                    continue
                if size is not None and r["size_bytes"] and int(size) != int(r["size_bytes"]):
                    size_mismatch += 1
                if meta_sha and meta_sha != r["checksum"]:
                    checksum_mismatch += 1
                total_bytes += int(r["size_bytes"] or 0)

        ok = missing_on_r2 == 0 and size_mismatch == 0 and checksum_mismatch == 0
        return {
            "total_media": total,
            "ready_count": len(ready),
            "pending_count": pending,
            "order_media_count": order_media,
            "missing_on_r2": missing_on_r2,
            "size_mismatch": size_mismatch,
            "checksum_mismatch": checksum_mismatch,
            "total_bytes": total_bytes,
            "ok": ok,
        }

    def close(self) -> None:
        self.engine.dispose()
        self.downloader.close()
