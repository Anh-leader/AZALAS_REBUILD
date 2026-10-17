"""zipper month transactions (cong no theo thang)

Revision ID: 20261012_0015
Revises: 20261012_0014
"""

from alembic import op

revision = "20261012_0015"
down_revision = "20261012_0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # zipper_month_transactions is created by the baseline revision 20261009_0001
    # via Base.metadata.create_all(checkfirst=True). Nothing extra to do here.
    pass


def downgrade() -> None:
    # The table is owned by the baseline revision; do not drop it here.
    pass
