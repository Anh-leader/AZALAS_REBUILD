"""partners, material purchasing, settlements and private attachments

Revision ID: 20261009_0005
Revises: 20261009_0004
"""

from alembic import op

revision = "20261009_0005"
down_revision = "20261009_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # partners/materials/material_variants/material_receipts/.../partner_files are
    # created by the baseline revision 20261009_0001 via
    # Base.metadata.create_all(checkfirst=True). Nothing extra to do here.
    pass


def downgrade() -> None:
    # Tables are owned by the baseline revision; do not drop them here.
    pass
