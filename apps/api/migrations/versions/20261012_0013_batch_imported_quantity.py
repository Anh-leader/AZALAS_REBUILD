"""track imported-to-stock quantity on production batch

Revision ID: 20261012_0013
Revises: 20261012_0012
"""

from alembic import op
import sqlalchemy as sa

revision = "20261012_0013"
down_revision = "20261012_0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "production_batches",
        sa.Column("imported_quantity", sa.Numeric(18, 3), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("production_batches", "imported_quantity")
