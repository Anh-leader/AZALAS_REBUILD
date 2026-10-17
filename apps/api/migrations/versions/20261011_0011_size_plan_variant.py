"""size plan variant (hiệu) dimension

Revision ID: 20261011_0011
Revises: 20261011_0010
"""

from alembic import op

revision = "20261011_0011"
down_revision = "20261011_0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # production_batch_size_plans.variant_code and the four-column unique
    # constraint are created by the baseline revision 20261009_0001 via
    # Base.metadata.create_all(checkfirst=True). Nothing extra to do here.
    pass


def downgrade() -> None:
    # Objects are owned by the baseline revision; do not drop them here.
    pass
