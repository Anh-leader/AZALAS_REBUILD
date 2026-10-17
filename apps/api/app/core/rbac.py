from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Permission, Role, RolePermission, User, UserRole

ALL_PERMISSIONS = {
    "sales.view", "sales.create", "sales.pick", "sales.ship", "sales.invoice", "sales.returns", "sales.debt.adjust", "order.delete",
    "production.view", "production.manage", "production.settle", "materials.view", "materials.manage", "materials.settle",
    "hr.view", "hr.manage", "hr.payroll.approve", "reports.view", "reports.picker", "reports.audit",
    "admin.users", "admin.roles",
}

LEGACY_ROLE_PERMISSIONS = {
    "OWNER": {"*"}, "ADMIN": {"*"},
    "KHO": {"sales.view", "sales.create", "sales.pick", "sales.ship", "production.view", "materials.view"},
    "KE_TOAN": {"sales.view", "sales.invoice", "sales.returns", "sales.debt.adjust", "production.view", "production.settle", "materials.view", "materials.settle", "reports.view"},
    "NHAN_SU": {"hr.view", "hr.manage", "hr.payroll.approve", "reports.view"},
    "MEMBER": {"sales.view"},
}


def access_for_user(db: Session, user: User) -> tuple[list[str], set[str]]:
    roles = list(db.scalars(select(Role).join(UserRole, UserRole.role_id == Role.id).where(UserRole.user_id == user.id).order_by(Role.code)))
    if not roles:
        return [user.role], set(LEGACY_ROLE_PERMISSIONS.get(user.role, set()))
    role_ids = [role.id for role in roles]
    permissions = set(db.scalars(select(Permission.code).join(RolePermission, RolePermission.permission_id == Permission.id).where(RolePermission.role_id.in_(role_ids))))
    return [role.code for role in roles], permissions


def has_permission(db: Session, user: User, permission: str) -> bool:
    roles, permissions = access_for_user(db, user)
    return "OWNER" in roles or "ADMIN" in roles or "*" in permissions or permission in permissions
