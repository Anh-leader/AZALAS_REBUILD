"""production batch media attachments

Revision ID: 20261011_0010
Revises: 20261010_0009
"""

from alembic import op
import sqlalchemy as sa

revision = "20261011_0010"
down_revision = "20261010_0009"
branch_labels = None
depends_on = None
UUID = sa.Uuid


def upgrade() -> None:
    op.create_table(
        "production_batch_media",
        sa.Column("batch_id", UUID(), sa.ForeignKey("production_batches.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("media_id", UUID(), sa.ForeignKey("media_objects.id", ondelete="CASCADE"), primary_key=True),
    )


def downgrade() -> None:
    op.drop_table("production_batch_media")
