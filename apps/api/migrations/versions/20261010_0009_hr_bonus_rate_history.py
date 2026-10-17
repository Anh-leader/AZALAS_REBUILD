"""attendance bonus and employee rate history

Revision ID: 20261010_0009
Revises: 20261010_0008
"""

from alembic import op

revision = "20261010_0009"
down_revision = "20261010_0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # attendance_records.bonus_amount and the employee_rate_history table are
    # created by the baseline revision 20261009_0001 via
    # Base.metadata.create_all(checkfirst=True). Nothing extra to do here.
    pass


def downgrade() -> None:
    # Objects are owned by the baseline revision; do not drop them here.
    pass
