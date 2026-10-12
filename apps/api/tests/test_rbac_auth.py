import uuid

from sqlalchemy import select

from app.models import RefreshToken, Role, User


def _create_user(client, owner, role="MEMBER"):
    username = f"user_{uuid.uuid4().hex[:8]}"
    response = client.post("/api/v1/users", headers=owner, json={
        "username": username, "password": "safe-pass-123", "display_name": "Người dùng RBAC",
        "phone": None, "role_codes": [role],
    })
    assert response.status_code == 201, response.text
    return response.json()["data"], username


def _login(client, username, password="safe-pass-123"):
    response = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.text
    return response.json()["data"]


def test_login_refresh_rotates_and_logout_revokes_session(client, owner, db):
    user, username = _create_user(client, owner)
    session = _login(client, username)
    assert session["access_token"]
    assert session["refresh_token"]
    assert session["user"]["roles"] == ["MEMBER"]
    refreshed = client.post("/api/v1/auth/refresh", json={"refresh_token": session["refresh_token"]})
    assert refreshed.status_code == 200, refreshed.text
    rotated = refreshed.json()["data"]
    assert rotated["refresh_token"] != session["refresh_token"]
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": session["refresh_token"]}).status_code == 401
    auth = {"Authorization": f"Bearer {rotated['access_token']}"}
    assert client.post("/api/v1/auth/logout", headers=auth, json={"refresh_token": rotated["refresh_token"]}).status_code == 200
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": rotated["refresh_token"]}).status_code == 401


def test_member_is_forbidden_from_restricted_api_even_when_calling_directly(client, owner):
    _, username = _create_user(client, owner, "MEMBER"); session = _login(client, username)
    auth = {"Authorization": f"Bearer {session['access_token']}"}
    assert client.get("/api/v1/employees", headers=auth).status_code == 403
    assert client.get("/api/v1/production/batches", headers=auth).status_code == 403
    assert client.get("/api/v1/audit-logs", headers=auth).status_code == 403
    assert client.get("/api/v1/reports/overview", headers=auth).status_code == 403
    assert client.get("/api/v1/reports/action-items", headers=auth).status_code == 403
    assert client.get("/api/v1/order-work-queue", headers=auth).status_code == 200


def test_role_assignment_changes_effective_permissions_without_name_fk(client, owner, db):
    user, username = _create_user(client, owner, "MEMBER"); member_session = _login(client, username)
    assert client.get("/api/v1/employees", headers={"Authorization": f"Bearer {member_session['access_token']}"}).status_code == 403
    response = client.put(f"/api/v1/users/{user['id']}/roles", headers=owner, json={"role_codes": ["NHAN_SU"]})
    assert response.status_code == 200, response.text
    assert response.json()["data"]["permissions"]
    hr_session = _login(client, username)
    assert client.get("/api/v1/employees", headers={"Authorization": f"Bearer {hr_session['access_token']}"}).status_code == 200
    assert db.scalar(select(User).where(User.id == uuid.UUID(user["id"]))).role == "NHAN_SU"


def test_owner_can_manage_roles_and_member_cannot(client, owner):
    permissions = client.get("/api/v1/permissions", headers=owner)
    assert permissions.status_code == 200
    codes = {row["code"] for row in permissions.json()["data"]}
    assert {"admin.users", "production.manage", "hr.payroll.approve"}.issubset(codes)
    role = client.post("/api/v1/roles", headers=owner, json={
        "code": f"CUSTOM_{uuid.uuid4().hex[:6]}", "name": "Vai trò tùy chỉnh", "description": None,
        "permission_codes": ["production.view"],
    })
    assert role.status_code == 201, role.text
    _, username = _create_user(client, owner, "MEMBER"); session = _login(client, username)
    auth = {"Authorization": f"Bearer {session['access_token']}"}
    assert client.get("/api/v1/roles", headers=auth).status_code == 403


def test_change_password_revokes_refresh_tokens_and_accepts_new_password(client, owner):
    _, username = _create_user(client, owner); session = _login(client, username)
    auth = {"Authorization": f"Bearer {session['access_token']}"}
    changed = client.post("/api/v1/auth/change-password", headers=auth,
                          json={"current_password": "safe-pass-123", "new_password": "new-safe-pass-456"})
    assert changed.status_code == 200, changed.text
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": session["refresh_token"]}).status_code == 401
    assert client.post("/api/v1/auth/login", json={"username": username, "password": "safe-pass-123"}).status_code == 401
    assert client.post("/api/v1/auth/login", json={"username": username, "password": "new-safe-pass-456"}).status_code == 200
