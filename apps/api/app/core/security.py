from datetime import datetime, timedelta, timezone
import hashlib
import uuid

import bcrypt
import jwt

from .config import settings


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False


def create_token(user_id: str, token_type: str = "access") -> str:
    lifetime = timedelta(minutes=settings.jwt_expire_minutes) if token_type == "access" else timedelta(days=settings.jwt_refresh_days)
    now = datetime.now(timezone.utc)
    return jwt.encode({"sub": user_id, "type": token_type, "jti": uuid.uuid4().hex, "iat": now, "exp": now + lifetime},
                      settings.jwt_secret, algorithm="HS256")


def decode_token(token: str, expected_type: str = "access") -> str | None:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
        if payload.get("type", "access") != expected_type:
            return None
        return payload["sub"]
    except jwt.PyJWTError:
        return None


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
