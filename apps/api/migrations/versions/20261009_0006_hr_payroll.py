"""employees, attendance, salary advances and immutable payroll snapshots

Revision ID: 20261009_0006
Revises: 20261009_0005
"""
from alembic import op

revision = "20261009_0006"
down_revision = "20261009_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # employees/attendance_records/salary_advances/payroll_runs/payroll_lines are
    # created by the baseline revision 20261009_0001 via
    # Base.metadata.create_all(checkfirst=True). Nothing extra to do here.
    pass


def downgrade() -> None:
    # Tables are owned by the baseline revision; do not drop them here.
    pass
