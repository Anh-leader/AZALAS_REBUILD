"""sales lifecycle: shipping, invoice, payment, debt and returns

Revision ID: 20261009_0003
Revises: 20261009_0002
"""

from alembic import op
import sqlalchemy as sa

from app.core.db import Base
import app.models  # noqa: F401

revision = "20261009_0003"
down_revision = "20261009_0002"
branch_labels = None
depends_on = None

NEW_TABLES = (
    "invoices",
    "invoice_orders",
    "payments",
    "payment_allocations",
    "party_debt_balances",
    "returns",
    "return_items",
)


def _add_missing(table: str, columns: list[sa.Column]) -> None:
    existing = {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}
    for column in columns:
        if column.name not in existing:
            op.add_column(table, column)


def upgrade() -> None:
    bind = op.get_bind()
    _add_missing("customers", [
        sa.Column("carrier_name", sa.String(200), nullable=True),
        sa.Column("carrier_phone", sa.String(30), nullable=True),
    ])
    _add_missing("orders", [
        sa.Column("billing_status", sa.String(30), nullable=False, server_default="DRAFT"),
        sa.Column("paid_amount", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("invoice_balance_amount", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_by", sa.Uuid(), nullable=True),
    ])
    _add_missing("audit_logs", [
        sa.Column("module", sa.String(80), nullable=True),
        sa.Column("request_id", sa.String(100), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    ])
    _add_missing("debt_ledger_entries", [
        sa.Column("reversal_of_id", sa.Uuid(), nullable=True),
        sa.Column("actor_user_id", sa.Uuid(), nullable=True),
        sa.Column("idempotency_key", sa.String(100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    ])

    # Foreign keys are intentionally added after columns so upgrades work on an
    # already populated operational database.
    inspector = sa.inspect(bind)
    order_fk_cols = {c for fk in inspector.get_foreign_keys("orders") for c in fk.get("constrained_columns", [])}
    if "cancelled_by" not in order_fk_cols:
        op.create_foreign_key("fk_orders_cancelled_by_users", "orders", "users", ["cancelled_by"], ["id"])
    debt_fk_cols = {c for fk in inspector.get_foreign_keys("debt_ledger_entries") for c in fk.get("constrained_columns", [])}
    if "reversal_of_id" not in debt_fk_cols:
        op.create_foreign_key("fk_debt_reversal", "debt_ledger_entries", "debt_ledger_entries", ["reversal_of_id"], ["id"])
    if "actor_user_id" not in debt_fk_cols:
        op.create_foreign_key("fk_debt_actor", "debt_ledger_entries", "users", ["actor_user_id"], ["id"])

    Base.metadata.create_all(bind=bind, tables=[Base.metadata.tables[name] for name in NEW_TABLES], checkfirst=True)

    # Idempotency keys are nullable: PostgreSQL allows multiple NULLs while
    # rejecting duplicate posted commands.
    existing_indexes = {i["name"] for i in sa.inspect(bind).get_indexes("debt_ledger_entries")}
    if "uq_debt_idempotency_key" not in existing_indexes:
        op.create_index("uq_debt_idempotency_key", "debt_ledger_entries", ["idempotency_key"], unique=True)
    order_indexes = {i["name"] for i in sa.inspect(bind).get_indexes("orders")}
    if "ix_orders_billing_status" not in order_indexes:
        op.create_index("ix_orders_billing_status", "orders", ["billing_status"])

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
    for name in reversed(NEW_TABLES):
        op.drop_table(name)
    op.drop_index("uq_debt_idempotency_key", table_name="debt_ledger_entries")
    op.drop_constraint("fk_debt_actor", "debt_ledger_entries", type_="foreignkey")
    op.drop_constraint("fk_debt_reversal", "debt_ledger_entries", type_="foreignkey")
    for column in ("created_at", "idempotency_key", "actor_user_id", "reversal_of_id"):
        op.drop_column("debt_ledger_entries", column)
    for column in ("occurred_at", "request_id", "module"):
        op.drop_column("audit_logs", column)
    op.drop_constraint("fk_orders_cancelled_by_users", "orders", type_="foreignkey")
    for column in ("cancelled_by", "cancelled_at", "invoice_balance_amount", "paid_amount", "billing_status"):
        op.drop_column("orders", column)
    for column in ("carrier_phone", "carrier_name"):
        op.drop_column("customers", column)
