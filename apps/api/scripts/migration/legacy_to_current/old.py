"""Đọc dữ liệu Supabase OLD (legacy schema) bằng raw SQL -> list[dict].

KHÔNG đụng SessionLocal (target NEW). Chỉ SELECT từ OLD engine.
"""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import Engine


def read_all(engine: Engine, table: str) -> list[dict]:
    with engine.connect() as conn:
        rows = conn.execute(text(f'SELECT * FROM "{table}"')).mappings()
        return [dict(r) for r in rows]


def read_query(engine: Engine, sql: str, **params) -> list[dict]:
    with engine.connect() as conn:
        rows = conn.execute(text(sql), params or None).mappings()
        return [dict(r) for r in rows]


def scalar(engine: Engine, sql: str, **params):
    with engine.connect() as conn:
        return conn.execute(text(sql), params or None).scalar()
