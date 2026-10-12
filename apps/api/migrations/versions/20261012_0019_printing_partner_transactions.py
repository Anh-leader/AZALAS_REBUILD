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
    op.drop_index("uq_partner_settlement_period_non_nhat_in", table_name="partner_settlements")
    op.create_index(
        "uq_partner_settlement_period_non_printing",
        "partner_settlements",
        ["partner_id", "period_month", "settlement_type"],
        unique=True,
        postgresql_where=sa.text("settlement_type NOT IN ('NHAT_IN', 'TUNG_IN')"),
    )
    connection = op.get_bind()
    partner_id = connection.scalar(sa.text(
        "SELECT id FROM partners WHERE partner_code = 'TUNG_IN'"
    ))
    if partner_id is None:
        connection.execute(sa.text(
            "INSERT INTO partners (id, partner_code, name, partner_type, status, created_at, updated_at) "
            "VALUES (:id, 'TUNG_IN', 'TÙNG - IN', 'PRINTING', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ), {"id": uuid.uuid4()})
    op.add_column(
        "nhat_in_month_transactions",
        sa.Column("partner_id", sa.Uuid(), nullable=True),
    )
    op.execute(sa.text(
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
    op.alter_column("nhat_in_month_transactions", "partner_id", nullable=False)
    op.create_foreign_key(
        "fk_nhat_in_month_transactions_partner_id_partners",
        "nhat_in_month_transactions",
        "partners",
        ["partner_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        "ix_nhat_in_month_transactions_partner_id",
        "nhat_in_month_transactions",
        ["partner_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_nhat_in_month_transactions_partner_id", table_name="nhat_in_month_transactions")
    op.drop_constraint(
        "fk_nhat_in_month_transactions_partner_id_partners",
        "nhat_in_month_transactions",
        type_="foreignkey",
    )
    op.drop_column("nhat_in_month_transactions", "partner_id")
    op.drop_index("uq_partner_settlement_period_non_printing", table_name="partner_settlements")
    op.create_index(
        "uq_partner_settlement_period_non_nhat_in",
        "partner_settlements",
        ["partner_id", "period_month", "settlement_type"],
        unique=True,
        postgresql_where=sa.text("settlement_type != 'NHAT_IN'"),
    )
