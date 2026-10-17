"""production batches, workshops, cutting, receipts and append-only deliveries

Revision ID: 20261009_0004
Revises: 20261009_0003
"""

from alembic import op

revision = "20261009_0004"
down_revision = "20261009_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Every table in this bounded context (workshops, cutting_teams, fabric_types,
    # production_batches, production_batch_size_plans, production_receipts, ...)
    # is created by the baseline revision 20261009_0001 via
    # Base.metadata.create_all(checkfirst=True).
    #
    # The only schema objects intentionally kept OUT of ORM metadata are these two
    # named foreign keys (added here to avoid metadata-level cycles). They are the
    # only DDL this migration still performs.
    op.create_foreign_key(
        "fk_orders_production_batch", "orders", "production_batches",
        ["production_batch_id"], ["id"],
    )
    op.create_foreign_key(
        "fk_payments_workshop", "payments", "workshops",
        ["workshop_id"], ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_payments_workshop", "payments", type_="foreignkey")
    op.drop_constraint("fk_orders_production_batch", "orders", type_="foreignkey")
