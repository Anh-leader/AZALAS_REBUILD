import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.deps import require_permission
from ..core.errors import ApiError
from ..core.rbac import access_for_user
from ..core.security import hash_password
from ..models import Permission, RefreshToken, Role, RolePermission, User, UserRole
from .auth import user_dict

router = APIRouter(tags=["admin"])


def role_dict(row: Role, db: Session) -> dict:
    permissions = list(db.scalars(select(Permission.code).join(RolePermission, RolePermission.permission_id == Permission.id).where(RolePermission.role_id == row.id).order_by(Permission.code)))
    return {"id": str(row.id), "code": row.code, "name": row.name, "description": row.description,
            "is_system": row.is_system, "permissions": permissions}


@router.get("/users")
def users(db: Session = Depends(get_db), _=Depends(require_permission("admin.users"))):
    return {"data": [user_dict(row, db) for row in db.scalars(select(User).order_by(User.display_name))]}


class UserIn(BaseModel):
    username: str = Field(min_length=3, max_length=80)
    password: str = Field(min_length=8, max_length=200)
    display_name: str = Field(min_length=1, max_length=200)
    phone: str | None = Field(None, max_length=30)
    role_codes: list[str] = Field(min_length=1, max_length=10)


@router.post("/users", status_code=201)
def create_user(body: UserIn, db: Session = Depends(get_db), actor: User = Depends(require_permission("admin.users"))):
    username = body.username.strip().lower()
    if db.scalar(select(User.id).where(User.username == username)): raise ApiError(409, "USER_EXISTS", "Tên đăng nhập đã tồn tại.")
    roles = list(db.scalars(select(Role).where(Role.code.in_(body.role_codes))))
    if len(roles) != len(set(body.role_codes)): raise ApiError(422, "ROLE_INVALID", "Có vai trò không tồn tại.")
    row = User(username=username, password_hash=hash_password(body.password), display_name=body.display_name.strip(),
               phone=body.phone, role=roles[0].code, status="ACTIVE")
    db.add(row); db.flush()
    for role in roles: db.add(UserRole(user_id=row.id, role_id=role.id, assigned_by=actor.id))
    db.commit(); return {"data": user_dict(row, db)}


class UserPatch(BaseModel):
    display_name: str | None = Field(None, min_length=1, max_length=200)
    phone: str | None = Field(None, max_length=30)
    status: str | None = None


@router.patch("/users/{user_id}")
def patch_user(user_id: uuid.UUID, body: UserPatch, db: Session = Depends(get_db), actor: User = Depends(require_permission("admin.users"))):
    row = db.get(User, user_id)
    if not row: raise ApiError(404, "USER_NOT_FOUND", "Không tìm thấy tài khoản.")
    values = body.model_dump(exclude_unset=True)
    if row.id == actor.id and values.get("status") and values["status"] != "ACTIVE":
        raise ApiError(409, "CANNOT_LOCK_SELF", "Không thể tự khóa tài khoản đang đăng nhập.")
    for key, value in values.items(): setattr(row, key, value)
    if values.get("status") and values["status"] != "ACTIVE":
        for token in db.scalars(select(RefreshToken).where(RefreshToken.user_id == row.id, RefreshToken.revoked_at.is_(None))): token.revoked_at = datetime.now(timezone.utc)
    db.commit(); return {"data": user_dict(row, db)}


class AssignRolesIn(BaseModel):
    role_codes: list[str] = Field(min_length=1, max_length=10)


@router.put("/users/{user_id}/roles")
def assign_roles(user_id: uuid.UUID, body: AssignRolesIn, db: Session = Depends(get_db), actor: User = Depends(require_permission("admin.roles"))):
    row = db.get(User, user_id)
    if not row: raise ApiError(404, "USER_NOT_FOUND", "Không tìm thấy tài khoản.")
    roles = list(db.scalars(select(Role).where(Role.code.in_(body.role_codes))))
    if len(roles) != len(set(body.role_codes)): raise ApiError(422, "ROLE_INVALID", "Có vai trò không tồn tại.")
    db.execute(delete(UserRole).where(UserRole.user_id == row.id))
    for role in roles: db.add(UserRole(user_id=row.id, role_id=role.id, assigned_by=actor.id))
    row.role = roles[0].code; db.commit(); return {"data": user_dict(row, db)}


class ResetPasswordIn(BaseModel):
    new_password: str = Field(min_length=8, max_length=200)


@router.post("/users/{user_id}/reset-password")
def reset_password(user_id: uuid.UUID, body: ResetPasswordIn, db: Session = Depends(get_db), _=Depends(require_permission("admin.users"))):
    row = db.get(User, user_id)
    if not row: raise ApiError(404, "USER_NOT_FOUND", "Không tìm thấy tài khoản.")
    row.password_hash = hash_password(body.new_password)
    for token in db.scalars(select(RefreshToken).where(RefreshToken.user_id == row.id, RefreshToken.revoked_at.is_(None))): token.revoked_at = datetime.now(timezone.utc)
    db.commit(); return {"data": {"reset": True}}


@router.get("/permissions")
def permissions(db: Session = Depends(get_db), _=Depends(require_permission("admin.roles"))):
    return {"data": [{"id": str(row.id), "code": row.code, "module": row.module, "action": row.action,
                      "description": row.description} for row in db.scalars(select(Permission).order_by(Permission.module, Permission.code))]}


@router.get("/roles")
def roles(db: Session = Depends(get_db), _=Depends(require_permission("admin.roles"))):
    return {"data": [role_dict(row, db) for row in db.scalars(select(Role).order_by(Role.code))]}


class RoleIn(BaseModel):
    code: str = Field(min_length=2, max_length=50)
    name: str = Field(min_length=2, max_length=150)
    description: str | None = None
    permission_codes: list[str] = Field(default_factory=list)


@router.post("/roles", status_code=201)
def create_role(body: RoleIn, db: Session = Depends(get_db), _=Depends(require_permission("admin.roles"))):
    code = body.code.strip().upper()
    if db.scalar(select(Role.id).where(Role.code == code)): raise ApiError(409, "ROLE_EXISTS", "Mã vai trò đã tồn tại.")
    permission_rows = list(db.scalars(select(Permission).where(Permission.code.in_(body.permission_codes))))
    if len(permission_rows) != len(set(body.permission_codes)): raise ApiError(422, "PERMISSION_INVALID", "Có quyền không tồn tại.")
    row = Role(code=code, name=body.name.strip(), description=body.description, is_system=False); db.add(row); db.flush()
    for permission in permission_rows: db.add(RolePermission(role_id=row.id, permission_id=permission.id))
    db.commit(); return {"data": role_dict(row, db)}


class RolePatch(BaseModel):
    name: str | None = Field(None, min_length=2, max_length=150)
    description: str | None = None
    permission_codes: list[str] | None = None


@router.patch("/roles/{role_id}")
def patch_role(role_id: uuid.UUID, body: RolePatch, db: Session = Depends(get_db), _=Depends(require_permission("admin.roles"))):
    row = db.get(Role, role_id)
    if not row: raise ApiError(404, "ROLE_NOT_FOUND", "Không tìm thấy vai trò.")
    values = body.model_dump(exclude_unset=True); permission_codes = values.pop("permission_codes", None)
    for key, value in values.items(): setattr(row, key, value)
    if permission_codes is not None:
        permission_rows = list(db.scalars(select(Permission).where(Permission.code.in_(permission_codes))))
        if len(permission_rows) != len(set(permission_codes)): raise ApiError(422, "PERMISSION_INVALID", "Có quyền không tồn tại.")
        db.execute(delete(RolePermission).where(RolePermission.role_id == row.id))
        for permission in permission_rows: db.add(RolePermission(role_id=row.id, permission_id=permission.id))
    db.commit(); return {"data": role_dict(row, db)}
