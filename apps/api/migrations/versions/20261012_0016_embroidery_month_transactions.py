"""embroidery month transactions (cong no theo thang)

Revision ID: 20261012_0016
Revises: 20261012_0015
"""

from alembic import op

revision = "20261012_0016"
down_revision = "20261012_0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # embroidery_month_transactions is created by the baseline revision
    # 20261009_0001 via Base.metadata.create_all(checkfirst=True).
    pass


def downgrade() -> None:
    # The table is owned by the baseline revision; do not drop it here.
    pass
