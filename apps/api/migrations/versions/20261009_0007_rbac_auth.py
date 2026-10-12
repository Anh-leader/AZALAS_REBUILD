"""normalized RBAC and revocable refresh sessions

Revision ID: 20261009_0007
Revises: 20261009_0006
"""
import uuid
from alembic import op
import sqlalchemy as sa

revision = "20261009_0007"
down_revision = "20261009_0006"
branch_labels = None
depends_on = None
UUID = sa.Uuid

PERMISSIONS = [
    ("sales.view", "SALES", "VIEW"), ("sales.create", "SALES", "CREATE"), ("sales.pick", "SALES", "PICK"),
    ("sales.ship", "SALES", "SHIP"), ("sales.invoice", "SALES", "INVOICE"), ("sales.returns", "SALES", "RETURNS"),
    ("sales.debt.adjust", "SALES", "DEBT_ADJUST"), ("production.view", "PRODUCTION", "VIEW"),
    ("production.manage", "PRODUCTION", "MANAGE"), ("production.settle", "PRODUCTION", "SETTLE"),
    ("materials.view", "MATERIALS", "VIEW"), ("materials.manage", "MATERIALS", "MANAGE"),
    ("materials.settle", "MATERIALS", "SETTLE"), ("hr.view", "HR", "VIEW"), ("hr.manage", "HR", "MANAGE"),
    ("hr.payroll.approve", "HR", "PAYROLL_APPROVE"), ("reports.view", "REPORTS", "VIEW"),
    ("reports.picker", "REPORTS", "PICKER"), ("reports.audit", "REPORTS", "AUDIT"),
    ("admin.users", "ADMIN", "USERS"), ("admin.roles", "ADMIN", "ROLES"),
]

ROLE_PERMISSIONS = {
    "OWNER": [code for code, _, _ in PERMISSIONS],
    "ADMIN": [code for code, _, _ in PERMISSIONS],
    "KHO": ["sales.view", "sales.create", "sales.pick", "sales.ship", "production.view", "materials.view"],
    "KE_TOAN": ["sales.view", "sales.invoice", "sales.returns", "sales.debt.adjust", "production.view", "production.settle",
                 "materials.view", "materials.settle", "reports.view"],
    "NHAN_SU": ["hr.view", "hr.manage", "hr.payroll.approve", "reports.view"],
    "MEMBER": ["sales.view"],
}


def upgrade() -> None:
    op.create_table("roles", sa.Column("id", UUID(), primary_key=True), sa.Column("code", sa.String(50), nullable=False, unique=True),
        sa.Column("name", sa.String(150), nullable=False), sa.Column("description", sa.Text()),
        sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    op.create_table("permissions", sa.Column("id", UUID(), primary_key=True), sa.Column("code", sa.String(100), nullable=False, unique=True),
        sa.Column("module", sa.String(50), nullable=False), sa.Column("action", sa.String(50), nullable=False), sa.Column("description", sa.Text()))
    op.create_index("ix_permissions_module", "permissions", ["module"])
    op.create_table("user_roles", sa.Column("user_id", UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("role_id", UUID(), sa.ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("assigned_by", UUID(), sa.ForeignKey("users.id")),
        sa.Column("assigned_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    op.create_table("role_permissions", sa.Column("role_id", UUID(), sa.ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("permission_id", UUID(), sa.ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True))
    op.create_table("refresh_tokens", sa.Column("id", UUID(), primary_key=True),
        sa.Column("user_id", UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True), sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True)), sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_ip", sa.String(64)))
    op.create_index("ix_refresh_tokens_user_id", "refresh_tokens", ["user_id"])
    op.create_index("ix_refresh_tokens_expires_at", "refresh_tokens", ["expires_at"])

    role_ids = {code: uuid.uuid4() for code in ROLE_PERMISSIONS}
    permission_ids = {code: uuid.uuid4() for code, _, _ in PERMISSIONS}
    roles = sa.table("roles", sa.column("id", UUID()), sa.column("code", sa.String()), sa.column("name", sa.String()),
                     sa.column("description", sa.Text()), sa.column("is_system", sa.Boolean()))
    permissions = sa.table("permissions", sa.column("id", UUID()), sa.column("code", sa.String()), sa.column("module", sa.String()),
                           sa.column("action", sa.String()), sa.column("description", sa.Text()))
    role_permissions = sa.table("role_permissions", sa.column("role_id", UUID()), sa.column("permission_id", UUID()))
    op.bulk_insert(roles, [{"id": role_ids[code], "code": code, "name": code.replace("_", " ").title(),
                            "description": f"Vai trò hệ thống {code}", "is_system": True} for code in ROLE_PERMISSIONS])
    op.bulk_insert(permissions, [{"id": permission_ids[code], "code": code, "module": module, "action": action,
                                  "description": code} for code, module, action in PERMISSIONS])
    op.bulk_insert(role_permissions, [{"role_id": role_ids[role], "permission_id": permission_ids[permission]}
                                      for role, values in ROLE_PERMISSIONS.items() for permission in values])
    op.execute(sa.text("INSERT INTO user_roles (user_id, role_id) SELECT users.id, roles.id FROM users JOIN roles ON roles.code = users.role"))


def downgrade() -> None:
    for table in ("refresh_tokens", "role_permissions", "user_roles", "permissions", "roles"):
        op.drop_table(table)
