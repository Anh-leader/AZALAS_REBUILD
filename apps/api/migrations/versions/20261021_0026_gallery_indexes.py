"""add gallery query indexes (orders.created_date, media_objects.status, order_media.media_id)

Revision ID: 20261021_0026
Revises: 20261021_0025
"""
from alembic import op

revision = "20261021_0026"
down_revision = "20261021_0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE INDEX IF NOT EXISTS ix_orders_created_date ON orders (created_date)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_media_objects_status ON media_objects (status)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_order_media_media_id ON order_media (media_id)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_orders_created_date")
    op.execute("DROP INDEX IF EXISTS ix_media_objects_status")
    op.execute("DROP INDEX IF EXISTS ix_order_media_media_id")
