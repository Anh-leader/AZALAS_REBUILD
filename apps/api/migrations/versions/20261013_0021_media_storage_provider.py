"""record canonical media storage provider and checksum"""

from alembic import op

revision = "20261013_0021"
down_revision = "20261012_0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # media_objects.storage_provider and checksum are created by the baseline
    # revision 20261009_0001 via Base.metadata.create_all(checkfirst=True). This
    # migration only backfills canonical values for pre-existing rows (data).
    op.execute(
        """
        UPDATE media_objects
        SET storage_provider = CASE WHEN upper(storage) = 'S3' THEN 's3' ELSE 'local' END,
            checksum = COALESCE(sha256, '')
        """
    )


def downgrade() -> None:
    # Forward-only data backfill; no schema to reverse.
    pass
