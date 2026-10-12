"""MVP baseline tables for identity, CRM, orders, ledger and media.

The initial migration intentionally uses the SQLAlchemy metadata as one source of
truth. Subsequent schema changes must use explicit Alembic revisions.
"""

from alembic import op

from app.core.db import Base
import app.models  # noqa: F401

revision = "20261009_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    Base.metadata.create_all(bind=op.get_bind(), checkfirst=True)


def downgrade() -> None:
    Base.metadata.drop_all(bind=op.get_bind(), checkfirst=True)
