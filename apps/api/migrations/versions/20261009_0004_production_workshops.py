"""production batches, workshops, cutting, receipts and append-only deliveries

Revision ID: 20261009_0004
Revises: 20261009_0003
"""

from alembic import op
import sqlalchemy as sa

revision = "20261009_0004"
down_revision = "20261009_0003"
branch_labels = None
depends_on = None

UUID = sa.Uuid


def _timestamps():
    return (
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def upgrade() -> None:
    op.create_table("workshops",
        sa.Column("id", UUID(), primary_key=True), sa.Column("workshop_code", sa.String(80), nullable=False, unique=True),
        sa.Column("name", sa.String(250), nullable=False, unique=True), sa.Column("phone", sa.String(30)),
        sa.Column("address", sa.Text()), sa.Column("status", sa.String(30), nullable=False, server_default="ACTIVE"),
        sa.Column("notes", sa.Text()), *_timestamps())
    op.create_index("ix_workshops_name", "workshops", ["name"])
    op.create_table("cutting_teams",
        sa.Column("id", UUID(), primary_key=True), sa.Column("team_code", sa.String(80), nullable=False, unique=True),
        sa.Column("name", sa.String(250), nullable=False, unique=True), sa.Column("phone", sa.String(30)),
        sa.Column("status", sa.String(30), nullable=False, server_default="ACTIVE"),
        sa.Column("default_unit_price_amount", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("notes", sa.Text()), *_timestamps())
    op.create_index("ix_cutting_teams_name", "cutting_teams", ["name"])
    op.create_table("fabric_types",
        sa.Column("id", UUID(), primary_key=True), sa.Column("code", sa.String(80), nullable=False, unique=True),
        sa.Column("name", sa.String(200), nullable=False, unique=True),
        sa.Column("status", sa.String(30), nullable=False, server_default="ACTIVE"),
        sa.Column("notes", sa.Text()), *_timestamps())
    op.create_table("pattern_prices",
        sa.Column("id", UUID(), primary_key=True), sa.Column("pattern_code", sa.String(100), nullable=False),
        sa.Column("unit_price_amount", sa.BigInteger(), nullable=False), sa.Column("valid_from", sa.Date(), nullable=False),
        sa.Column("valid_to", sa.Date()), sa.Column("created_by", UUID(), sa.ForeignKey("users.id")),
        sa.CheckConstraint("unit_price_amount >= 0", name="ck_pattern_price_nonnegative"), *_timestamps())
    op.create_index("ix_pattern_prices_pattern_code", "pattern_prices", ["pattern_code"])
    op.create_table("workshop_pattern_prices",
        sa.Column("id", UUID(), primary_key=True), sa.Column("pattern_code", sa.String(100), nullable=False),
        sa.Column("workshop_id", UUID(), sa.ForeignKey("workshops.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("unit_price_amount", sa.BigInteger(), nullable=False), sa.Column("valid_from", sa.Date(), nullable=False),
        sa.Column("valid_to", sa.Date()), sa.Column("created_by", UUID(), sa.ForeignKey("users.id")),
        sa.CheckConstraint("unit_price_amount >= 0", name="ck_workshop_pattern_price_nonnegative"), *_timestamps())
    op.create_index("ix_workshop_pattern_prices_pattern_code", "workshop_pattern_prices", ["pattern_code"])
    op.create_index("ix_workshop_pattern_prices_workshop_id", "workshop_pattern_prices", ["workshop_id"])

    op.create_table("workshop_settlements",
        sa.Column("id", UUID(), primary_key=True), sa.Column("settlement_no", sa.String(80), nullable=False, unique=True),
        sa.Column("settlement_date", sa.Date(), nullable=False),
        sa.Column("workshop_id", UUID(), sa.ForeignKey("workshops.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("total_quantity", sa.Numeric(18, 3), nullable=False), sa.Column("total_amount", sa.BigInteger(), nullable=False),
        sa.Column("paid_amount", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("balance_amount", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.String(30), nullable=False, server_default="UNPAID"), sa.Column("notes", sa.Text()),
        sa.Column("settled_by", UUID(), sa.ForeignKey("users.id")), sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("idempotency_key", sa.String(100), nullable=False, unique=True), *_timestamps())
    op.create_index("ix_workshop_settlements_workshop_id", "workshop_settlements", ["workshop_id"])
    op.create_index("ix_workshop_settlements_status", "workshop_settlements", ["status"])

    op.create_table("production_batches",
        sa.Column("id", UUID(), primary_key=True),
        sa.Column("idempotency_key", sa.String(100), nullable=False, unique=True),
        sa.Column("batch_no", sa.String(80), nullable=False, unique=True),
        sa.Column("cut_date", sa.Date(), nullable=False),
        sa.Column("workshop_id", UUID(), sa.ForeignKey("workshops.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("cutting_team_id", UUID(), sa.ForeignKey("cutting_teams.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("pattern_code", sa.String(100), nullable=False),
        sa.Column("product_id", UUID(), sa.ForeignKey("products.id", ondelete="RESTRICT")),
        sa.Column("product_name_snapshot", sa.String(300), nullable=False),
        sa.Column("size_expression", sa.Text()), sa.Column("ratio_expression", sa.Text()),
        sa.Column("layer_expression", sa.Text(), nullable=False),
        sa.Column("planned_quantity", sa.Numeric(18, 3), nullable=False),
        sa.Column("delivered_quantity", sa.Numeric(18, 3), nullable=False, server_default="0"),
        sa.Column("remaining_quantity", sa.Numeric(18, 3), nullable=False),
        sa.Column("expected_delivery_date", sa.Date()), sa.Column("batch_type", sa.String(30), nullable=False),
        sa.Column("customer_id", UUID(), sa.ForeignKey("customers.id", ondelete="RESTRICT")),
        sa.Column("synced_order_id", UUID(), sa.ForeignKey("orders.id", ondelete="RESTRICT"), unique=True),
        sa.Column("workshop_unit_price_amount", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("workshop_amount", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("production_status", sa.String(40), nullable=False, server_default="CUTTING_INCOMPLETE"),
        sa.Column("receipt_status", sa.String(40), nullable=False, server_default="NOT_RECEIVED"),
        sa.Column("settlement_status", sa.String(40), nullable=False, server_default="UNPAID"),
        sa.Column("workshop_settlement_id", UUID(), sa.ForeignKey("workshop_settlements.id")),
        sa.Column("cutting_settlement_id", UUID()),
        sa.Column("planned_warehouse_id", UUID(), sa.ForeignKey("warehouses.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("fabric_type_id", UUID(), sa.ForeignKey("fabric_types.id", ondelete="RESTRICT")),
        sa.Column("notes", sa.Text()), sa.Column("created_by", UUID(), sa.ForeignKey("users.id")),
        sa.Column("updated_by", UUID(), sa.ForeignKey("users.id")), sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.CheckConstraint("planned_quantity > 0", name="ck_production_batch_planned_positive"),
        sa.CheckConstraint("delivered_quantity >= 0", name="ck_production_batch_delivered_nonnegative"),
        sa.CheckConstraint("remaining_quantity >= 0", name="ck_production_batch_remaining_nonnegative"), *_timestamps())
    for column in ("workshop_id", "cutting_team_id", "pattern_code", "customer_id", "production_status", "receipt_status", "settlement_status"):
        op.create_index(f"ix_production_batches_{column}", "production_batches", [column])

    op.add_column("orders", sa.Column("production_batch_id", UUID(), nullable=True))
    op.create_foreign_key("fk_orders_production_batch", "orders", "production_batches", ["production_batch_id"], ["id"])
    op.create_index("ix_orders_production_batch_id", "orders", ["production_batch_id"])
    op.create_foreign_key("fk_payments_workshop", "payments", "workshops", ["workshop_id"], ["id"])

    op.create_table("production_batch_size_plans",
        sa.Column("id", UUID(), primary_key=True),
        sa.Column("batch_id", UUID(), sa.ForeignKey("production_batches.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("color_id", UUID(), sa.ForeignKey("colors.id", ondelete="RESTRICT")), sa.Column("size", sa.String(30), nullable=False),
        sa.Column("layers", sa.Numeric(18, 3), nullable=False, server_default="0"),
        sa.Column("ratio", sa.Numeric(18, 3), nullable=False, server_default="0"),
        sa.Column("planned_quantity", sa.Numeric(18, 3), nullable=False, server_default="0"),
        sa.Column("product_variant_id", UUID(), sa.ForeignKey("product_variants.id", ondelete="RESTRICT")),
        sa.Column("planned_warehouse_id", UUID(), sa.ForeignKey("warehouses.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("notes", sa.Text()), sa.UniqueConstraint("batch_id", "color_id", "size", name="uq_batch_size_plan"),
        sa.CheckConstraint("planned_quantity >= 0", name="ck_batch_size_planned_nonnegative"))
    op.create_index("ix_production_batch_size_plans_batch_id", "production_batch_size_plans", ["batch_id"])

    op.create_table("production_receipts",
        sa.Column("id", UUID(), primary_key=True), sa.Column("receipt_no", sa.String(80), nullable=False, unique=True),
        sa.Column("receipt_date", sa.Date(), nullable=False),
        sa.Column("batch_id", UUID(), sa.ForeignKey("production_batches.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("workshop_id", UUID(), sa.ForeignKey("workshops.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("color_id", UUID(), sa.ForeignKey("colors.id", ondelete="RESTRICT")),
        sa.Column("warehouse_id", UUID(), sa.ForeignKey("warehouses.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("planned_quantity", sa.Numeric(18, 3), nullable=False), sa.Column("actual_quantity", sa.Numeric(18, 3), nullable=False),
        sa.Column("difference_quantity", sa.Numeric(18, 3), nullable=False),
        sa.Column("status", sa.String(30), nullable=False, server_default="POSTED"),
        sa.Column("receiver_id", UUID(), sa.ForeignKey("users.id")), sa.Column("notes", sa.Text()),
        sa.Column("inventory_receipt_id", UUID()), sa.Column("idempotency_key", sa.String(100), nullable=False, unique=True), *_timestamps())
    op.create_index("ix_production_receipts_batch_id", "production_receipts", ["batch_id"])
    op.create_table("production_receipt_lines",
        sa.Column("id", UUID(), primary_key=True),
        sa.Column("receipt_id", UUID(), sa.ForeignKey("production_receipts.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("batch_size_plan_id", UUID(), sa.ForeignKey("production_batch_size_plans.id", ondelete="RESTRICT")),
        sa.Column("product_variant_id", UUID(), sa.ForeignKey("product_variants.id", ondelete="RESTRICT")),
        sa.Column("planned_quantity", sa.Numeric(18, 3), nullable=False), sa.Column("previously_received", sa.Numeric(18, 3), nullable=False),
        sa.Column("received_now", sa.Numeric(18, 3), nullable=False), sa.Column("total_received", sa.Numeric(18, 3), nullable=False),
        sa.Column("remaining_quantity", sa.Numeric(18, 3), nullable=False), sa.Column("difference_quantity", sa.Numeric(18, 3), nullable=False),
        sa.Column("imported_to_stock", sa.Boolean(), nullable=False, server_default=sa.false()), sa.Column("notes", sa.Text()),
        sa.CheckConstraint("received_now >= 0", name="ck_production_receipt_received_nonnegative"))
    op.create_index("ix_production_receipt_lines_receipt_id", "production_receipt_lines", ["receipt_id"])

    op.create_table("supplemental_workshop_deliveries",
        sa.Column("id", UUID(), primary_key=True), sa.Column("delivery_no", sa.String(80), nullable=False, unique=True),
        sa.Column("delivery_date", sa.Date(), nullable=False),
        sa.Column("batch_id", UUID(), sa.ForeignKey("production_batches.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("workshop_id", UUID(), sa.ForeignKey("workshops.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("original_settlement_id", UUID(), sa.ForeignKey("workshop_settlements.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("quantity", sa.Numeric(18, 3), nullable=False), sa.Column("unit_price_amount", sa.BigInteger(), nullable=False),
        sa.Column("amount", sa.BigInteger(), nullable=False), sa.Column("entered_by", UUID(), sa.ForeignKey("users.id")),
        sa.Column("notes", sa.Text()), sa.Column("idempotency_key", sa.String(100), nullable=False, unique=True),
        sa.Column("supplemental_settlement_id", UUID(), sa.ForeignKey("workshop_settlements.id")),
        sa.Column("status", sa.String(40), nullable=False, server_default="WAITING_SETTLEMENT"),
        sa.Column("quantity_before", sa.Numeric(18, 3), nullable=False), sa.Column("quantity_after", sa.Numeric(18, 3), nullable=False),
        sa.Column("amount_before", sa.BigInteger(), nullable=False), sa.Column("amount_after", sa.BigInteger(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.CheckConstraint("quantity > 0", name="ck_supplemental_quantity_positive"),
        sa.CheckConstraint("unit_price_amount > 0", name="ck_supplemental_price_positive"), *_timestamps())
    op.create_index("ix_supplemental_workshop_deliveries_batch_id", "supplemental_workshop_deliveries", ["batch_id"])
    op.create_index("ix_supplemental_workshop_deliveries_workshop_id", "supplemental_workshop_deliveries", ["workshop_id"])
    op.create_index("ix_supplemental_workshop_deliveries_status", "supplemental_workshop_deliveries", ["status"])
    op.create_table("workshop_settlement_lines",
        sa.Column("id", UUID(), primary_key=True),
        sa.Column("settlement_id", UUID(), sa.ForeignKey("workshop_settlements.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("production_batch_id", UUID(), sa.ForeignKey("production_batches.id", ondelete="RESTRICT")),
        sa.Column("supplemental_delivery_id", UUID(), sa.ForeignKey("supplemental_workshop_deliveries.id", ondelete="RESTRICT")),
        sa.Column("quantity", sa.Numeric(18, 3), nullable=False), sa.Column("unit_price_amount", sa.BigInteger(), nullable=False),
        sa.Column("amount", sa.BigInteger(), nullable=False),
        sa.Column("original_settlement_id", UUID(), sa.ForeignKey("workshop_settlements.id")),
        sa.CheckConstraint("(production_batch_id IS NOT NULL) <> (supplemental_delivery_id IS NOT NULL)", name="ck_workshop_settlement_one_source"))
    op.create_index("ix_workshop_settlement_lines_settlement_id", "workshop_settlement_lines", ["settlement_id"])

    op.create_table("cutting_reports",
        sa.Column("id", UUID(), primary_key=True), sa.Column("report_no", sa.String(80), nullable=False, unique=True),
        sa.Column("report_date", sa.Date(), nullable=False),
        sa.Column("cutting_team_id", UUID(), sa.ForeignKey("cutting_teams.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("batch_id", UUID(), sa.ForeignKey("production_batches.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("pattern_code", sa.String(100), nullable=False), sa.Column("color", sa.String(150)),
        sa.Column("layers", sa.Numeric(18, 3), nullable=False), sa.Column("quantity", sa.Numeric(18, 3), nullable=False),
        sa.Column("unit_price_amount", sa.BigInteger(), nullable=False), sa.Column("amount", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.String(30), nullable=False, server_default="UNPAID"), sa.Column("notes", sa.Text()),
        sa.Column("created_by", UUID(), sa.ForeignKey("users.id")),
        sa.CheckConstraint("quantity > 0", name="ck_cutting_report_quantity_positive"), *_timestamps())
    op.create_index("ix_cutting_reports_cutting_team_id", "cutting_reports", ["cutting_team_id"])
    op.create_index("ix_cutting_reports_batch_id", "cutting_reports", ["batch_id"])

    op.create_table("batch_material_deliveries",
        sa.Column("id", UUID(), primary_key=True), sa.Column("delivery_no", sa.String(80), nullable=False, unique=True),
        sa.Column("delivery_date", sa.Date(), nullable=False),
        sa.Column("batch_id", UUID(), sa.ForeignKey("production_batches.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("workshop_id", UUID(), sa.ForeignKey("workshops.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("delivered_by", UUID(), sa.ForeignKey("users.id")), sa.Column("received_by", sa.String(200)),
        sa.Column("notes", sa.Text()), sa.Column("idempotency_key", sa.String(100), nullable=False, unique=True), *_timestamps())
    op.create_index("ix_batch_material_deliveries_batch_id", "batch_material_deliveries", ["batch_id"])
    op.create_table("batch_material_delivery_lines",
        sa.Column("id", UUID(), primary_key=True),
        sa.Column("delivery_id", UUID(), sa.ForeignKey("batch_material_deliveries.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("material_id", UUID()), sa.Column("material_name_snapshot", sa.String(120), nullable=False),
        sa.Column("material_name_key", sa.String(120), nullable=False),
        sa.Column("quantity_delivered", sa.Numeric(18, 3), nullable=False),
        sa.Column("total_required", sa.Numeric(18, 3), nullable=False),
        sa.Column("delivery_mode", sa.String(40), nullable=False), sa.Column("notes", sa.Text()),
        sa.UniqueConstraint("delivery_id", "material_name_key", name="uq_batch_material_delivery_name"),
        sa.CheckConstraint("quantity_delivered > 0", name="ck_batch_material_delivery_positive"),
        sa.CheckConstraint("total_required > 0", name="ck_batch_material_required_positive"))
    op.create_index("ix_batch_material_delivery_lines_delivery_id", "batch_material_delivery_lines", ["delivery_id"])

    op.create_table("pattern_notes",
        sa.Column("id", UUID(), primary_key=True), sa.Column("note_no", sa.String(80), nullable=False, unique=True),
        sa.Column("title", sa.String(300), nullable=False), sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_by", UUID(), sa.ForeignKey("users.id")),
        sa.Column("client_token", sa.String(100), nullable=False, unique=True),
        sa.Column("folder_legacy_id", sa.String(255)), sa.Column("media_ids", sa.JSON(), nullable=False, server_default="[]"), *_timestamps())


def downgrade() -> None:
    op.drop_table("pattern_notes")
    op.drop_table("batch_material_delivery_lines")
    op.drop_table("batch_material_deliveries")
    op.drop_table("cutting_reports")
    op.drop_table("workshop_settlement_lines")
    op.drop_table("supplemental_workshop_deliveries")
    op.drop_table("production_receipt_lines")
    op.drop_table("production_receipts")
    op.drop_table("production_batch_size_plans")
    op.drop_constraint("fk_payments_workshop", "payments", type_="foreignkey")
    op.drop_index("ix_orders_production_batch_id", table_name="orders")
    op.drop_constraint("fk_orders_production_batch", "orders", type_="foreignkey")
    op.drop_column("orders", "production_batch_id")
    op.drop_table("production_batches")
    op.drop_table("workshop_settlements")
    op.drop_table("workshop_pattern_prices")
    op.drop_table("pattern_prices")
    op.drop_table("fabric_types")
    op.drop_table("cutting_teams")
    op.drop_table("workshops")
