"""cho phép điều chỉnh giảm (số âm) trong phiếu nhận hàng

Revision ID: 20261012_0012
Revises: 20261011_0011
"""

from alembic import op

revision = "20261012_0012"
down_revision = "20261011_0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The baseline revision 20261009_0001 (Base.metadata.create_all) already
    # reflects the final state where ck_production_receipt_received_nonnegative
    # does not exist. Nothing extra to do here.
    pass


def downgrade() -> None:
    # The check constraint was removed in the final model; nothing to reverse.
    pass
