"""inventory and atomic picking

Revision ID: 20261009_0002
Revises: 20261009_0001
"""

from alembic import op
import sqlalchemy as sa

from app.core.db import Base
import app.models  # noqa: F401

revision = "20261009_0002"
down_revision = "20261009_0001"
branch_labels = None
depends_on = None

NEW_TABLES = (
    "products",
    "colors",
    "warehouse_locations",
    "product_variants",
    "order_items",
    "order_item_revisions",
    "inventory_balances",
    "inventory_transactions",
    "inventory_reservations",
    "inventory_reservation_lines",
    "audit_logs",
)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    order_columns = {column["name"] for column in inspector.get_columns("orders")}
    if "staff_note" not in order_columns:
        op.add_column("orders", sa.Column("staff_note", sa.Text(), nullable=True))
    if "version" not in order_columns:
        op.add_column("orders", sa.Column("version", sa.Integer(), nullable=False, server_default="1"))

    # The baseline is already deployed. Create only the new bounded-context
    # tables and never drop/recreate operational data.
    Base.metadata.create_all(bind=bind, tables=[Base.metadata.tables[name] for name in NEW_TABLES], checkfirst=True)

    if bind.dialect.name == "postgresql":
        op.execute("""
        CREATE OR REPLACE FUNCTION azalas_inventory_ledger_immutable()
        RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'inventory_transactions is append-only';
        END;
        $$ LANGUAGE plpgsql;
        """)
        op.execute("DROP TRIGGER IF EXISTS trg_inventory_ledger_immutable ON inventory_transactions")
        op.execute("""
        CREATE TRIGGER trg_inventory_ledger_immutable
        BEFORE UPDATE OR DELETE ON inventory_transactions
        FOR EACH ROW EXECUTE FUNCTION azalas_inventory_ledger_immutable()
        """)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("DROP TRIGGER IF EXISTS trg_inventory_ledger_immutable ON inventory_transactions")
        op.execute("DROP FUNCTION IF EXISTS azalas_inventory_ledger_immutable()")
    for name in reversed(NEW_TABLES):
        op.drop_table(name)
    order_columns = {column["name"] for column in sa.inspect(bind).get_columns("orders")}
    if "version" in order_columns:
        op.drop_column("orders", "version")
    if "staff_note" in order_columns:
        op.drop_column("orders", "staff_note")
