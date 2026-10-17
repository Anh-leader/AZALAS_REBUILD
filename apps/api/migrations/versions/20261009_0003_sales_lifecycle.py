"""sales lifecycle: shipping, invoice, payment, debt and returns

Revision ID: 20261009_0003
Revises: 20261009_0002
"""

from alembic import op

revision = "20261009_0003"
down_revision = "20261009_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # invoices/invoice_orders/payments/payment_allocations/party_debt_balances/
    # returns/return_items are created by the baseline revision 20261009_0001 via
    # Base.metadata.create_all(checkfirst=True). This migration only installs the
    # DB-level data-integrity triggers, which are not represented in ORM metadata.
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("""
        CREATE OR REPLACE FUNCTION azalas_debt_ledger_immutable()
        RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'debt_ledger_entries is append-only';
        END;
        $$ LANGUAGE plpgsql;
        """)
        op.execute("DROP TRIGGER IF EXISTS trg_debt_ledger_immutable ON debt_ledger_entries")
        op.execute("""
        CREATE TRIGGER trg_debt_ledger_immutable
        BEFORE UPDATE OR DELETE ON debt_ledger_entries
        FOR EACH ROW EXECUTE FUNCTION azalas_debt_ledger_immutable()
        """)
        op.execute("""
        CREATE OR REPLACE FUNCTION azalas_check_payment_allocations()
        RETURNS trigger AS $$
        DECLARE total_allocated bigint; payment_amount bigint;
        BEGIN
          SELECT COALESCE(SUM(allocated_amount), 0) INTO total_allocated
            FROM payment_allocations WHERE payment_id = NEW.payment_id;
          SELECT amount INTO payment_amount FROM payments WHERE id = NEW.payment_id;
          IF total_allocated > payment_amount THEN
            RAISE EXCEPTION 'payment allocations exceed payment amount';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """)
        op.execute("DROP TRIGGER IF EXISTS trg_payment_allocation_limit ON payment_allocations")
        op.execute("""
        CREATE CONSTRAINT TRIGGER trg_payment_allocation_limit
        AFTER INSERT OR UPDATE ON payment_allocations
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION azalas_check_payment_allocations()
        """)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("DROP TRIGGER IF EXISTS trg_payment_allocation_limit ON payment_allocations")
        op.execute("DROP FUNCTION IF EXISTS azalas_check_payment_allocations()")
        op.execute("DROP TRIGGER IF EXISTS trg_debt_ledger_immutable ON debt_ledger_entries")
        op.execute("DROP FUNCTION IF EXISTS azalas_debt_ledger_immutable()")
