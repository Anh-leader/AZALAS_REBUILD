"""Tests cho R2 media reorganize: classify, build key, dry-run, apply, verify, cleanup."""
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import text

from scripts.migration.reorganize_r2_media.classifier import classify, build_plan
from scripts.migration.reorganize_r2_media.runner import (
    apply as run_apply,
    build_dry_run,
    cleanup_old,
    verify,
)

VN = ZoneInfo("Asia/Ho_Chi_Minh")


class FakeStorage:
    """In-memory R2 stand-in; never touches real object storage."""

    def __init__(self, objects=None):
        self.objects = objects or {}  # key -> {"size": int, "meta": dict}

    def exists(self, *, bucket, object_key):
        return object_key in self.objects

    def head_object(self, *, object_key):
        if object_key in self.objects:
            obj = self.objects[object_key]
            return {"ContentLength": obj["size"], "Metadata": obj["meta"]}
        return None

    def copy_object(self, *, source_key, dest_key, metadata=None):
        if source_key not in self.objects:
            raise RuntimeError("missing source")
        src = self.objects[source_key]
        self.objects[dest_key] = {"size": src["size"], "meta": dict(metadata or src["meta"])}
        return {}

    def _client(self):
        return self

    def delete_object(self, Bucket, Key):
        self.objects.pop(Key, None)


def _mk_uuid():
    return str(uuid.uuid4())


def _insert_media(db, object_key="legacy-media/2026/10/old.png", content_type="image/png", size=100):
    mid = _mk_uuid()
    db.execute(text("""
        INSERT INTO media_objects (id, object_key, storage_provider, storage, content_type,
                                   size_bytes, checksum, sha256, status)
        VALUES (:id, :k, 'r2', 'S3', :ct, :size, :cs, :cs, 'READY')
    """), {"id": mid, "k": object_key, "ct": content_type, "size": size, "cs": "0" * 64})
    db.commit()
    return mid


def _insert_customer(db, name="TEST"):
    cid = _mk_uuid()
    db.execute(text("INSERT INTO customers (id, customer_code, name, status) VALUES (:id, :cc, :n, 'ACTIVE')"),
               {"id": cid, "cc": f"C-{cid[:6]}", "n": name})
    db.commit()
    return cid


def _insert_warehouse(db, code="TX", name="Tân Xuân"):
    wid = _mk_uuid()
    db.execute(text("INSERT INTO warehouses (id, code, name, sort_order, active) VALUES (:id, :c, :n, 1, true)"),
               {"id": wid, "c": code, "n": name})
    db.commit()
    return wid


def _insert_order(db, customer_id, warehouse_id, order_no="HD-001", created_at=None):
    oid = _mk_uuid()
    db.execute(text("""
        INSERT INTO orders (id, order_no, customer_id, warehouse_id, order_type, created_date,
                            status, billing_status, source_channel, is_urgent, total_amount,
                            paid_amount, invoice_balance_amount, version, created_at)
        VALUES (:id, :no, :cid, :wid, 'NORMAL', :d, 'NEW', 'DRAFT', 'ZALO', false, 0, 0, 0, 1, :cat)
    """), {"id": oid, "no": order_no, "cid": customer_id, "wid": warehouse_id,
           "d": "2026-10-20", "cat": created_at or datetime(2026, 10, 20, 12, 0, tzinfo=VN)})
    db.commit()
    return oid


def _link_order_media(db, order_id, media_id):
    db.execute(text("INSERT INTO order_media (order_id, media_id) VALUES (:o, :m)"),
               {"o": order_id, "m": media_id})
    db.commit()


def _insert_order_group(db, customer_id, group_no="GRP-1"):
    gid = _mk_uuid()
    db.execute(text("INSERT INTO order_groups (id, group_no, customer_id) VALUES (:id, :no, :cid)"),
               {"id": gid, "no": group_no, "cid": customer_id})
    db.commit()
    return gid


def _insert_order_with_group(db, customer_id, warehouse_id, order_no, group_id):
    oid = _mk_uuid()
    db.execute(text("""
        INSERT INTO orders (id, order_no, customer_id, warehouse_id, order_type, created_date,
                            status, billing_status, source_channel, is_urgent, total_amount,
                            paid_amount, invoice_balance_amount, version, order_group_id, created_at)
        VALUES (:id, :no, :cid, :wid, 'NORMAL', :d, 'NEW', 'DRAFT', 'ZALO', false, 0, 0, 0, 1, :gid, :cat)
    """), {"id": oid, "no": order_no, "cid": customer_id, "wid": warehouse_id,
           "d": "2026-10-20", "gid": group_id,
           "cat": datetime(2026, 10, 20, 12, 0, tzinfo=VN)})
    db.commit()
    return oid


def _insert_invoice(db, customer_id, media_id=None, invoice_no="INV-001"):
    iid = _mk_uuid()
    db.execute(text("""
        INSERT INTO invoices (id, invoice_no, customer_id, status, issued_at,
                              subtotal_amount, surcharge_amount, return_credit_amount,
                              paid_amount, balance_amount, debt_before_amount, debt_after_amount,
                              template_version, snapshot, captured_invoice_media_id, version, idempotency_key)
        VALUES (:id, :no, :cid, 'SENT', :ts, 0,0,0,0,0,0,0, '1', '{}', :mid, 1, :ik)
    """), {"id": iid, "no": invoice_no, "cid": customer_id, "ts": datetime(2026, 10, 20, 10, 0, tzinfo=VN),
           "mid": media_id, "ik": _mk_uuid()})
    db.commit()
    return iid


def test_order_media_classifies_and_builds_key(db):
    cid = _insert_customer(db)
    wid = _insert_warehouse(db)
    mid = _insert_media(db)
    oid = _insert_order(db, cid, wid, order_no="HD 001/X")
    _link_order_media(db, oid, mid)

    records = classify(db)
    rec = records[uuid.UUID(mid)]
    assert rec.category == "order"
    assert rec.business_code == "HD 001/X"

    plan = build_plan(records)[0]
    assert plan.new_key.startswith("orders/2026/10/20/HD-001-X/")
    assert plan.new_key.endswith(".png")
    assert plan.thumbnail_new_key == plan.new_key + ".thumb.webp"


def test_invoice_wins_over_order_and_reports_conflict(db):
    cid = _insert_customer(db)
    wid = _insert_warehouse(db)
    mid = _insert_media(db)
    oid = _insert_order(db, cid, wid)
    _link_order_media(db, oid, mid)
    _insert_invoice(db, cid, media_id=mid, invoice_no="INV-999")

    records = classify(db)
    rec = records[uuid.UUID(mid)]
    assert rec.category == "invoice"
    assert rec.business_code == "INV-999"
    assert any(c["category"] == "order" for c in rec.conflicts)


def test_shared_orders_collapse_to_order_shared(db):
    cid = _insert_customer(db)
    wid = _insert_warehouse(db)
    mid = _insert_media(db)
    group_id = _insert_order_group(db, cid, group_no="GRP-SHARED")
    o_tx = _insert_order_with_group(db, cid, wid, "GRP-SHARED-TX", group_id)
    o_ck = _insert_order_with_group(db, cid, wid, "GRP-SHARED-CK", group_id)
    _link_order_media(db, o_tx, mid)
    _link_order_media(db, o_ck, mid)

    records = classify(db)
    rec = records[uuid.UUID(mid)]
    assert rec.category == "order_shared"
    assert rec.business_code == "GRP-SHARED"
    assert rec.conflicts == []  # no conflict after resolving shared group

    plan = build_plan(records)[0]
    assert plan.new_key.startswith("orders-shared/2026/10/20/GRP-SHARED/")
    assert plan.new_key.endswith(".png")


def test_shared_orders_different_groups_stay_unresolved(db):
    cid = _insert_customer(db)
    wid = _insert_warehouse(db)
    mid = _insert_media(db)
    g1 = _insert_order_group(db, cid, group_no="GRP-A")
    g2 = _insert_order_group(db, cid, group_no="GRP-B")
    _link_order_media(db, _insert_order_with_group(db, cid, wid, "A-1", g1), mid)
    _link_order_media(db, _insert_order_with_group(db, cid, wid, "B-1", g2), mid)

    records = classify(db)
    rec = records[uuid.UUID(mid)]
    assert rec.category == "order"
    assert rec.unresolved is True
    assert rec.conflicts != []

    plan = build_plan(records)[0]
    assert plan.plan_status == "conflict_unresolved"


def test_unmapped_media_goes_other(db):
    mid = _insert_media(db, object_key="legacy-media/2026/10/orphan.png")
    records = classify(db)
    rec = records[uuid.UUID(mid)]
    assert rec.category == "other"
    assert rec.business_code is None
    plan = build_plan(records)[0]
    assert plan.new_key.startswith("other/2026/10/")
    assert plan.new_key.endswith(f"{mid}.png")


def test_partner_and_pattern_classification(db):
    mid_p = _insert_media(db, object_key="legacy-media/2026/10/p.png")
    note_id = _mk_uuid()
    db.execute(text("""
        INSERT INTO pattern_notes (id, note_no, title, content, client_token, media_ids)
        VALUES (:id, 'RAPNOTE-1', 't', 'c', :ct, :mids)
    """), {"id": note_id, "ct": _mk_uuid(), "mids": f'["{mid_p}"]'})
    db.commit()

    partner_id = _mk_uuid()
    db.execute(text("INSERT INTO partners (id, partner_code, name, partner_type, status) VALUES (:id, 'PART-1', 'P', 'SUPPLIER', 'ACTIVE')"),
               {"id": partner_id})
    mid_f = _insert_media(db, object_key="legacy-media/2026/10/f.png")
    db.execute(text("INSERT INTO partner_files (id, partner_id, media_id, purpose) VALUES (:id, :pid, :mid, 'INVOICE')"),
               {"id": _mk_uuid(), "pid": partner_id, "mid": mid_f})
    db.commit()

    records = classify(db)
    assert records[uuid.UUID(mid_p)].category == "pattern"
    assert records[uuid.UUID(mid_p)].business_code == "RAPNOTE-1"
    assert records[uuid.UUID(mid_f)].category == "partner"
    assert records[uuid.UUID(mid_f)].business_code == "PART-1"


def test_timezone_vn_near_midnight():
    # UTC 17:30 on Oct 20 == VN 00:30 on Oct 21 -> folder must be 2026/10/21.
    from app.services.storage import build_media_object_key
    from scripts.migration.reorganize_r2_media.classifier import _to_vn

    local = _to_vn(datetime(2026, 10, 20, 17, 30, tzinfo=ZoneInfo("UTC")))
    assert local is not None
    assert (local.year, local.month, local.day) == (2026, 10, 21)

    key = build_media_object_key(
        category="orders", business_code="HD-TZ", media_id="abc",
        extension="png", created_at=datetime(2026, 10, 20, 17, 30, tzinfo=ZoneInfo("UTC")),
    )
    assert key.startswith("orders/2026/10/21/HD-TZ/")


def test_dry_run_counts_without_probe(db):
    cid = _insert_customer(db)
    wid = _insert_warehouse(db)
    mid = _insert_media(db)
    _link_order_media(db, _insert_order(db, cid, wid), mid)
    # an already-new-structure media
    _insert_media(db, object_key="orders/2026/10/20/HD-X/new.png")

    result = build_dry_run(db, FakeStorage(), probe=False)
    assert result.total_media >= 2
    assert result.will_copy >= 1
    assert result.already_new_structure >= 1
    assert result.orders_count >= 1
    assert result.legacy_media_count >= 1


def test_apply_copies_verifies_and_updates_db(db):
    cid = _insert_customer(db)
    wid = _insert_warehouse(db)
    mid = _insert_media(db, object_key="legacy-media/2026/10/a.png", size=100)
    _link_order_media(db, _insert_order(db, cid, wid, order_no="HD-A"), mid)

    storage = FakeStorage({"legacy-media/2026/10/a.png": {"size": 100, "meta": {}}})
    result = run_apply(db, storage, batch_size=50)
    assert result.copied == 1
    assert result.failed == 0

    new_key = db.execute(text("SELECT object_key FROM media_objects WHERE id = :mid"), {"mid": mid}).scalar()
    assert new_key.startswith("orders/")
    assert new_key in storage.objects


def test_apply_fails_without_db_update_when_source_missing(db):
    cid = _insert_customer(db)
    wid = _insert_warehouse(db)
    mid = _insert_media(db, object_key="legacy-media/2026/10/missing.png")
    _link_order_media(db, _insert_order(db, cid, wid, order_no="HD-M"), mid)

    storage = FakeStorage({})  # empty: source missing
    result = run_apply(db, storage, batch_size=50)
    assert result.failed == 1
    assert result.copied == 0
    # DB key unchanged
    assert db.execute(text("SELECT object_key FROM media_objects WHERE id = :mid"), {"mid": mid}).scalar() == "legacy-media/2026/10/missing.png"


def test_apply_idempotent_skip_already_new(db):
    cid = _insert_customer(db)
    wid = _insert_warehouse(db)
    mid = _insert_media(db, object_key="orders/2026/10/20/HD-Y/already.png")
    _link_order_media(db, _insert_order(db, cid, wid, order_no="HD-Y"), mid)

    storage = FakeStorage({"orders/2026/10/20/HD-Y/already.png": {"size": 100, "meta": {}}})
    result = run_apply(db, storage, batch_size=50)
    assert result.copied == 0
    assert result.failed == 0


def test_verify_reports_missing_and_size_mismatch(db):
    cid = _insert_customer(db)
    wid = _insert_warehouse(db)
    ok_mid = _insert_media(db, object_key="orders/2026/10/20/HD-Z/ok.png", size=100)
    _link_order_media(db, _insert_order(db, cid, wid, order_no="HD-Z"), ok_mid)
    bad_mid = _insert_media(db, object_key="orders/2026/10/20/HD-Z/bad.png", size=999)

    storage = FakeStorage({
        "orders/2026/10/20/HD-Z/ok.png": {"size": 100, "meta": {"sha256": "0" * 64}},
        # bad.png intentionally absent
    })
    result = verify(db, storage)
    assert result.missing_on_r2 == 1
    assert result.ok is False


def test_cleanup_only_deletes_when_db_points_new_and_verified(db):
    cid = _insert_customer(db)
    wid = _insert_warehouse(db)
    mid = _insert_media(db, object_key="orders/2026/10/20/HD-C/new.png")
    _link_order_media(db, _insert_order(db, cid, wid, order_no="HD-C"), mid)

    storage = FakeStorage({
        "orders/2026/10/20/HD-C/new.png": {"size": 100, "meta": {}},
        "legacy-media/2026/10/old.png": {"size": 100, "meta": {}},
    })
    mapping = [{"media_id": mid, "old_key": "legacy-media/2026/10/old.png",
                "new_key": "orders/2026/10/20/HD-C/new.png", "size_bytes": 100}]

    # DB already points to new key -> eligible for cleanup dry-run
    res = cleanup_old(db, storage, mapping, dry_run=True)
    assert res.would_delete == 1
    assert "legacy-media/2026/10/old.png" in storage.objects  # dry-run does not delete

    # Non-dry-run deletes only the old key, keeps the new one.
    res2 = cleanup_old(db, storage, mapping, dry_run=False)
    assert res2.deleted == 1
    assert "legacy-media/2026/10/old.png" not in storage.objects
    assert "orders/2026/10/20/HD-C/new.png" in storage.objects
