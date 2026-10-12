import os

import pytest
import sqlalchemy as sa

# Trỏ app sang DB test trước khi import app
TEST_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg://azalas:azalas_dev@localhost:5433/azalas_test"
)


def _pick_url() -> str:
    try:
        sa.create_engine(TEST_URL, connect_args={"connect_timeout": 2}).connect().close()
        return TEST_URL
    except Exception:
        if os.environ.get("REQUIRE_POSTGRES") == "1":
            raise
        print("\n[!] Không kết nối được PostgreSQL test, dùng SQLite tạm thời.")
        return "sqlite:///./test_fallback.db"


os.environ["DATABASE_URL"] = _pick_url()
os.environ["UPLOAD_DIR"] = "uploads_test"

from fastapi.testclient import TestClient  # noqa: E402

from app.core.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import seed_demo  # noqa: E402


@pytest.fixture()
def db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with SessionLocal() as s:
        seed_demo(s)
        yield s


@pytest.fixture()
def client(db):
    return TestClient(app)


def login(client: TestClient, username: str = "owner", password: str = "owner123") -> dict:
    r = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['data']['access_token']}"}


@pytest.fixture()
def owner(client):
    return login(client)


@pytest.fixture()
def picker(client):
    return login(client, "thupham", "demo123")
