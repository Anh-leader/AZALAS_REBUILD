"""isolate monthly printing partner transactions

Revision ID: 20261012_0019
Revises: 20261012_0018
"""

import uuid

from alembic import op
import sqlalchemy as sa

revision = "20261012_0019"
down_revision = "20261012_0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # nhat_in_month_transactions.partner_id and the partial unique index on
    # partner_settlements are created by the baseline revision 20261009_0001 via
    # Base.metadata.create_all(checkfirst=True). This migration only backfills
    # partner_id for any pre-existing printing transactions (data, not schema).
    connection = op.get_bind()
    partner_id = connection.scalar(sa.text(
        "SELECT id FROM partners WHERE partner_code = 'TUNG_IN'"
    ))
    if partner_id is None:
        connection.execute(sa.text(
            "INSERT INTO partners (id, partner_code, name, partner_type, status, created_at, updated_at) "
            "VALUES (:id, 'TUNG_IN', 'TÙNG - IN', 'PRINTING', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ), {"id": uuid.uuid4()})
    connection.execute(sa.text(
        "UPDATE nhat_in_month_transactions "
        "SET partner_id = (SELECT id FROM partners WHERE partner_code = 'NHAT_IN') "
        "WHERE partner_id IS NULL"
    ))
    if connection.scalar(sa.text(
        "SELECT COUNT(*) FROM nhat_in_month_transactions WHERE partner_id IS NULL"
    )):
        raise RuntimeError(
            "Cannot assign existing printing transactions to NHAT_IN; "
            "create the legacy NHAT_IN partner before upgrading."
        )


def downgrade() -> None:
    # Forward-only data backfill; no schema to reverse.
    pass
