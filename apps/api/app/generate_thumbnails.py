"""One-off backfill: pre-generate immutable R2 thumbnail objects.

Reads every READY image media object, generates a 400px WebP thumbnail, and
stores it as ``<original_key>.thumb.webp``. It never modifies the original
object, is idempotent (skips when the thumbnail already exists), and defaults to
dry-run so nothing is written to production R2 until ``--apply`` is passed.

Usage (from apps/api):
    .\\.venv\\Scripts\\python.exe -m app.generate_thumbnails --dry-run
    .\\.venv\\Scripts\\python.exe -m app.generate_thumbnails --apply
"""

import argparse

from sqlalchemy import select

from .core.db import SessionLocal
from .models import MediaObject
from .services import media as media_svc
from .services.storage import get_storage_service, thumbnail_object_key


def _resolve_provider(media: MediaObject) -> str:
    provider = (media.storage_provider or "").lower()
    if provider == "s3" or (not provider and media.storage == "S3"):
        return "s3"
    return provider or "local"


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill R2 thumbnail objects.")
    parser.add_argument("--apply", action="store_true", help="Write thumbnail objects (default: dry-run).")
    parser.add_argument("--limit", type=int, default=0, help="Only process the first N media (0 = all).")
    args = parser.parse_args()

    db = SessionLocal()
    stmt = select(MediaObject).where(
        MediaObject.status == "READY",
        MediaObject.content_type.like("image/%"),
    )
    if args.limit:
        stmt = stmt.limit(args.limit)
    rows = list(db.scalars(stmt).all())

    storage = get_storage_service("r2")
    created = 0
    skipped = 0
    failed = 0
    for media in rows:
        provider = _resolve_provider(media)
        if provider != "r2":
            skipped += 1
            continue
        thumb_key = thumbnail_object_key(media.object_key)
        if storage.exists(bucket=media.bucket, object_key=thumb_key):
            skipped += 1
            continue
        try:
            data = storage.read(bucket=media.bucket, object_key=media.object_key)
            resized = media_svc.resize_to_webp(data, max_width=400)
            if resized is None:
                failed += 1
                continue
            payload, mime = resized
            if args.apply:
                storage.put(
                    object_key=thumb_key,
                    data=payload,
                    content_type=mime,
                    cache_control=media_svc.THUMB_CACHE_CONTROL,
                )
            created += 1
        except Exception as exc:  # noqa: BLE001 - report and continue
            failed += 1
            print(f"FAIL {media.id}: {exc}")

    print(
        f"total={len(rows)} created={created} skipped_existing_or_non_r2={skipped} failed={failed}"
    )
    if not args.apply:
        print("DRY-RUN: no objects written. Re-run with --apply to write.")


if __name__ == "__main__":
    main()
