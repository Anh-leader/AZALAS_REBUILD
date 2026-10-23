"""Unit tests cho invoice-image migration (không ghi production, không cần DB live).

Chỉ test logic thuần (deterministic UUID, object key, classify/mapping/metrics)
bằng cách monkeypatch các method truy cập DB/network.
"""
from __future__ import annotations

import uuid

import pytest

from scripts.migration.invoice_images.config import Config
from scripts.migration.invoice_images.runner import (
    InvoiceImageMigrator,
    PlanItem,
    _date_path,
    _deterministic_media_uuid,
    _ext_from_mime,
)


def _make_config() -> Config:
    return Config(
        new_database_url="sqlite://",
        old_database_url="sqlite://",
        legacy_supabase_project_ref="ztpysvksgaaskjoevlnb",
        legacy_supabase_bucket="az-invoice-images",
        r2_bucket="azalas-prod-media",
    )


def _make_item(**overrides) -> PlanItem:
    base = dict(
        old_invoice_id="1",
        invoice_code="111020260001",
        image_path="uuid/1/file.png",
        status="DA_GUI",
        finalized_at="2026-10-12T11:06:12.000Z",
        created_at="2026-10-12T11:06:12.000Z",
        source_exists=True,
        source_size=227775,
        source_mimetype="image/png",
        source_md5="20eade78ac251521c5ead3a68a21d4bd",
        source_http_ok=True,
        new_invoice_id="11111111-1111-1111-1111-111111111111",
        new_invoice_no="111020260001",
        new_customer_id="22222222-2222-2222-2222-222222222222",
        new_order_ids=["33333333-3333-3333-3333-333333333333"],
        has_existing_media=False,
        media_uuid=_deterministic_media_uuid("1", "uuid/1/file.png"),
        ext="png",
        object_key="legacy-media/2026/10/uuid.png",
        already_on_r2=False,
    )
    base.update(overrides)
    return PlanItem(**base)


# --------------------------------------------------------------------------- pure helpers
def test_deterministic_media_uuid_is_stable():
    a = _deterministic_media_uuid("27", "path/27/x.png")
    b = _deterministic_media_uuid("27", "path/27/x.png")
    assert a == b
    assert uuid.UUID(a)  # valid uuid


def test_deterministic_media_uuid_differs_per_invoice_and_path():
    a = _deterministic_media_uuid("27", "path/27/x.png")
    b = _deterministic_media_uuid("28", "path/27/x.png")
    c = _deterministic_media_uuid("27", "path/27/y.png")
    assert a != b
    assert a != c


def test_ext_from_mime():
    assert _ext_from_mime("image/png") == "png"
    assert _ext_from_mime("image/jpeg") == "jpg"
    assert _ext_from_mime("image/webp") == "webp"
    assert _ext_from_mime(None) == "png"


def test_date_path():
    assert _date_path("2026-10-12T11:06:12.000Z") == ("2026", "10")
    assert _date_path("2026-01-05T00:00:00Z") == ("2026", "01")


# --------------------------------------------------------------------------- plan
def test_build_plan_maps_legacy_to_new(monkeypatch):
    migrator = InvoiceImageMigrator(_make_config())
    monkeypatch.setattr(migrator, "_old_invoices_with_image", lambda: [{
        "id": 1, "invoice_code": "111020260001", "status": "DA_GUI",
        "invoice_image_path": "uuid/1/file.png",
        "finalized_at": "2026-10-12T11:06:12.000Z",
        "created_at": "2026-10-12T11:06:12.000Z",
        "_storage": {"name": "uuid/1/file.png",
                     "metadata": {"size": 227775, "mimetype": "image/png",
                                  "eTag": '"20eade78ac251521c5ead3a68a21d4bd"',
                                  "httpStatusCode": 200}},
    }])
    monkeypatch.setattr(migrator, "_legacy_invoice_map", lambda: {"1": "11111111-1111-1111-1111-111111111111"})
    monkeypatch.setattr(migrator, "_new_invoices", lambda: {
        "11111111-1111-1111-1111-111111111111": {
            "id": "11111111-1111-1111-1111-111111111111",
            "invoice_no": "111020260001",
            "customer_id": "22222222-2222-2222-2222-222222222222",
            "captured_invoice_media_id": None,
        }})
    monkeypatch.setattr(migrator, "_new_invoice_orders", lambda: {
        "11111111-1111-1111-1111-111111111111": ["33333333-3333-3333-3333-333333333333"]})

    items = migrator.build_plan()
    assert len(items) == 1
    it = items[0]
    assert it.new_invoice_id == "11111111-1111-1111-1111-111111111111"
    assert it.source_exists is True
    assert it.source_size == 227775
    assert it.source_md5 == "20eade78ac251521c5ead3a68a21d4bd"
    assert it.ext == "png"
    assert it.object_key.startswith("legacy-media/2026/10/")
    assert it.object_key.endswith(".png")


def test_build_plan_fallback_by_invoice_no_when_mapping_missing(monkeypatch):
    migrator = InvoiceImageMigrator(_make_config())
    monkeypatch.setattr(migrator, "_old_invoices_with_image", lambda: [{
        "id": 1, "invoice_code": "111020260001", "status": "DA_GUI",
        "invoice_image_path": "uuid/1/file.png",
        "finalized_at": "2026-10-12T11:06:12.000Z", "created_at": None,
        "_storage": {"metadata": {"size": 10, "mimetype": "image/png", "httpStatusCode": 200}},
    }])
    monkeypatch.setattr(migrator, "_legacy_invoice_map", lambda: {})  # không có mapping
    monkeypatch.setattr(migrator, "_new_invoices", lambda: {
        "99999999-9999-9999-9999-999999999999": {
            "id": "99999999-9999-9999-9999-999999999999",
            "invoice_no": "111020260001", "customer_id": "cccc", "captured_invoice_media_id": None}})
    monkeypatch.setattr(migrator, "_new_invoice_orders", lambda: {})

    items = migrator.build_plan()
    assert items[0].new_invoice_id == "99999999-9999-9999-9999-999999999999"


def test_build_plan_unmapped_when_no_mapping_and_no_fallback(monkeypatch):
    migrator = InvoiceImageMigrator(_make_config())
    monkeypatch.setattr(migrator, "_old_invoices_with_image", lambda: [{
        "id": 1, "invoice_code": "111020260001", "status": "DA_GUI",
        "invoice_image_path": "uuid/1/file.png",
        "finalized_at": None, "created_at": None,
        "_storage": {"metadata": {"size": 10, "mimetype": "image/png"}},
    }])
    monkeypatch.setattr(migrator, "_legacy_invoice_map", lambda: {})
    monkeypatch.setattr(migrator, "_new_invoices", lambda: {})
    monkeypatch.setattr(migrator, "_new_invoice_orders", lambda: {})

    items = migrator.build_plan()
    assert items[0].new_invoice_id is None


# --------------------------------------------------------------------------- dry_run metrics
def test_dry_run_metrics_clean(monkeypatch):
    migrator = InvoiceImageMigrator(_make_config())
    items = [_make_item()]
    monkeypatch.setattr(migrator, "build_plan", lambda: items)
    result = migrator.dry_run(probe_r2=False)

    assert result["old_invoices_with_image"] == 1
    assert result["new_invoice_matches"] == 1
    assert result["source_downloadable"] == 1
    assert result["already_on_r2"] == 0
    assert result["will_upload"] == 1
    assert result["will_create_media_object"] == 1
    assert result["will_create_invoice_capture"] == 1
    assert result["will_set_captured_invoice_media_id"] == 1
    assert result["missing_source"] == 0
    assert result["unmapped_invoice"] == 0
    assert result["conflicts"] == 0


def test_dry_run_conflicts_skip_existing_media(monkeypatch):
    migrator = InvoiceImageMigrator(_make_config())
    items = [_make_item(has_existing_media=True)]
    monkeypatch.setattr(migrator, "build_plan", lambda: items)
    result = migrator.dry_run(probe_r2=False)

    assert result["conflicts"] == 1
    assert result["will_upload"] == 0
    assert result["will_create_media_object"] == 0
    assert result["will_set_captured_invoice_media_id"] == 0


def test_dry_run_unmapped_and_missing_source(monkeypatch):
    migrator = InvoiceImageMigrator(_make_config())
    items = [
        _make_item(old_invoice_id="1", invoice_code="A", new_invoice_id=None),
        _make_item(old_invoice_id="2", invoice_code="B", source_exists=False, source_http_ok=False),
    ]
    monkeypatch.setattr(migrator, "build_plan", lambda: items)
    result = migrator.dry_run(probe_r2=False)

    assert result["unmapped_invoice"] == 1
    assert result["missing_source"] == 1
    assert result["source_downloadable"] == 1  # item 1 có source (dù unmapped)
    assert result["will_upload"] == 0


def test_dry_run_already_on_r2(monkeypatch):
    migrator = InvoiceImageMigrator(_make_config())
    items = [_make_item(already_on_r2=True)]
    monkeypatch.setattr(migrator, "build_plan", lambda: items)
    result = migrator.dry_run(probe_r2=False)

    assert result["already_on_r2"] == 1
    assert result["will_upload"] == 0
    # vẫn cần tạo media/capture/set vì đã map + có source + chưa có media
    assert result["will_create_media_object"] == 1
