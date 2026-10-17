"""invoice capture image and soft-delete for pending invoice orders

Revision ID: 20261010_0008
Revises: 20261009_0007
"""

from alembic import op

revision = "20261010_0008"
down_revision = "20261009_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # invoices.captured_invoice_media_id/captured_at and the invoice_captures
    # table are created by the baseline revision 20261009_0001 via
    # Base.metadata.create_all(checkfirst=True). Nothing extra to do here.
    pass


def downgrade() -> None:
    # Objects are owned by the baseline revision; do not drop them here.
    pass
