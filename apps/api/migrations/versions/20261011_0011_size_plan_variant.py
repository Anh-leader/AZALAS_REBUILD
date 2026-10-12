"""size plan variant (hiệu) dimension

Revision ID: 20261011_0011
Revises: 20261011_0010
"""

from alembic import op
import sqlalchemy as sa

revision = "20261011_0011"
down_revision = "20261011_0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("production_batch_size_plans", sa.Column("variant_code", sa.String(80), nullable=True))
    op.drop_constraint("uq_batch_size_plan", "production_batch_size_plans", type_="unique")
    op.create_unique_constraint("uq_batch_size_plan", "production_batch_size_plans", ["batch_id", "color_id", "size", "variant_code"])


def downgrade() -> None:
    op.drop_constraint("uq_batch_size_plan", "production_batch_size_plans", type_="unique")
    op.create_unique_constraint("uq_batch_size_plan", "production_batch_size_plans", ["batch_id", "color_id", "size"])
    op.drop_column("production_batch_size_plans", "variant_code")
