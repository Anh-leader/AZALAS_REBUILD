"""inventory and atomic picking

Revision ID: 20261009_0002
Revises: 20261009_0001
"""

from alembic import op

revision = "20261009_0002"
down_revision = "20261009_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # products/colors/warehouse_locations/product_variants/order_items/
    # order_item_revisions/inventory_*/audit_logs are created by the baseline
    # revision 20261009_0001 via Base.metadata.create_all(checkfirst=True).
    # This migration only installs the DB-level append-only guard, which is not
    # represented in ORM metadata.
    bind = op.get_bind()
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
