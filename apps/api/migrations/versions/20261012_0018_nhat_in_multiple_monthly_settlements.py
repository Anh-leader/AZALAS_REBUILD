"""allow multiple Japanese printing settlements in one month

Revision ID: 20261012_0018
Revises: 20261012_0017
"""

from alembic import op

revision = "20261012_0018"
down_revision = "20261012_0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The partial unique index uq_partner_settlement_period_non_nhat_in was
    # superseded by uq_partner_settlement_period_non_printing, which is already
    # present in the baseline revision 20261009_0001 metadata. Nothing to do.
    pass


def downgrade() -> None:
    # Owned by later state in the baseline metadata; nothing to reverse.
    pass
