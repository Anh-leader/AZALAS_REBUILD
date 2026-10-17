"""So sánh schema Supabase OLD vs current SQLAlchemy/Alembic metadata.

Đọc OLD qua SQLAlchemy inspector (OLD_DATABASE_URL), so với `Base.metadata`
hiện tại. Output: bảng/column OLD có mà NEW thiếu, và type mismatch.
"""
from __future__ import annotations

from sqlalchemy import create_engine, inspect
from sqlalchemy.engine import Engine


def current_metadata_schema() -> dict[str, dict[str, str]]:
    """Trả {table: {column: type_string}} từ Base.metadata hiện tại."""
    from app.core.db import Base
    result: dict[str, dict[str, str]] = {}
    for table in Base.metadata.sorted_tables:
        cols = {col.name: str(col.type) for col in table.columns}
        result[table.name] = cols
    return result


def inspect_old_schema(engine: Engine) -> dict[str, dict[str, str]]:
    inspector = inspect(engine)
    result: dict[str, dict[str, str]] = {}
    for table_name in inspector.get_table_names():
        cols = {col["name"]: str(col["type"]) for col in inspector.get_columns(table_name)}
        result[table_name] = cols
    return result


def compare_schema(old: dict[str, dict[str, str]], new: dict[str, dict[str, str]]) -> dict:
    report: dict = {
        "tables_missing_in_new": sorted(set(old) - set(new)),
        "tables_only_in_new": sorted(set(new) - set(old)),
        "columns_missing_in_new": {},
        "type_mismatches": {},
    }
    for table, old_cols in old.items():
        if table not in new:
            continue
        new_cols = new[table]
        missing = sorted(set(old_cols) - set(new_cols))
        if missing:
            report["columns_missing_in_new"][table] = missing
        mismatches = []
        for col, old_type in old_cols.items():
            if col in new_cols and new_cols[col] != old_type:
                mismatches.append({"column": col, "old": old_type, "new": new_cols[col]})
        if mismatches:
            report["type_mismatches"][table] = mismatches
    return report


def compare_old_to_current(old_url: str) -> dict:
    engine = create_engine(old_url, pool_pre_ping=True)
    try:
        old = inspect_old_schema(engine)
    finally:
        engine.dispose()
    return compare_schema(old, current_metadata_schema())
