"""allow multiple Japanese printing settlements in one month

Revision ID: 20261012_0018
Revises: 20261012_0017
"""

from alembic import op
import sqlalchemy as sa

revision = "20261012_0018"
down_revision = "20261012_0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("uq_partner_settlement_period", "partner_settlements", type_="unique")
    op.create_index(
        "uq_partner_settlement_period_non_nhat_in",
        "partner_settlements",
        ["partner_id", "period_month", "settlement_type"],
        unique=True,
        postgresql_where=sa.text("settlement_type != 'NHAT_IN'"),
    )


def downgrade() -> None:
    op.drop_index("uq_partner_settlement_period_non_nhat_in", table_name="partner_settlements")
    op.create_unique_constraint(
        "uq_partner_settlement_period",
        "partner_settlements",
        ["partner_id", "period_month", "settlement_type"],
    )
