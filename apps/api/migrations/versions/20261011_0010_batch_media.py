"""production batch media attachments

Revision ID: 20261011_0010
Revises: 20261010_0009
"""

from alembic import op

revision = "20261011_0010"
down_revision = "20261010_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # production_batch_media is created by the baseline revision 20261009_0001
    # via Base.metadata.create_all(checkfirst=True). Nothing extra to do here.
    pass


def downgrade() -> None:
    # The table is owned by the baseline revision; do not drop it here.
    pass
