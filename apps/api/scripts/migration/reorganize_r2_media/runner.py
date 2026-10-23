"""Safe R2 media reorganization: copy old -> new, verify, then update DB.

--dry-run and --verify-only never write. --apply copies objects and updates
media_objects.object_key but NEVER deletes the old object. --cleanup-old deletes
old objects only after a successful verify confirms the new object exists and
the DB already points at it.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services.storage import R2StorageService

from .classifier import MediaRecord, classify, build_plan


@dataclass
class DryRunResult:
    total_media: int = 0
    orders_count: int = 0
    orders_shared_count: int = 0
    invoices_count: int = 0
    production_count: int = 0
    patterns_count: int = 0
    partners_count: int = 0
    other_count: int = 0
    legacy_media_count: int = 0
    private_media_count: int = 0
    will_copy: int = 0
    already_new_structure: int = 0
    missing_source: int = 0
    missing_thumbnail: int = 0
    conflicts: int = 0
    conflict_unresolved: int = 0
    unmapped: int = 0
    total_bytes_to_copy: int = 0
    plan: list[dict] = field(default_factory=list)
    conflict_rows: list[dict] = field(default_factory=list)


def _is_image(rec: MediaRecord) -> bool:
    return (rec.content_type or "").startswith("image/")


def build_dry_run(db: Session, storage: R2StorageService, *, probe: bool = True) -> DryRunResult:
    """Build the full plan + report (read-only)."""
    records = classify(db)
    plan = build_plan(records)

    result = DryRunResult(total_media=len(plan))
    count_field = {
        "order": "orders_count",
        "order_shared": "orders_shared_count",
        "invoice": "invoices_count",
        "production": "production_count",
        "pattern": "patterns_count",
        "partner": "partners_count",
        "other": "other_count",
    }
    for rec in plan:
        # category counts
        setattr(result, count_field[rec.category], getattr(result, count_field[rec.category]) + 1)
        # old-prefix counts
        if rec.object_key.startswith("legacy-media/"):
            result.legacy_media_count += 1
        elif rec.object_key.startswith("private-media/"):
            result.private_media_count += 1

        if rec.conflicts:
            result.conflicts += 1
            for conflict in rec.conflicts:
                result.conflict_rows.append({
                    "media_id": str(rec.media_id),
                    "category": rec.category,
                    "business_code": rec.business_code or "",
                    "conflict_category": conflict["category"],
                    "conflict_business_code": conflict["business_code"] or "",
                })
        if rec.category == "other":
            result.unmapped += 1

        if rec.plan_status == "already_new_structure":
            result.already_new_structure += 1
        elif rec.plan_status == "conflict_unresolved":
            result.conflict_unresolved += 1
        else:
            result.will_copy += 1
            result.total_bytes_to_copy += rec.size_bytes

        if probe and rec.plan_status == "will_copy":
            if not storage.exists(bucket=rec.bucket, object_key=rec.object_key):
                rec.plan_status = "missing_source"
                result.missing_source += 1
            elif _is_image(rec) and not storage.exists(bucket=rec.bucket, object_key=rec.thumbnail_old_key):
                result.missing_thumbnail += 1

        result.plan.append({
            "media_id": str(rec.media_id),
            "category": rec.category,
            "business_code": rec.business_code or "",
            "old_key": rec.object_key,
            "new_key": rec.new_key,
            "thumbnail_old_key": rec.thumbnail_old_key,
            "thumbnail_new_key": rec.thumbnail_new_key,
            "size_bytes": rec.size_bytes,
            "created_at": rec.created_at.isoformat() if rec.created_at else "",
            "business_date": rec.business_date.isoformat() if rec.business_date else "",
            "status": rec.plan_status,
        })

    return result


@dataclass
class ApplyResult:
    copied: int = 0
    skipped: int = 0
    failed: int = 0
    bytes_copied: int = 0
    failed_items: list[dict] = field(default_factory=list)
    mapping: list[dict] = field(default_factory=list)


def apply(db: Session, storage: R2StorageService, *, batch_size: int = 100) -> ApplyResult:
    """Copy old -> new (with verify), then update DB per batch. Never deletes."""
    records = build_plan(classify(db))
    to_copy = [r for r in records if r.plan_status == "will_copy"]
    result = ApplyResult()
    for start in range(0, len(to_copy), batch_size):
        batch = to_copy[start:start + batch_size]
        for rec in batch:
            old_key = rec.object_key
            try:
                _copy_one(db, storage, rec)
                result.copied += 1
                result.bytes_copied += rec.size_bytes
                result.mapping.append({
                    "media_id": str(rec.media_id),
                    "old_key": old_key,
                    "new_key": rec.new_key,
                    "size_bytes": rec.size_bytes,
                })
            except Exception as exc:  # noqa: BLE001
                result.failed += 1
                result.failed_items.append({
                    "media_id": str(rec.media_id),
                    "old_key": old_key,
                    "new_key": rec.new_key,
                    "error": f"{type(exc).__name__}: {exc}",
                })
        db.commit()
    return result


def _copy_one(db: Session, storage: R2StorageService, rec: MediaRecord) -> None:
    # 1. source must exist
    if not storage.exists(bucket=rec.bucket, object_key=rec.object_key):
        raise RuntimeError("source object missing on R2")
    # 2. copy source -> new
    storage.copy_object(
        source_key=rec.object_key,
        dest_key=rec.new_key,
        metadata={"sha256": rec.sha256 or "", "checksum": rec.checksum or ""},
    )
    # 3. verify new object (size)
    head = storage.head_object(object_key=rec.new_key)
    if head is None:
        raise RuntimeError("new object missing after copy")
    if head.get("ContentLength") != rec.size_bytes and rec.size_bytes > 0:
        raise RuntimeError(
            f"size mismatch after copy: expected {rec.size_bytes}, got {head.get('ContentLength')}"
        )
    # 4. copy thumbnail if present
    if _is_image(rec):
        if storage.exists(bucket=rec.bucket, object_key=rec.thumbnail_old_key):
            storage.copy_object(source_key=rec.thumbnail_old_key, dest_key=rec.thumbnail_new_key)
            if storage.head_object(object_key=rec.thumbnail_new_key) is None:
                raise RuntimeError("thumbnail missing after copy")
    # 5. update DB object_key
    db.execute(
        text("UPDATE media_objects SET object_key = :new_key WHERE id = :mid"),
        {"new_key": rec.new_key, "mid": str(rec.media_id)},
    )
    rec.object_key = rec.new_key


@dataclass
class VerifyResult:
    verified: int = 0
    missing_on_r2: int = 0
    size_mismatch: int = 0
    checksum_mismatch: int = 0
    thumbnail_missing: int = 0
    db_mapping_mismatch: int = 0
    ok: bool = False
    details: list[dict] = field(default_factory=list)


def verify(db: Session, storage: R2StorageService) -> VerifyResult:
    """Verify every media object's DB key exists on R2 with matching size/checksum."""
    result = VerifyResult()
    records = build_plan(classify(db))
    for rec in records:
        result.verified += 1
        head = storage.head_object(object_key=rec.object_key)
        if head is None:
            result.missing_on_r2 += 1
            result.details.append({"media_id": str(rec.media_id), "object_key": rec.object_key, "issue": "missing_on_r2"})
            continue
        if rec.size_bytes > 0 and head.get("ContentLength") != rec.size_bytes:
            result.size_mismatch += 1
            result.details.append({"media_id": str(rec.media_id), "object_key": rec.object_key, "issue": "size_mismatch"})
        meta = head.get("Metadata") or {}
        if rec.sha256 and meta.get("sha256") and meta["sha256"] != rec.sha256:
            result.checksum_mismatch += 1
            result.details.append({"media_id": str(rec.media_id), "object_key": rec.object_key, "issue": "checksum_mismatch"})
        if _is_image(rec):
            thumb_key = rec.thumbnail_new_key
            if storage.head_object(object_key=thumb_key) is None:
                # thumb may legitimately not exist for some images; report it.
                result.thumbnail_missing += 1
                result.details.append({"media_id": str(rec.media_id), "object_key": rec.object_key, "issue": "thumbnail_missing"})

    result.ok = (
        result.missing_on_r2 == 0
        and result.size_mismatch == 0
        and result.checksum_mismatch == 0
    )
    return result


@dataclass
class CleanupResult:
    would_delete: int = 0
    deleted: int = 0
    skipped: int = 0
    plan: list[dict] = field(default_factory=list)


def cleanup_old(db: Session, storage: R2StorageService, mapping: list[dict], *, dry_run: bool = True) -> CleanupResult:
    """Delete OLD objects after a successful apply, only when safe.

    ``mapping`` is the apply manifest (list of {media_id, old_key, new_key, ...}).
    An old object is deleted only when ALL of:
      1. DB currently points to the new key (media_objects.object_key == new_key)
      2. the new object exists on R2 with matching size
      3. the old object still exists (and differs from new)
    Dry-run reports ``would_delete`` without deleting.
    """
    result = CleanupResult()
    for entry in mapping:
        media_id = entry["media_id"]
        old_key = entry["old_key"]
        new_key = entry["new_key"]
        size_bytes = entry.get("size_bytes") or 0

        row = db.execute(
            text("SELECT object_key FROM media_objects WHERE id = :mid"),
            {"mid": media_id},
        ).first()
        if row is None or row[0] != new_key:
            result.skipped += 1
            continue
        new_head = storage.head_object(object_key=new_key)
        if new_head is None:
            result.skipped += 1
            continue
        if size_bytes > 0 and new_head.get("ContentLength") != size_bytes:
            result.skipped += 1
            continue
        if not storage.exists(bucket=None, object_key=old_key) or old_key == new_key:
            result.skipped += 1
            continue

        result.plan.append({"media_id": media_id, "old_key": old_key, "new_key": new_key})
        result.would_delete += 1
        if not dry_run:
            try:
                from app.core.config import settings

                storage._client().delete_object(Bucket=settings.r2_bucket, Key=old_key)
                result.deleted += 1
            except Exception:  # noqa: BLE001
                result.skipped += 1

    return result
