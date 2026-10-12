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
    # Cho phép "điều chỉnh giảm sau kiểm đếm": received_now có thể âm để trừ bớt.
    op.drop_constraint("ck_production_receipt_received_nonnegative", "production_receipt_lines", type_="check")


def downgrade() -> None:
    op.create_check_constraint(
        "ck_production_receipt_received_nonnegative",
        "production_receipt_lines",
        "received_now >= 0",
    )
