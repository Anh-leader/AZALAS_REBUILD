import uuid

from fastapi import Depends, Header
from sqlalchemy.orm import Session

from ..models import User
from .db import get_db
from .errors import ApiError
from .security import decode_token
from .rbac import has_permission


def current_user(authorization: str | None = Header(None), db: Session = Depends(get_db)) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise ApiError(401, "UNAUTHENTICATED", "Bạn cần đăng nhập.")
    user_id = decode_token(authorization.split(" ", 1)[1])
    try:
        user = db.get(User, uuid.UUID(user_id)) if user_id else None
    except (ValueError, TypeError):
        user = None
    if not user or user.status != "ACTIVE":
        raise ApiError(401, "UNAUTHENTICATED", "Phiên đăng nhập không hợp lệ.")
    return user


def require_owner(user: User = Depends(current_user)) -> User:
    if user.role not in ("OWNER", "ADMIN"):
        raise ApiError(403, "FORBIDDEN", "Chỉ tài khoản OWNER được xem thống kê người soạn.")
    return user


def require_accounting(user: User = Depends(current_user)) -> User:
    if user.role not in ("OWNER", "ADMIN", "KE_TOAN"):
        raise ApiError(403, "FORBIDDEN", "Chỉ OWNER, ADMIN hoặc KẾ TOÁN được điều chỉnh công nợ.")
    return user


def require_permission(permission: str):
    def dependency(db: Session = Depends(get_db), user: User = Depends(current_user)) -> User:
        if not has_permission(db, user, permission):
            raise ApiError(403, "FORBIDDEN", f"Bạn không có quyền {permission}.")
        return user
    return dependency
