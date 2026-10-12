"""partners, material purchasing, settlements and private attachments

Revision ID: 20261009_0005
Revises: 20261009_0004
"""

from alembic import op
import sqlalchemy as sa

revision = "20261009_0005"
down_revision = "20261009_0004"
branch_labels = None
depends_on = None
UUID = sa.Uuid


def ts():
    return (sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))


def upgrade() -> None:
    op.create_table("partners",
        sa.Column("id", UUID(), primary_key=True), sa.Column("partner_code", sa.String(80), nullable=False, unique=True),
        sa.Column("name", sa.String(250), nullable=False), sa.Column("partner_type", sa.String(40), nullable=False),
        sa.Column("phone", sa.String(30)), sa.Column("address", sa.Text()),
        sa.Column("status", sa.String(30), nullable=False, server_default="ACTIVE"), sa.Column("notes", sa.Text()), *ts())
    for col in ("name", "partner_type", "status"): op.create_index(f"ix_partners_{col}", "partners", [col])
    op.create_foreign_key("fk_payments_partner", "payments", "partners", ["supplier_id"], ["id"], ondelete="RESTRICT")
    op.create_index("ix_payments_supplier_id", "payments", ["supplier_id"])

    op.create_table("materials",
        sa.Column("id", UUID(), primary_key=True), sa.Column("material_code", sa.String(80), nullable=False, unique=True),
        sa.Column("name", sa.String(250), nullable=False), sa.Column("category", sa.String(40), nullable=False),
        sa.Column("unit", sa.String(30), nullable=False), sa.Column("status", sa.String(30), nullable=False, server_default="ACTIVE"),
        sa.Column("notes", sa.Text()), *ts())
    for col in ("name", "category", "status"): op.create_index(f"ix_materials_{col}", "materials", [col])
    op.create_table("material_variants",
        sa.Column("id", UUID(), primary_key=True), sa.Column("material_id", UUID(), sa.ForeignKey("materials.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("color_id", UUID(), sa.ForeignKey("colors.id", ondelete="RESTRICT")), sa.Column("size", sa.String(80)),
        sa.Column("display_name", sa.String(300), nullable=False), sa.Column("status", sa.String(30), nullable=False, server_default="ACTIVE"),
        sa.UniqueConstraint("material_id", "color_id", "size", name="uq_material_variant"), *ts())
    op.create_index("ix_material_variants_material_id", "material_variants", ["material_id"])
    op.create_index("ix_material_variants_display_name", "material_variants", ["display_name"])

    op.create_table("material_receipts",
        sa.Column("id", UUID(), primary_key=True), sa.Column("receipt_no", sa.String(80), nullable=False, unique=True),
        sa.Column("receipt_date", sa.Date(), nullable=False), sa.Column("partner_id", UUID(), sa.ForeignKey("partners.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("category", sa.String(40), nullable=False), sa.Column("freight_amount", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("subtotal_amount", sa.BigInteger(), nullable=False), sa.Column("total_amount", sa.BigInteger(), nullable=False),
        sa.Column("paid_amount", sa.BigInteger(), nullable=False, server_default="0"), sa.Column("balance_amount", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.String(30), nullable=False, server_default="POSTED"), sa.Column("received_by", UUID(), sa.ForeignKey("users.id")),
        sa.Column("notes", sa.Text()), sa.Column("idempotency_key", sa.String(100), nullable=False, unique=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.CheckConstraint("freight_amount >= 0", name="ck_material_receipt_freight_nonnegative"),
        sa.CheckConstraint("total_amount >= 0", name="ck_material_receipt_total_nonnegative"),
        sa.CheckConstraint("paid_amount >= 0", name="ck_material_receipt_paid_nonnegative"),
        sa.CheckConstraint("balance_amount >= 0", name="ck_material_receipt_balance_nonnegative"), *ts())
    for col in ("partner_id", "category", "status"): op.create_index(f"ix_material_receipts_{col}", "material_receipts", [col])
    op.create_table("material_receipt_lines",
        sa.Column("id", UUID(), primary_key=True), sa.Column("receipt_id", UUID(), sa.ForeignKey("material_receipts.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("material_variant_id", UUID(), sa.ForeignKey("material_variants.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("quantity", sa.Numeric(18, 3), nullable=False), sa.Column("weight", sa.Numeric(18, 3)),
        sa.Column("unit_price_amount", sa.BigInteger(), nullable=False), sa.Column("amount", sa.BigInteger(), nullable=False), sa.Column("notes", sa.Text()),
        sa.CheckConstraint("quantity > 0", name="ck_material_receipt_line_quantity_positive"),
        sa.CheckConstraint("unit_price_amount > 0", name="ck_material_receipt_line_price_positive"),
        sa.CheckConstraint("amount > 0", name="ck_material_receipt_line_amount_positive"))
    op.create_index("ix_material_receipt_lines_receipt_id", "material_receipt_lines", ["receipt_id"])
    op.create_index("ix_material_receipt_lines_material_variant_id", "material_receipt_lines", ["material_variant_id"])

    op.create_table("partner_settlements",
        sa.Column("id", UUID(), primary_key=True), sa.Column("settlement_no", sa.String(80), nullable=False, unique=True),
        sa.Column("partner_id", UUID(), sa.ForeignKey("partners.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("period_month", sa.Date(), nullable=False), sa.Column("settlement_type", sa.String(40), nullable=False),
        sa.Column("total_amount", sa.BigInteger(), nullable=False), sa.Column("paid_amount", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("balance_amount", sa.BigInteger(), nullable=False), sa.Column("status", sa.String(30), nullable=False, server_default="UNPAID"),
        sa.Column("notes", sa.Text()), sa.Column("created_by", UUID(), sa.ForeignKey("users.id")),
        sa.Column("idempotency_key", sa.String(100), nullable=False, unique=True), sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.UniqueConstraint("partner_id", "period_month", "settlement_type", name="uq_partner_settlement_period"), *ts())
    for col in ("partner_id", "period_month", "status"): op.create_index(f"ix_partner_settlements_{col}", "partner_settlements", [col])
    op.create_table("partner_transactions",
        sa.Column("id", UUID(), primary_key=True), sa.Column("transaction_no", sa.String(80), nullable=False, unique=True),
        sa.Column("partner_id", UUID(), sa.ForeignKey("partners.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("direction", sa.String(20), nullable=False), sa.Column("transaction_type", sa.String(40), nullable=False),
        sa.Column("amount", sa.BigInteger(), nullable=False), sa.Column("reference_type", sa.String(40)), sa.Column("reference_id", UUID()),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False), sa.Column("description", sa.Text()),
        sa.Column("settlement_id", UUID(), sa.ForeignKey("partner_settlements.id", ondelete="RESTRICT")),
        sa.Column("status", sa.String(30), nullable=False, server_default="POSTED"), sa.Column("created_by", UUID(), sa.ForeignKey("users.id")),
        sa.Column("idempotency_key", sa.String(100), nullable=False, unique=True), *ts())
    for col in ("partner_id", "transaction_type", "occurred_at", "settlement_id"): op.create_index(f"ix_partner_transactions_{col}", "partner_transactions", [col])
    op.create_table("partner_settlement_lines",
        sa.Column("id", UUID(), primary_key=True), sa.Column("settlement_id", UUID(), sa.ForeignKey("partner_settlements.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("partner_transaction_id", UUID(), sa.ForeignKey("partner_transactions.id", ondelete="RESTRICT"), nullable=False, unique=True),
        sa.Column("amount", sa.BigInteger(), nullable=False))
    op.create_index("ix_partner_settlement_lines_settlement_id", "partner_settlement_lines", ["settlement_id"])
    op.create_table("partner_files",
        sa.Column("id", UUID(), primary_key=True), sa.Column("partner_id", UUID(), sa.ForeignKey("partners.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("transaction_id", UUID(), sa.ForeignKey("partner_transactions.id", ondelete="RESTRICT")),
        sa.Column("media_id", UUID(), sa.ForeignKey("media_objects.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("purpose", sa.String(80), nullable=False), sa.Column("created_by", UUID(), sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("partner_id", "media_id", "purpose", name="uq_partner_file"))
    op.create_index("ix_partner_files_partner_id", "partner_files", ["partner_id"])


def downgrade() -> None:
    for table in ("partner_files", "partner_settlement_lines", "partner_transactions", "partner_settlements",
                  "material_receipt_lines", "material_receipts", "material_variants", "materials"):
        op.drop_table(table)
    op.drop_index("ix_payments_supplier_id", table_name="payments")
    op.drop_constraint("fk_payments_partner", "payments", type_="foreignkey")
    op.drop_table("partners")
