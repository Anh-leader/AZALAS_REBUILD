"""DRY-RUN migration Supabase OLD (legacy schema) -> Supabase NEW (current schema).

Read-only by default: connects to OLD_SUPABASE_DATABASE_URL (source) and
NEW_SUPABASE_DATABASE_URL (target) but never writes to NEW.

Run:
    python -m scripts.migration.legacy_to_current --dry-run
"""
