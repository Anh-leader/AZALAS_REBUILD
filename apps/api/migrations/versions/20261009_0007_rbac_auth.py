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
    # roles/permissions/user_roles/role_permissions/refresh_tokens are created by
    # the baseline revision 20261009_0001 via Base.metadata.create_all(checkfirst=True).
    # This migration only seeds the system RBAC roles/permissions (data, not schema).
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
    # Reverse the seed only; do not drop the RBAC tables (owned by baseline 0001).
    role_codes = sorted(ROLE_PERMISSIONS)
    permission_codes = sorted({code for code, _, _ in PERMISSIONS})

    def quoted(codes):
        return ", ".join(f"'{c}'" for c in codes)

    bind = op.get_bind()
    bind.execute(sa.text(
        "DELETE FROM role_permissions "
        f"WHERE role_id IN (SELECT id FROM roles WHERE code IN ({quoted(role_codes)})) "
        f"OR permission_id IN (SELECT id FROM permissions WHERE code IN ({quoted(permission_codes)}))"
    ))
    bind.execute(sa.text(
        "DELETE FROM user_roles "
        f"WHERE role_id IN (SELECT id FROM roles WHERE code IN ({quoted(role_codes)}))"
    ))
    bind.execute(sa.text(
        f"DELETE FROM permissions WHERE code IN ({quoted(permission_codes)})"
    ))
    bind.execute(sa.text(
        f"DELETE FROM roles WHERE code IN ({quoted(role_codes)}) AND is_system = TRUE"
    ))
