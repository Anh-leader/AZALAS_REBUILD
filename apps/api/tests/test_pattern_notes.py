import uuid


def _upload(client, owner, name="rap.jpg"):
    r = client.post("/api/v1/media/upload", headers=owner, files={"file": (name, b"\xff\xd8\xff" + b"\x00" * 64, "image/jpeg")})
    assert r.status_code == 201, r.text
    return r.json()["data"]["id"]


def _create(client, owner, *, title, content="Nội dung", media_ids=None):
    body = {"title": title, "content": content, "media_ids": media_ids or [],
            "client_token": uuid.uuid4().hex}
    r = client.post("/api/v1/pattern-notes", headers=owner, json=body)
    assert r.status_code == 201, r.text
    return r.json()["data"]


def test_create_note_without_image(client, owner):
    data = _create(client, owner, title="ÁO KHOÁC NAM")
    assert data["title"] == "ÁO KHOÁC NAM"
    assert data["image_count"] == 0
    assert data["cover_image"] is None


def test_create_note_with_images_and_cover(client, owner):
    m1 = _upload(client, owner, "a.jpg")
    m2 = _upload(client, owner, "b.jpg")
    data = _create(client, owner, title="TRG TEST", media_ids=[m1, m2])
    assert data["image_count"] == 2
    assert data["cover_image"]["id"] == m1  # ảnh đầu là cover


def test_list_and_search(client, owner):
    _create(client, owner, title="ÁO KHOÁC NAM", content="mô tả áo")
    _create(client, owner, title="QUẦN NAM", content="mô tả quần")
    r = client.get("/api/v1/pattern-notes", headers=owner)
    rows = r.json()["data"]
    assert any(n["title"] == "ÁO KHOÁC NAM" for n in rows)
    # Search theo title.
    by_title = client.get("/api/v1/pattern-notes", headers=owner, params={"q": "ÁO KHOÁC"})
    titles = [n["title"] for n in by_title.json()["data"]]
    assert "ÁO KHOÁC NAM" in titles
    assert "QUẦN NAM" not in titles
    # Search theo content.
    by_content = client.get("/api/v1/pattern-notes", headers=owner, params={"q": "mô tả quần"})
    assert any(n["title"] == "QUẦN NAM" for n in by_content.json()["data"])


def test_detail_returns_full_images(client, owner):
    m1 = _upload(client, owner, "a.jpg")
    m2 = _upload(client, owner, "b.jpg")
    data = _create(client, owner, title="TRG DETAIL", media_ids=[m1, m2])
    r = client.get(f"/api/v1/pattern-notes/{data['id']}", headers=owner)
    assert r.status_code == 200
    detail = r.json()["data"]
    assert detail["image_count"] == 2
    assert len(detail["images"]) == 2


def test_note_forbidden_for_member(client, owner):
    username = f"member_{uuid.uuid4().hex[:8]}"
    client.post("/api/v1/users", headers=owner, json={
        "username": username, "password": "safe-pass-123", "display_name": "Member", "phone": None, "role_codes": ["MEMBER"]})
    login = client.post("/api/v1/auth/login", json={"username": username, "password": "safe-pass-123"})
    member = {"Authorization": f"Bearer {login.json()['data']['access_token']}"}
    r = client.get("/api/v1/pattern-notes", headers=member)
    assert r.status_code == 403
