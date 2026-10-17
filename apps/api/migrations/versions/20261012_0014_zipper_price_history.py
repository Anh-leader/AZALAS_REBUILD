"""zipper price history and current material price

Revision ID: 20261012_0014
Revises: 20261012_0013
"""

from alembic import op

revision = "20261012_0014"
down_revision = "20261012_0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # materials.unit_price_amount and the material_price_history table are
    # created by the baseline revision 20261009_0001 via
    # Base.metadata.create_all(checkfirst=True). Nothing extra to do here.
    pass


def downgrade() -> None:
    # Objects are owned by the baseline revision; do not drop them here.
    pass
