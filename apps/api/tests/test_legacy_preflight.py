"""Unit tests cho preflight revision check của legacy->current migration.

Chỉ kiểm tra logic thuần (head/lineage/validate), KHÔNG đụng Supabase OLD/NEW
và KHÔNG chạy --apply.
"""
from __future__ import annotations

from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

from scripts.migration.legacy_to_current.applier import (
    HEAD_REVISION,
    VALID_LINEAGE,
    _resolve_head_and_lineage,
    validate_target_revision,
)


def _alembic_script() -> ScriptDirectory:
    api_root = Path(__file__).resolve().parents[1]  # .../apps/api
    cfg = Config()
    cfg.set_main_option("script_location", str(api_root / "migrations"))
    return ScriptDirectory.from_config(cfg)


def test_head_and_lineage_match_codebase():
    script = _alembic_script()
    head, lineage = _resolve_head_and_lineage()
    assert head == script.get_current_head()
    assert HEAD_REVISION == head
    assert VALID_LINEAGE == {rev.revision for rev in script.walk_revisions()}
    assert head in lineage


def test_validate_target_revision_accepts_current_head():
    assert validate_target_revision(HEAD_REVISION) is None


def test_validate_target_revision_rejects_stale_ancestor():
    script = _alembic_script()
    head = script.get_current_head()
    ancestor = next(rev.revision for rev in script.walk_revisions() if rev.revision != head)
    error = validate_target_revision(ancestor)
    assert error is not None
    assert "chưa migrate đủ" in error
    assert head in error


def test_validate_target_revision_rejects_unknown_revision():
    error = validate_target_revision("20991231_9999")
    assert error is not None
    assert "không thuộc lineage" in error


def test_validate_target_revision_none_is_noop():
    assert validate_target_revision(None) is None
