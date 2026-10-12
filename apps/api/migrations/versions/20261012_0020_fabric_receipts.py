"""add fabric intake receipts

Revision ID: 20261012_0020
Revises: 20261012_0019
"""

from alembic import op
import sqlalchemy as sa

revision = "20261012_0020"
down_revision = "20261012_0019"
branch_labels = None
depends_on = None
UUID = sa.Uuid


def upgrade() -> None:
    op.create_table(
        "fabric_receipts",
        sa.Column("id", UUID(), primary_key=True),
        sa.Column("receipt_no", sa.String(80), nullable=False, unique=True),
        sa.Column("partner_id", UUID(), sa.ForeignKey("partners.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("total_amount", sa.BigInteger(), nullable=False),
        sa.Column("created_by", UUID(), sa.ForeignKey("users.id")),
        sa.Column("idempotency_key", sa.String(100), nullable=False, unique=True),
        sa.Column("status", sa.String(30), nullable=False, server_default="POSTED"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_fabric_receipts_partner_id", "fabric_receipts", ["partner_id"])
    op.create_index("ix_fabric_receipts_status", "fabric_receipts", ["status"])
    op.create_table(
        "fabric_receipt_lines",
        sa.Column("id", UUID(), primary_key=True),
        sa.Column("receipt_id", UUID(), sa.ForeignKey("fabric_receipts.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("line_number", sa.Integer(), nullable=False),
        sa.Column("entry_type", sa.String(20), nullable=False),
        sa.Column("receipt_date", sa.Date(), nullable=False),
        sa.Column("fabric_name", sa.String(250), nullable=False),
        sa.Column("unit", sa.String(20), nullable=False),
        sa.Column("roll_count", sa.Numeric(18, 3), nullable=False),
        sa.Column("gross_quantity", sa.Numeric(18, 3), nullable=False),
        sa.Column("wastage_quantity", sa.Numeric(18, 3), nullable=False),
        sa.Column("net_quantity", sa.Numeric(18, 3), nullable=False),
        sa.Column("deduction_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("unit_price_amount", sa.BigInteger(), nullable=False),
        sa.Column("transport_amount", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("amount", sa.BigInteger(), nullable=False),
        sa.UniqueConstraint("receipt_id", "line_number", name="uq_fabric_receipt_line_number"),
        sa.CheckConstraint("entry_type IN ('PURCHASE', 'RETURN')", name="ck_fabric_receipt_line_type"),
        sa.CheckConstraint("unit IN ('KG', 'METER')", name="ck_fabric_receipt_line_unit"),
        sa.CheckConstraint("roll_count >= 0", name="ck_fabric_receipt_line_roll_count_nonnegative"),
        sa.CheckConstraint("gross_quantity > 0", name="ck_fabric_receipt_line_quantity_positive"),
        sa.CheckConstraint("wastage_quantity >= 0", name="ck_fabric_receipt_line_wastage_nonnegative"),
        sa.CheckConstraint("net_quantity >= 0", name="ck_fabric_receipt_line_net_nonnegative"),
        sa.CheckConstraint("unit_price_amount >= 0", name="ck_fabric_receipt_line_price_nonnegative"),
        sa.CheckConstraint("entry_type = 'PURCHASE' OR transport_amount = 0", name="ck_fabric_receipt_line_return_transport_zero"),
    )
    op.create_index("ix_fabric_receipt_lines_receipt_id", "fabric_receipt_lines", ["receipt_id"])


def downgrade() -> None:
    op.drop_index("ix_fabric_receipt_lines_receipt_id", table_name="fabric_receipt_lines")
    op.drop_table("fabric_receipt_lines")
    op.drop_index("ix_fabric_receipts_status", table_name="fabric_receipts")
    op.drop_index("ix_fabric_receipts_partner_id", table_name="fabric_receipts")
    op.drop_table("fabric_receipts")
