"""Persistent legacy -> new ID mapping design (in-memory during DRY-RUN).

Design contract:
    legacy_table : string  (e.g. "az_customers")
    legacy_id    : string  (bigint/uuid rendered as text)
    new_table    : string  (e.g. "customers")
    new_uuid     : uuid    (the generated UUID for the target row)
    business_key : string  (nullable; customer_code / order_no / invoice_no)

On --apply, this registry is persisted into a `legacy_id_mapping` table in NEW;
on --dry-run it only lives in memory and is exported to CSV.
"""
from __future__ import annotations

import uuid

LEGACY_ID_MAPPING_TABLE = "legacy_id_mapping"

LEGACY_ID_MAPPING_DDL = """
CREATE TABLE IF NOT EXISTS legacy_id_mapping (
    legacy_table text NOT NULL,
    legacy_id    text NOT NULL,
    new_table    text NOT NULL,
    new_uuid     uuid NOT NULL,
    business_key text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (legacy_table, legacy_id)
);
"""


class IdMap:
    """In-memory bidirectional mapping registry."""

    def __init__(self) -> None:
        self._rows: dict[tuple[str, str], dict] = {}

    def add(
        self,
        legacy_table: str,
        legacy_id: str | int | uuid.UUID,
        new_table: str,
        business_key: str | None = None,
        new_uuid: uuid.UUID | None = None,
    ) -> uuid.UUID:
        key = (legacy_table, str(legacy_id))
        new_uuid = new_uuid or uuid.uuid4()
        self._rows[key] = {
            "legacy_table": legacy_table,
            "legacy_id": str(legacy_id),
            "new_table": new_table,
            "new_uuid": new_uuid,
            "business_key": business_key,
        }
        return new_uuid

    def load(
        self,
        legacy_table: str,
        legacy_id: str,
        new_table: str,
        business_key: str | None,
        new_uuid: uuid.UUID,
    ) -> None:
        """Seed an existing mapping (loaded from the persisted table) without generating a new UUID."""
        self._rows[(legacy_table, str(legacy_id))] = {
            "legacy_table": legacy_table,
            "legacy_id": str(legacy_id),
            "new_table": new_table,
            "new_uuid": new_uuid,
            "business_key": business_key,
        }

    def get(self, legacy_table: str, legacy_id: str | int | uuid.UUID | None):
        if legacy_id is None:
            return None
        return self._rows.get((legacy_table, str(legacy_id)))

    def uuid(self, legacy_table: str, legacy_id: str | int | uuid.UUID | None):
        row = self.get(legacy_table, legacy_id)
        return row["new_uuid"] if row else None

    def __len__(self) -> int:
        return len(self._rows)

    def rows(self) -> list[dict]:
        return sorted(
            self._rows.values(),
            key=lambda r: (r["legacy_table"], r["legacy_id"]),
        )
