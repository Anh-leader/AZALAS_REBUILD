"""zipper price history and current material price

Revision ID: 20261012_0014
Revises: 20261012_0013
"""

from alembic import op
import sqlalchemy as sa

revision = "20261012_0014"
down_revision = "20261012_0013"
branch_labels = None
depends_on = None
UUID = sa.Uuid


def upgrade() -> None:
    op.add_column("materials", sa.Column("unit_price_amount", sa.BigInteger(), nullable=False, server_default="0"))
    op.create_table(
        "material_price_history",
        sa.Column("id", UUID(), primary_key=True),
        sa.Column("material_id", UUID(), sa.ForeignKey("materials.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("effective_date", sa.Date(), nullable=False),
        sa.Column("unit_price_amount", sa.BigInteger(), nullable=False),
        sa.Column("previous_unit_price_amount", sa.BigInteger()),
        sa.Column("changed_by", UUID(), sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("unit_price_amount >= 0", name="ck_material_price_history_nonnegative"),
    )
    op.create_index("ix_material_price_history_material_id", "material_price_history", ["material_id"])
    op.create_index("ix_material_price_history_effective_date", "material_price_history", ["effective_date"])


def downgrade() -> None:
    op.drop_index("ix_material_price_history_effective_date", table_name="material_price_history")
    op.drop_index("ix_material_price_history_material_id", table_name="material_price_history")
    op.drop_table("material_price_history")
    op.drop_column("materials", "unit_price_amount")
