import uuid
from decimal import Decimal

from sqlalchemy import func, select

from app.models import Customer, MediaObject, Order, OrderMedia, Warehouse


JPEG = b"\xff\xd8\xff" + b"\x00" * 128
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 128
WEBP = b"RIFF" + b"\x00\x00\x00\x00" + b"WEBP" + b"\x00" * 128


def _upload(client, auth, name="anh-zalo-1.jpg", data=JPEG):
    r = client.post("/api/v1/media/upload", headers=auth, files={"file": (name, data, "image/jpeg")})
    assert r.status_code == 201, r.text
    return r.json()["data"]


def _customer(db):
    return db.scalar(select(Customer).order_by(Customer.id))


def _create(client, auth, db, *, media_ids, mode="TAN_XUAN"):
    return client.post("/api/v1/orders", headers={**auth, "Idempotency-Key": uuid.uuid4().hex}, json={
        "customer_id": str(_customer(db).id), "warehouse_mode": mode,
        "created_date": "2026-10-10", "delivery_date": None,
        "is_urgent": False, "customer_note": "Media test", "media_ids": [str(m) for m in media_ids],
    })


def test_upload_jpeg_creates_media_record(client, owner, db):
    media = _upload(client, owner)
    row = db.get(MediaObject, uuid.UUID(media["id"]))
    assert row is not None
    assert row.content_type == "image/jpeg"
    assert row.object_key.endswith(".jpg")
    assert media["url"] == f"/api/v1/media/{media['id']}/view"
    assert "object_key" not in media
    assert "D:\\" not in str(media)


def test_upload_png_and_webp_creates_ready_media(client, owner, db):
    for name, content, mime, extension in (
        ("clipboard.png", PNG, "image/png", ".png"),
        ("clipboard.webp", WEBP, "image/webp", ".webp"),
    ):
        response = client.post(
            "/api/v1/media/upload",
            headers=owner,
            files={"file": (name, content, mime)},
        )
        assert response.status_code == 201, response.text
        payload = response.json()["data"]
        media = db.get(MediaObject, uuid.UUID(payload["id"]))
        assert media is not None
        assert media.status == "READY"
        assert media.content_type == mime
        assert media.object_key.endswith(extension)
        assert payload["url"] == f"/api/v1/media/{payload['id']}/view"


def test_create_order_with_media_creates_attachment(client, owner, db):
    media = _upload(client, owner)
    r = _create(client, owner, db, media_ids=[media["id"]])
    assert r.status_code == 201, r.text
    order_id = r.json()["data"][0]["id"]
    links = db.scalars(select(OrderMedia).where(OrderMedia.order_id == uuid.UUID(order_id))).all()
    assert [str(x.media_id) for x in links] == [media["id"]]


def test_get_order_returns_media(client, owner, db):
    media = _upload(client, owner, name="zalo.jpg")
    order_id = _create(client, owner, db, media_ids=[media["id"]]).json()["data"][0]["id"]
    r = client.get(f"/api/v1/orders/{order_id}", headers=owner)
    assert r.status_code == 200
    images = r.json()["data"]["order"]["images"]
    assert len(images) == 1
    assert images[0]["id"] == media["id"]
    assert images[0]["original_name"] == "zalo.jpg"
    assert images[0]["url"] == f"/api/v1/media/{media['id']}/view"


def test_media_of_order_a_not_in_order_b(client, owner, db):
    a = _upload(client, owner, name="a.jpg")
    b = _upload(client, owner, name="b.jpg")
    order_a = _create(client, owner, db, media_ids=[a["id"]]).json()["data"][0]["id"]
    order_b = _create(client, owner, db, media_ids=[b["id"]]).json()["data"][0]["id"]
    imgs_a = client.get(f"/api/v1/orders/{order_a}", headers=owner).json()["data"]["order"]["images"]
    imgs_b = client.get(f"/api/v1/orders/{order_b}", headers=owner).json()["data"]["order"]["images"]
    assert [i["id"] for i in imgs_a] == [a["id"]]
    assert [i["id"] for i in imgs_b] == [b["id"]]


def test_order_with_multiple_images_returns_all(client, owner, db):
    ids = [_upload(client, owner, name=f"{n}.jpg")["id"] for n in range(3)]
    order_id = _create(client, owner, db, media_ids=ids).json()["data"][0]["id"]
    images = client.get(f"/api/v1/orders/{order_id}", headers=owner).json()["data"]["order"]["images"]
    assert sorted(i["id"] for i in images) == sorted(ids)


def test_two_warehouse_mode_attaches_same_media_to_both(client, owner, db):
    media = _upload(client, owner)
    r = _create(client, owner, db, media_ids=[media["id"]], mode="BOTH")
    assert r.status_code == 201, r.text
    orders = r.json()["data"]
    assert len(orders) == 2
    for o in orders:
        images = client.get(f"/api/v1/orders/{o['id']}", headers=owner).json()["data"]["order"]["images"]
        assert [i["id"] for i in images] == [media["id"]]
    # Không duplicate file vật lý: chỉ một media record cho cả hai order.
    assert db.scalar(select(func.count()).select_from(MediaObject)) == 1


def test_bulk_orders_keep_each_customers_images_isolated(client, owner, db):
    customers = list(db.scalars(select(Customer).order_by(Customer.id).limit(2)))
    image_a = _upload(client, owner, name="customer-a.jpg")
    image_b = _upload(client, owner, name="customer-b.jpg")
    response = client.post("/api/v1/orders/bulk", headers={
        **owner,
        "Idempotency-Key": uuid.uuid4().hex,
    }, json={
        "warehouse_mode": "BOTH",
        "created_date": "2026-10-10",
        "customers": [
            {"customer_id": str(customers[0].id), "media_ids": [image_a["id"]]},
            {"customer_id": str(customers[1].id), "media_ids": [image_b["id"]]},
        ],
    })
    assert response.status_code == 201, response.text
    rows = response.json()["data"]
    assert len(rows) == 4
    for customer, image in zip(customers, (image_a, image_b)):
        customer_orders = [row for row in rows if row["customer_id"] == str(customer.id)]
        assert len(customer_orders) == 2
        for row in customer_orders:
            detail = client.get(f"/api/v1/orders/{row['order_id']}", headers=owner)
            assert detail.status_code == 200
            assert [item["id"] for item in detail.json()["data"]["order"]["images"]] == [image["id"]]


def test_reload_still_reads_image(client, owner, db):
    media = _upload(client, owner)
    order_id = _create(client, owner, db, media_ids=[media["id"]]).json()["data"][0]["id"]
    db.expire_all()
    images = client.get(f"/api/v1/orders/{order_id}", headers=owner).json()["data"]["order"]["images"]
    assert len(images) == 1
    view = client.get(f"/api/v1/media/{media['id']}/view")
    assert view.status_code == 200
    assert view.headers["content-type"] == "image/jpeg"
    assert view.content == JPEG


def test_png_media_view_returns_content_type_and_bytes(client, owner):
    response = client.post(
        "/api/v1/media/upload",
        headers=owner,
        files={"file": ("paste.png", PNG, "image/png")},
    )
    media_id = response.json()["data"]["id"]
    view = client.get(f"/api/v1/media/{media_id}/view")
    assert view.status_code == 200
    assert view.headers["content-type"] == "image/png"
    assert view.content == PNG


def test_webp_media_view_returns_content_type_and_bytes(client, owner):
    response = client.post(
        "/api/v1/media/upload",
        headers=owner,
        files={"file": ("paste.webp", WEBP, "image/webp")},
    )
    assert response.status_code == 201, response.text
    media_id = response.json()["data"]["id"]
    view = client.get(f"/api/v1/media/{media_id}/view")
    assert view.status_code == 200
    assert view.headers["content-type"] == "image/webp"
    assert view.content == WEBP


def test_unknown_media_id_returns_not_found(client, owner):
    missing = uuid.uuid4()
    assert client.get(f"/api/v1/media/{missing}/view").status_code == 404


def test_create_order_with_unknown_media_fails(client, owner, db):
    r = _create(client, owner, db, media_ids=[str(uuid.uuid4())])
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "MEDIA_NOT_FOUND"
