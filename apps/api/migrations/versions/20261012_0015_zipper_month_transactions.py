"""zipper month transactions (cong no theo thang)

Revision ID: 20261012_0015
Revises: 20261012_0014
"""

from alembic import op
import sqlalchemy as sa

revision = "20261012_0015"
down_revision = "20261012_0014"
branch_labels = None
depends_on = None
UUID = sa.Uuid


def upgrade() -> None:
    op.create_table(
        "zipper_month_transactions",
        sa.Column("id", UUID(), primary_key=True),
        sa.Column("month", sa.String(7), nullable=False),
        sa.Column("transaction_type", sa.String(30), nullable=False),
        sa.Column("amount", sa.BigInteger(), nullable=False),
        sa.Column("occurred_date", sa.Date(), nullable=False),
        sa.Column("note", sa.Text()),
        sa.Column("partner_transaction_id", UUID(), sa.ForeignKey("partner_transactions.id", ondelete="SET NULL")),
        sa.Column("created_by", UUID(), sa.ForeignKey("users.id")),
        sa.Column("idempotency_key", sa.String(100), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_zipper_month_transactions_month", "zipper_month_transactions", ["month"])
    op.create_index("ix_zipper_month_transactions_transaction_type", "zipper_month_transactions", ["transaction_type"])


def downgrade() -> None:
    op.drop_index("ix_zipper_month_transactions_transaction_type", table_name="zipper_month_transactions")
    op.drop_index("ix_zipper_month_transactions_month", table_name="zipper_month_transactions")
    op.drop_table("zipper_month_transactions")
