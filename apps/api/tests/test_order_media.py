import uuid
from decimal import Decimal

from sqlalchemy import func, select

from app.core.config import settings
from app.models import Customer, MediaObject, Order, OrderMedia, Warehouse
from app.services.storage import LegacyS3StorageService, R2StorageService, StoredObject


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
    assert row.object_key.startswith("private-media/general/")
    assert row.object_key.endswith(f"/{media['id']}.jpg")
    assert row.storage_provider == "local"
    assert row.checksum == row.sha256
    assert media["url"] == f"/api/v1/media/{media['id']}/view"
    assert media["view_url"] == media["url"]
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
    view = client.get(f"/api/v1/media/{media['id']}/view", headers=owner)
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
    view = client.get(f"/api/v1/media/{media_id}/view", headers=owner)
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
    view = client.get(f"/api/v1/media/{media_id}/view", headers=owner)
    assert view.status_code == 200
    assert view.headers["content-type"] == "image/webp"
    assert view.content == WEBP


def test_unknown_media_id_returns_not_found(client, owner):
    missing = uuid.uuid4()
    assert client.get(f"/api/v1/media/{missing}/view", headers=owner).status_code == 404


def test_create_order_with_unknown_media_fails(client, owner, db):
    r = _create(client, owner, db, media_ids=[str(uuid.uuid4())])
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "MEDIA_NOT_FOUND"


def test_r2_upload_and_view_use_private_signed_url(client, owner, db, monkeypatch):
    class MockR2Storage(R2StorageService):
        def __init__(self):
            pass

        def put(self, *, object_key, data, content_type):
            assert object_key.startswith("private-media/general/")
            return StoredObject(storage_provider="r2", bucket="azalas-private", version_id="v1")

        def read(self, *, bucket, object_key):
            raise AssertionError("R2 view should redirect to a signed URL")

        def signed_url(self, *, bucket, object_key):
            assert bucket == "azalas-private"
            assert object_key.startswith("private-media/general/")
            return "https://r2.example.test/signed-object"

    monkeypatch.setattr("app.routers.media.get_storage_service", lambda driver=None: MockR2Storage())
    monkeypatch.setattr(settings, "storage_driver", "r2")
    media_payload = _upload(client, owner)
    media = db.get(MediaObject, uuid.UUID(media_payload["id"]))
    assert media is not None
    assert media.storage_provider == "r2"
    assert media.bucket == "azalas-private"
    assert media.object_key.startswith("private-media/general/")
    assert media.checksum == media.sha256

    response = client.get(
        media_payload["view_url"],
        headers=owner,
        follow_redirects=False,
    )
    assert response.status_code == 307
    assert response.headers["location"] == "https://r2.example.test/signed-object"


def test_legacy_s3_media_still_uses_its_existing_storage(client, owner, db, monkeypatch):
    class MockLegacyS3Storage(LegacyS3StorageService):
        def __init__(self):
            pass

        def put(self, *, object_key, data, content_type):
            raise AssertionError("Legacy S3 is read-only")

        def read(self, *, bucket, object_key):
            raise AssertionError("Legacy S3 view should redirect to a signed URL")

        def signed_url(self, *, bucket, object_key):
            assert bucket == "legacy-bucket"
            assert object_key
            return "https://s3.example.test/legacy-signed-object"

    media_payload = _upload(client, owner)
    media = db.get(MediaObject, uuid.UUID(media_payload["id"]))
    assert media is not None
    media.storage = "S3"
    media.storage_provider = "s3"
    media.bucket = "legacy-bucket"
    db.commit()
    monkeypatch.setattr("app.routers.media.get_storage_service", lambda driver=None: MockLegacyS3Storage())

    response = client.get(media_payload["view_url"], headers=owner, follow_redirects=False)

    assert response.status_code == 307
    assert response.headers["location"] == "https://s3.example.test/legacy-signed-object"


def test_media_view_requires_permission_for_unattached_upload(client, owner, picker):
    media = _upload(client, owner)
    response = client.get(f"/api/v1/media/{media['id']}/view", headers=picker)
    assert response.status_code == 403


def test_media_uploader_does_not_bypass_attached_module_permission(client, owner, picker, db, monkeypatch):
    media = _upload(client, picker)
    order = _create(client, owner, db, media_ids=[media["id"]])
    assert order.status_code == 201, order.text
    monkeypatch.setattr("app.routers.media.has_permission", lambda *args: False)

    response = client.get(f"/api/v1/media/{media['id']}/view", headers=picker)

    assert response.status_code == 403


def test_media_view_requires_authentication(client, owner):
    media = _upload(client, owner)
    response = client.get(f"/api/v1/media/{media['id']}/view")
    assert response.status_code == 401


def test_upload_rejects_file_larger_than_configured_limit(client, owner):
    data = b"\xff\xd8\xff" + b"\x00" * settings.max_upload_bytes
    response = client.post(
        "/api/v1/media/upload",
        headers=owner,
        files={"file": ("large.jpg", data, "image/jpeg")},
    )
    assert response.status_code == 413


def test_upload_rejects_mismatched_content_type(client, owner):
    response = client.post(
        "/api/v1/media/upload",
        headers=owner,
        files={"file": ("wrong.png", JPEG, "image/png")},
    )
    assert response.status_code == 415


def test_gallery_api_includes_view_url_for_r2_media(client, owner, db, monkeypatch):
    class MockR2Storage(R2StorageService):
        def __init__(self):
            pass

        def put(self, *, object_key, data, content_type):
            return StoredObject(storage_provider="r2", bucket="azalas-private")

        def read(self, *, bucket, object_key):
            raise AssertionError("Not used by this test")

        def signed_url(self, *, bucket, object_key):
            return "https://r2.example.test/signed-object"

    monkeypatch.setattr("app.routers.media.get_storage_service", lambda driver=None: MockR2Storage())
    media = _upload(client, owner)
    response = _create(client, owner, db, media_ids=[media["id"]])
    assert response.status_code == 201, response.text

    gallery = client.get("/api/v1/media/customer-order-gallery", headers=owner)
    assert gallery.status_code == 200, gallery.text
    image = next(
        image
        for group in gallery.json()["data"]
        for order in group["orders"]
        for image in order["images"]
        if image["id"] == media["id"]
    )
    assert image["view_url"] == media["view_url"]
