"""invoice capture image and soft-delete for pending invoice orders

Revision ID: 20261010_0008
Revises: 20261009_0007
"""

from alembic import op
import sqlalchemy as sa

revision = "20261010_0008"
down_revision = "20261009_0007"
branch_labels = None
depends_on = None
UUID = sa.Uuid


def upgrade() -> None:
    # 1. Invoice giữ ảnh hóa đơn đã chụp trước khi chốt.
    op.add_column("invoices", sa.Column("captured_invoice_media_id", UUID(), nullable=True))
    op.add_column("invoices", sa.Column("captured_at", sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key("fk_invoices_captured_media", "invoices", "media_objects",
                          ["captured_invoice_media_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_invoices_captured_invoice_media_id", "invoices", ["captured_invoice_media_id"])

    # 2. Bản chụp tạm (trước khi invoice tồn tại) gắn với nhóm đơn của một khách.
    op.create_table(
        "invoice_captures",
        sa.Column("id", UUID(), primary_key=True),
        sa.Column("customer_id", UUID(), nullable=False),
        sa.Column("order_ids", sa.JSON(), nullable=False),
        sa.Column("media_id", UUID(), nullable=False),
        sa.Column("captured_by", UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_foreign_key("fk_invoice_captures_customer", "invoice_captures", "customers",
                          ["customer_id"], ["id"], ondelete="CASCADE")
    op.create_foreign_key("fk_invoice_captures_media", "invoice_captures", "media_objects",
                          ["media_id"], ["id"], ondelete="CASCADE")
    op.create_foreign_key("fk_invoice_captures_user", "invoice_captures", "users",
                          ["captured_by"], ["id"], ondelete="SET NULL")
    op.create_index("ix_invoice_captures_customer_id", "invoice_captures", ["customer_id"])


def downgrade() -> None:
    op.drop_index("ix_invoice_captures_customer_id", table_name="invoice_captures")
    op.drop_table("invoice_captures")
    op.drop_index("ix_invoices_captured_invoice_media_id", table_name="invoices")
    op.drop_constraint("fk_invoices_captured_media", "invoices", type_="foreignkey")
    op.drop_column("invoices", "captured_at")
    op.drop_column("invoices", "captured_invoice_media_id")
