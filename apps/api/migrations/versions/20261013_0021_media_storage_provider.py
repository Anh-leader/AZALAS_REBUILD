"""record canonical media storage provider and checksum"""

from alembic import op
import sqlalchemy as sa

revision = "20261013_0021"
down_revision = "20261012_0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "media_objects",
        sa.Column("storage_provider", sa.String(length=20), server_default="local", nullable=False),
    )
    op.add_column(
        "media_objects",
        sa.Column("checksum", sa.String(length=64), server_default="", nullable=False),
    )
    op.execute(
        """
        UPDATE media_objects
        SET storage_provider = CASE WHEN upper(storage) = 'S3' THEN 's3' ELSE 'local' END,
            checksum = COALESCE(sha256, '')
        """
    )


def downgrade() -> None:
    op.drop_column("media_objects", "checksum")
    op.drop_column("media_objects", "storage_provider")
