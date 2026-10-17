"""track imported-to-stock quantity on production batch

Revision ID: 20261012_0013
Revises: 20261012_0012
"""

from alembic import op

revision = "20261012_0013"
down_revision = "20261012_0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # production_batches.imported_quantity is created by the baseline revision
    # 20261009_0001 via Base.metadata.create_all(checkfirst=True).
    pass


def downgrade() -> None:
    # The column is owned by the baseline revision; do not drop it here.
    pass
