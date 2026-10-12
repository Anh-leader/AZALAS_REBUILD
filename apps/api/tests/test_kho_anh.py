import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select

from app.models import Customer, MediaObject, Order, OrderMedia, User, Warehouse

TZ = ZoneInfo("Asia/Ho_Chi_Minh")
TODAY = datetime.now(TZ).date()

JPEG = b"\xff\xd8\xff" + b"\x00" * 200


def _upload(client, auth, name="zalo.jpg", data=JPEG):
    r = client.post("/api/v1/media/upload", headers=auth, files={"file": (name, data, "image/jpeg")})
    assert r.status_code == 201, r.text
    return r.json()["data"]


def _customer(db):
    return db.scalar(select(Customer).order_by(Customer.id))


def _create(client, auth, db, media_ids, created_date=None, mode="TAN_XUAN"):
    r = client.post("/api/v1/orders", headers={**auth, "Idempotency-Key": uuid.uuid4().hex}, json={
        "customer_id": str(_customer(db).id), "warehouse_mode": mode,
        "created_date": created_date or TODAY.isoformat(), "delivery_date": None,
        "is_urgent": False, "customer_note": None, "media_ids": [str(m) for m in media_ids],
    })
    assert r.status_code == 201, r.text
    return r.json()["data"]


def _recent(client, auth, **params):
    return client.get("/api/v1/media/recent", headers=auth, params=params)


def _gallery(client, auth, **params):
    return client.get("/api/v1/media/customer-order-gallery", headers=auth, params=params)


def _images_ids(response):
    out = []
    for group in response.json()["data"]:
        for img in group["images"]:
            out.append(img["id"])
    return out


def test_order_with_one_ready_image_is_returned(client, owner, db):
    media = _upload(client, owner)
    _create(client, owner, db, [media["id"]])
    r = _recent(client, owner)
    assert r.status_code == 200
    assert _images_ids(r) == [media["id"]]


def test_order_with_three_images_returns_all(client, owner, db):
    ids = [_upload(client, owner, name=f"{n}.jpg")["id"] for n in range(3)]
    _create(client, owner, db, ids)
    r = _recent(client, owner)
    assert sorted(_images_ids(r)) == sorted(ids)


def test_pending_media_is_excluded(client, owner, db):
    media = _upload(client, owner)
    db.get(MediaObject, uuid.UUID(media["id"])).status = "PENDING"
    db.commit()
    _create(client, owner, db, [media["id"]])
    assert _images_ids(_recent(client, owner)) == []


def test_deleted_media_is_excluded(client, owner, db):
    media = _upload(client, owner)
    db.get(MediaObject, uuid.UUID(media["id"])).status = "DELETED"
    db.commit()
    _create(client, owner, db, [media["id"]])
    assert _images_ids(_recent(client, owner)) == []


def test_image_older_than_10_days_is_excluded(client, owner, db):
    media = _upload(client, owner)
    _create(client, owner, db, [media["id"]], created_date=(TODAY - timedelta(days=12)).isoformat())
    assert _images_ids(_recent(client, owner)) == []


def _make_dated(client, owner, db, days_ago, name):
    media = _upload(client, owner, name=name)
    _create(client, owner, db, [media["id"]], created_date=(TODAY - timedelta(days=days_ago)).isoformat())
    return media["id"]


def test_sort_desc_puts_newest_first(client, owner, db):
    _make_dated(client, owner, db, 5, "old.jpg")
    _make_dated(client, owner, db, 0, "new.jpg")
    _make_dated(client, owner, db, 2, "mid.jpg")
    dates = [g["date_iso"] for g in _recent(client, owner, sort="desc").json()["data"]]
    assert dates == sorted(dates, reverse=True)


def test_sort_asc_puts_oldest_first(client, owner, db):
    _make_dated(client, owner, db, 5, "old.jpg")
    _make_dated(client, owner, db, 0, "new.jpg")
    _make_dated(client, owner, db, 2, "mid.jpg")
    dates = [g["date_iso"] for g in _recent(client, owner, sort="asc").json()["data"]]
    assert dates == sorted(dates)


def test_shared_media_between_two_orders_is_deduplicated(client, owner, db):
    media = _upload(client, owner)
    created = _create(client, owner, db, [media["id"]], mode="BOTH")
    assert len(created) == 2
    links = db.scalars(select(OrderMedia).where(OrderMedia.media_id == uuid.UUID(media["id"]))).all()
    assert len(links) == 2
    assert _images_ids(_recent(client, owner)) == [media["id"]]


def test_customer_order_gallery_groups_children_and_deduplicates_images(client, owner, db):
    media_ids = [_upload(client, owner, name=f"gallery-{n}.jpg")["id"] for n in range(2)]
    children = _create(client, owner, db, media_ids, mode="BOTH")

    response = _gallery(client, owner)
    assert response.status_code == 200, response.text
    payload = response.json()
    cards = [order for day in payload["data"] for order in day["orders"]]
    assert len(cards) == 1
    assert len(cards[0]["order_ids"]) == 2
    assert cards[0]["image_count"] == 2
    assert sorted(image["id"] for image in cards[0]["images"]) == sorted(media_ids)
    assert cards[0]["status"] == "NOT_PICKED"
    assert cards[0]["created_by_names"]
    assert all(image["uploaded_by_name"] for image in cards[0]["images"])
    assert payload["meta"]["summary"] == {"orders_with_images": 1, "total_images": 2}
    assert {order["id"] for order in children} == set(cards[0]["order_ids"])


def test_customer_order_gallery_filters_search_date_and_status(client, owner, db):
    media_id = _upload(client, owner)["id"]
    order = _create(client, owner, db, [media_id])[0]
    customer = db.get(Customer, order["customer_id"])
    customer.name = "Khách hàng Ánh Dương"
    customer.customer_code = "KH-ANH-DUONG"
    order_row = db.get(Order, order["id"])
    order_row.customer_note = "Ghi chú đặt hàng đặc biệt"
    order_row.status = "PICKING"
    creator_name = db.scalar(select(User.display_name).where(User.username == "owner"))
    db.commit()

    by_customer = _gallery(client, owner, q="anh duong")
    assert by_customer.status_code == 200
    assert by_customer.json()["meta"]["summary"]["orders_with_images"] == 1
    assert _gallery(client, owner, q=order["order_no"]).json()["meta"]["summary"]["orders_with_images"] == 1
    assert _gallery(client, owner, q="ghi chu dat hang").json()["meta"]["summary"]["total_images"] == 1
    assert _gallery(client, owner, q=creator_name).json()["meta"]["summary"]["orders_with_images"] == 1
    assert _gallery(client, owner, date=TODAY.isoformat()).json()["meta"]["summary"]["total_images"] == 1
    assert _gallery(client, owner, date=(TODAY - timedelta(days=1)).isoformat()).json()["data"] == []
    assert _gallery(client, owner, status="PICKING").json()["meta"]["summary"]["orders_with_images"] == 1
    assert _gallery(client, owner, status="NOT_PICKED").json()["data"] == []


def test_customer_order_gallery_sorts_by_created_timestamp(client, owner, db):
    older_media = _upload(client, owner, name="older-order.jpg")
    newer_media = _upload(client, owner, name="newer-order.jpg")
    older_order = _create(client, owner, db, [older_media["id"]])[0]
    newer_order = _create(client, owner, db, [newer_media["id"]])[0]
    db.get(Order, older_order["id"]).created_at = datetime(2026, 10, 10, 10, tzinfo=TZ)
    db.get(Order, newer_order["id"]).created_at = datetime(2026, 10, 12, 10, tzinfo=TZ)
    db.commit()

    newest_first = _gallery(client, owner, sort="created_desc").json()["data"]
    oldest_first = _gallery(client, owner, sort="created_asc").json()["data"]
    newest_ids = [order["order_id"] for day in newest_first for order in day["orders"]]
    oldest_ids = [order["order_id"] for day in oldest_first for order in day["orders"]]
    assert newest_ids.index(newer_order["id"]) < newest_ids.index(older_order["id"])
    assert oldest_ids.index(older_order["id"]) < oldest_ids.index(newer_order["id"])


def test_customer_order_gallery_excludes_unavailable_media_and_deleted_orders(client, owner, db):
    pending = _upload(client, owner, name="pending-gallery.jpg")
    deleted = _upload(client, owner, name="deleted-gallery.jpg")
    attached_to_deleted_order = _upload(client, owner, name="cancelled-gallery.jpg")
    db.get(MediaObject, uuid.UUID(pending["id"])).status = "PENDING"
    db.get(MediaObject, uuid.UUID(deleted["id"])).status = "DELETED"
    db.commit()
    _create(client, owner, db, [pending["id"], deleted["id"]])
    cancelled_order = _create(client, owner, db, [attached_to_deleted_order["id"]])[0]
    db.get(Order, cancelled_order["id"]).status = "DELETED"
    db.commit()

    response = _gallery(client, owner)
    assert response.status_code == 200
    assert response.json()["data"] == []
    assert response.json()["meta"]["summary"] == {"orders_with_images": 0, "total_images": 0}


def test_forbidden_role_gets_403(client, owner, db):
    username = f"hr_{uuid.uuid4().hex[:8]}"
    r = client.post("/api/v1/users", headers=owner, json={
        "username": username, "password": "safe-pass-123", "display_name": "Nhân sự",
        "phone": None, "role_codes": ["NHAN_SU"],
    })
    assert r.status_code == 201, r.text
    login = client.post("/api/v1/auth/login", json={"username": username, "password": "safe-pass-123"})
    assert login.status_code == 200, login.text
    auth = {"Authorization": f"Bearer {login.json()['data']['access_token']}"}
    assert _recent(client, auth).status_code == 403
    assert _gallery(client, auth).status_code == 403


def test_no_images_returns_empty_list(client, owner):
    r = _recent(client, owner)
    assert r.status_code == 200
    assert r.json()["data"] == []
    assert r.json()["meta"]["total"] == 0
