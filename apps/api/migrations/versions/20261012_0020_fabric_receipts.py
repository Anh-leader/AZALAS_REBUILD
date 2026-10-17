"""add fabric intake receipts

Revision ID: 20261012_0020
Revises: 20261012_0019
"""

from alembic import op

revision = "20261012_0020"
down_revision = "20261012_0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # fabric_receipts/fabric_receipt_lines are created by the baseline revision
    # 20261009_0001 via Base.metadata.create_all(checkfirst=True).
    pass


def downgrade() -> None:
    # Tables are owned by the baseline revision; do not drop them here.
    pass
