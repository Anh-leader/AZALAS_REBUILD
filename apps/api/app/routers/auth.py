from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.deps import current_user
from ..core.errors import ApiError
from ..core.config import settings
from ..core.rbac import access_for_user
from ..core.security import create_token, hash_password, token_hash, verify_password, decode_token
from ..models import RefreshToken, User

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginIn(BaseModel):
    username: str
    password: str


def user_dict(u: User, db: Session) -> dict:
    roles, permissions = access_for_user(db, u)
    return {"id": str(u.id), "username": u.username, "display_name": u.display_name,
            "role": roles[0] if roles else u.role, "roles": roles, "permissions": sorted(permissions),
            "phone": u.phone, "status": u.status}


def issue_session(db: Session, user: User, request: Request | None = None) -> dict:
    access_token = create_token(str(user.id), "access"); refresh_token = create_token(str(user.id), "refresh")
    db.add(RefreshToken(user_id=user.id, token_hash=token_hash(refresh_token),
                        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.jwt_refresh_days),
                        created_ip=request.client.host if request and request.client else None))
    return {"access_token": access_token, "refresh_token": refresh_token, "token_type": "bearer",
            "expires_in": settings.jwt_expire_minutes * 60, "user": user_dict(user, db)}


@router.post("/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.username == body.username.strip().lower()))
    if not user or not verify_password(body.password, user.password_hash):
        raise ApiError(401, "INVALID_CREDENTIALS", "Sai tên đăng nhập hoặc mật khẩu.")
    if user.status != "ACTIVE":
        raise ApiError(403, "ACCOUNT_LOCKED", "Tài khoản đã bị khóa.")
    user.last_login_at = datetime.now(timezone.utc)
    result = issue_session(db, user, request); db.commit()
    return {"data": result}


@router.get("/me")
def me(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"data": user_dict(user, db)}


class RefreshIn(BaseModel):
    refresh_token: str


@router.post("/refresh")
def refresh(body: RefreshIn, request: Request, db: Session = Depends(get_db)):
    user_id = decode_token(body.refresh_token, "refresh")
    stored = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash(body.refresh_token)).with_for_update(of=RefreshToken))
    current = datetime.now(timezone.utc)
    expires_at = stored.expires_at.replace(tzinfo=timezone.utc) if stored and stored.expires_at.tzinfo is None else (stored.expires_at if stored else None)
    if not user_id or not stored or stored.revoked_at or not expires_at or expires_at <= current:
        raise ApiError(401, "REFRESH_TOKEN_INVALID", "Phiên làm mới không hợp lệ hoặc đã hết hạn.")
    user = db.get(User, stored.user_id)
    if not user or str(user.id) != user_id or user.status != "ACTIVE":
        raise ApiError(401, "REFRESH_TOKEN_INVALID", "Tài khoản không còn hoạt động.")
    stored.revoked_at = current
    result = issue_session(db, user, request); db.commit()
    return {"data": result}


@router.post("/logout")
def logout(body: RefreshIn, db: Session = Depends(get_db), _=Depends(current_user)):
    stored = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash(body.refresh_token)).with_for_update(of=RefreshToken))
    if stored and not stored.revoked_at: stored.revoked_at = datetime.now(timezone.utc)
    db.commit(); return {"data": {"logged_out": True}}


class PasswordIn(BaseModel):
    current_password: str
    new_password: str


@router.post("/change-password")
def change_password(body: PasswordIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    if not verify_password(body.current_password, user.password_hash):
        raise ApiError(422, "CURRENT_PASSWORD_INVALID", "Mật khẩu hiện tại không đúng.")
    if len(body.new_password) < 8 or body.new_password == body.current_password:
        raise ApiError(422, "PASSWORD_WEAK", "Mật khẩu mới cần ít nhất 8 ký tự và phải khác mật khẩu cũ.")
    user.password_hash = hash_password(body.new_password)
    for token in db.scalars(select(RefreshToken).where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))):
        token.revoked_at = datetime.now(timezone.utc)
    db.commit(); return {"data": {"changed": True}}
