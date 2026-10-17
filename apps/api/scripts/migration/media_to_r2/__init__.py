"""Migrate legacy media_objects (storage_provider='legacy') to Cloudflare R2.

Commands:
    python -m scripts.migration.media_to_r2 --dry-run
    python -m scripts.migration.media_to_r2 --apply
    python -m scripts.migration.media_to_r2 --resume
    python -m scripts.migration.media_to_r2 --verify-only
"""
