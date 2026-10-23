"""seed order_detail.view permission (tách "Chi tiết đơn" khỏi sales.view)

Revision ID: 20261021_0025
Revises: 20261021_0024
"""
import uuid

from alembic import op
import sqlalchemy as sa

revision = "20261021_0025"
down_revision = "20261021_0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    permission_id = uuid.uuid4()
    bind.execute(
        sa.text(
            """
            INSERT INTO permissions (id, code, module, action, description)
            VALUES (:id, 'order_detail.view', 'SALES', 'ORDER_DETAIL_VIEW',
                    'Xem danh sách và chi tiết đơn hàng.')
            ON CONFLICT (code) DO NOTHING
            """
        ),
        {"id": permission_id},
    )
    bind.execute(
        sa.text(
            """
            INSERT INTO role_permissions (role_id, permission_id)
            SELECT r.id, p.id
            FROM roles r
            CROSS JOIN permissions p
            WHERE r.code IN ('OWNER', 'ADMIN', 'KHO', 'KE_TOAN', 'MEMBER')
              AND p.code = 'order_detail.view'
            ON CONFLICT DO NOTHING
            """
        ),
    )


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            "DELETE FROM role_permissions "
            "WHERE permission_id IN (SELECT id FROM permissions WHERE code = 'order_detail.view')"
        ),
    )
    bind.execute(sa.text("DELETE FROM permissions WHERE code = 'order_detail.view'"))
