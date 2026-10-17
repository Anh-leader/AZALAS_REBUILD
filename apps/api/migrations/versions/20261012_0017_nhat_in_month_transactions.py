"""nhat-in month transactions and settlement media

Revision ID: 20261012_0017
Revises: 20261012_0016
"""

from alembic import op

revision = "20261012_0017"
down_revision = "20261012_0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # partner_settlements.media_id and the nhat_in_month_transactions table are
    # created by the baseline revision 20261009_0001 via
    # Base.metadata.create_all(checkfirst=True). Nothing extra to do here.
    pass


def downgrade() -> None:
    # Objects are owned by the baseline revision; do not drop them here.
    pass
