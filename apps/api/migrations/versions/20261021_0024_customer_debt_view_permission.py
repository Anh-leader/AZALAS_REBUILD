"""seed customer_debt.view permission (tách công nợ khỏi sales.view)

Revision ID: 20261021_0024
Revises: 20261017_0023
"""
import uuid

from alembic import op
import sqlalchemy as sa

revision = "20261021_0024"
down_revision = "20261017_0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    permission_id = uuid.uuid4()
    bind.execute(
        sa.text(
            """
            INSERT INTO permissions (id, code, module, action, description)
            VALUES (:id, 'customer_debt.view', 'SALES', 'CUSTOMER_DEBT_VIEW',
                    'Xem danh sách khách hàng, công nợ và chi tiết công nợ khách hàng.')
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
            WHERE r.code IN ('OWNER', 'ADMIN', 'KE_TOAN') AND p.code = 'customer_debt.view'
            ON CONFLICT DO NOTHING
            """
        ),
    )


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            "DELETE FROM role_permissions "
            "WHERE permission_id IN (SELECT id FROM permissions WHERE code = 'customer_debt.view')"
        ),
    )
    bind.execute(sa.text("DELETE FROM permissions WHERE code = 'customer_debt.view'"))
