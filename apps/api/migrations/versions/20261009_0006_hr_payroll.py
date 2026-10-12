"""employees, attendance, salary advances and immutable payroll snapshots

Revision ID: 20261009_0006
Revises: 20261009_0005
"""
from alembic import op
import sqlalchemy as sa

revision = "20261009_0006"
down_revision = "20261009_0005"
branch_labels = None
depends_on = None
UUID = sa.Uuid


def ts():
    return (sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))


def upgrade() -> None:
    op.create_table("employees",
        sa.Column("id", UUID(), primary_key=True), sa.Column("employee_code", sa.String(80), nullable=False, unique=True),
        sa.Column("full_name", sa.String(250), nullable=False), sa.Column("phone", sa.String(30)),
        sa.Column("position", sa.String(100), nullable=False), sa.Column("daily_rate_amount", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("start_date", sa.Date(), nullable=False), sa.Column("status", sa.String(30), nullable=False, server_default="ACTIVE"),
        sa.Column("notes", sa.Text()), sa.Column("user_id", UUID(), sa.ForeignKey("users.id", ondelete="RESTRICT"), unique=True),
        sa.CheckConstraint("daily_rate_amount >= 0", name="ck_employee_daily_rate_nonnegative"), *ts())
    for col in ("full_name", "position", "status"): op.create_index(f"ix_employees_{col}", "employees", [col])
    op.create_table("attendance_records",
        sa.Column("id", UUID(), primary_key=True), sa.Column("work_date", sa.Date(), nullable=False),
        sa.Column("employee_id", UUID(), sa.ForeignKey("employees.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("shift", sa.String(30), nullable=False), sa.Column("work_units", sa.Numeric(8, 3), nullable=False, server_default="0"),
        sa.Column("overtime_hours", sa.Numeric(8, 3), nullable=False, server_default="0"), sa.Column("notes", sa.Text()),
        sa.Column("entered_by", UUID(), sa.ForeignKey("users.id")),
        sa.UniqueConstraint("work_date", "employee_id", "shift", name="uq_attendance_day_employee_shift"),
        sa.CheckConstraint("work_units >= 0", name="ck_attendance_work_units_nonnegative"),
        sa.CheckConstraint("overtime_hours >= 0", name="ck_attendance_overtime_nonnegative"), *ts())
    op.create_index("ix_attendance_records_work_date", "attendance_records", ["work_date"])
    op.create_index("ix_attendance_records_employee_id", "attendance_records", ["employee_id"])
    op.create_table("salary_advances",
        sa.Column("id", UUID(), primary_key=True), sa.Column("advance_no", sa.String(80), nullable=False, unique=True),
        sa.Column("advance_date", sa.Date(), nullable=False), sa.Column("employee_id", UUID(), sa.ForeignKey("employees.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("amount", sa.BigInteger(), nullable=False), sa.Column("note", sa.Text()),
        sa.Column("approved_by", UUID(), sa.ForeignKey("users.id")), sa.Column("status", sa.String(30), nullable=False, server_default="APPROVED"),
        sa.Column("idempotency_key", sa.String(100), nullable=False, unique=True),
        sa.CheckConstraint("amount > 0", name="ck_salary_advance_positive"), *ts())
    for col in ("advance_date", "employee_id", "status"): op.create_index(f"ix_salary_advances_{col}", "salary_advances", [col])
    op.create_table("payroll_runs",
        sa.Column("id", UUID(), primary_key=True), sa.Column("payroll_no", sa.String(80), nullable=False, unique=True),
        sa.Column("period_month", sa.Date(), nullable=False, unique=True), sa.Column("status", sa.String(30), nullable=False, server_default="DRAFT"),
        sa.Column("calculated_at", sa.DateTime(timezone=True), nullable=False), sa.Column("approved_by", UUID(), sa.ForeignKey("users.id")),
        sa.Column("approved_at", sa.DateTime(timezone=True)), sa.Column("paid_at", sa.DateTime(timezone=True)),
        sa.Column("total_gross_amount", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("total_advance_amount", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("total_net_amount", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("snapshot", sa.JSON(), nullable=False), sa.Column("created_by", UUID(), sa.ForeignKey("users.id")),
        sa.Column("idempotency_key", sa.String(100), nullable=False, unique=True), sa.Column("version", sa.Integer(), nullable=False, server_default="1"), *ts())
    op.create_index("ix_payroll_runs_period_month", "payroll_runs", ["period_month"])
    op.create_index("ix_payroll_runs_status", "payroll_runs", ["status"])
    op.create_table("payroll_lines",
        sa.Column("id", UUID(), primary_key=True), sa.Column("payroll_run_id", UUID(), sa.ForeignKey("payroll_runs.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("employee_id", UUID(), sa.ForeignKey("employees.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("employee_name_snapshot", sa.String(250), nullable=False), sa.Column("daily_rate_amount", sa.BigInteger(), nullable=False),
        sa.Column("work_units", sa.Numeric(8, 3), nullable=False), sa.Column("overtime_hours", sa.Numeric(8, 3), nullable=False),
        sa.Column("base_amount", sa.BigInteger(), nullable=False), sa.Column("overtime_amount", sa.BigInteger(), nullable=False),
        sa.Column("advance_amount", sa.BigInteger(), nullable=False), sa.Column("net_amount", sa.BigInteger(), nullable=False),
        sa.Column("notes", sa.Text()), sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.UniqueConstraint("payroll_run_id", "employee_id", name="uq_payroll_line_employee"))
    op.create_index("ix_payroll_lines_payroll_run_id", "payroll_lines", ["payroll_run_id"])
    op.create_index("ix_payroll_lines_employee_id", "payroll_lines", ["employee_id"])


def downgrade() -> None:
    for table in ("payroll_lines", "payroll_runs", "salary_advances", "attendance_records", "employees"):
        op.drop_table(table)
