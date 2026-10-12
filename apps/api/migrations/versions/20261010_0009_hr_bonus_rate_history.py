"""attendance bonus and employee rate history

Revision ID: 20261010_0009
Revises: 20261010_0008
"""

from alembic import op
import sqlalchemy as sa

revision = "20261010_0009"
down_revision = "20261010_0008"
branch_labels = None
depends_on = None
UUID = sa.Uuid


def upgrade() -> None:
    # 1. Thưởng trên bản ghi chấm công.
    op.add_column("attendance_records", sa.Column("bonus_amount", sa.BigInteger(), nullable=False, server_default="0"))

    # 2. Lịch sử đổi giá công (tăng lương), giữ nguyên lịch sử cũ.
    op.create_table(
        "employee_rate_history",
        sa.Column("id", UUID(), primary_key=True),
        sa.Column("employee_id", UUID(), sa.ForeignKey("employees.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("effective_date", sa.Date(), nullable=False),
        sa.Column("old_daily_rate_amount", sa.BigInteger(), nullable=False),
        sa.Column("new_daily_rate_amount", sa.BigInteger(), nullable=False),
        sa.Column("reason", sa.Text()),
        sa.Column("changed_by", UUID(), sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("new_daily_rate_amount >= 0", name="ck_rate_history_new_nonnegative"),
    )
    op.create_index("ix_employee_rate_history_employee_id", "employee_rate_history", ["employee_id"])


def downgrade() -> None:
    op.drop_index("ix_employee_rate_history_employee_id", table_name="employee_rate_history")
    op.drop_table("employee_rate_history")
    op.drop_column("attendance_records", "bonus_amount")
