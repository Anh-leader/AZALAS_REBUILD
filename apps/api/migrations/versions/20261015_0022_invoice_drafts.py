"""invoice drafts for the split select/edit/capture/finalize flow

Revision ID: 20261015_0022
Revises: 20261013_0021
"""

from alembic import op

revision = "20261015_0022"
down_revision = "20261013_0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # invoice_drafts is created by the baseline revision 20261009_0001 via
    # Base.metadata.create_all(checkfirst=True). Nothing extra to do here.
    pass


def downgrade() -> None:
    # The table is owned by the baseline revision; do not drop it here.
    pass
