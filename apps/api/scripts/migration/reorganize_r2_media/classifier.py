"""Classify every media object into a business category using existing DB relations.

Priority (highest first): invoice > order > production > pattern > partner > other.

No business data is written. Filenames are never used to guess a category when a
DB relation exists. Conflicts (a media mapped to more than one category, or to
multiple business codes within the winning category) are reported, not guessed.
"""
from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services.storage import media_extension, sanitize_key_segment, build_media_object_key, thumbnail_object_key

VN = ZoneInfo("Asia/Ho_Chi_Minh")

CATEGORY_PRIORITY = {
    "invoice": 0,
    "order": 1,
    "order_shared": 1,
    "production": 2,
    "pattern": 3,
    "partner": 4,
    "other": 5,
}

# Internal category -> R2 folder name (plural).
FOLDER_BY_CATEGORY = {
    "invoice": "invoices",
    "order": "orders",
    "order_shared": "orders-shared",
    "production": "production",
    "pattern": "patterns",
    "partner": "partners",
    "other": "other",
}

# New structure top-level prefixes.
NEW_PREFIXES = (
    "orders/", "orders-shared/", "invoices/", "production/",
    "patterns/", "partners/", "other/",
)
OLD_PREFIXES = ("legacy-media/", "private-media/")


def _to_vn(value) -> datetime | None:
    """Return an aware datetime in Asia/Ho_Chi_Minh (parses ISO strings too)."""
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(VN)
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day, tzinfo=VN)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        # Try ISO datetime, then ISO date, then date with timezone suffix.
        for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
            try:
                parsed = datetime.strptime(text[:19] if len(text) >= 19 else text, fmt)
                return parsed.replace(tzinfo=VN)
            except ValueError:
                continue
        try:
            return datetime.fromisoformat(text).astimezone(VN)
        except (ValueError, TypeError):
            return None
    return None


@dataclass
class Relation:
    category: str
    business_code: str | None
    business_date: datetime | None
    group_code: str | None = None


@dataclass
class MediaRecord:
    media_id: uuid.UUID
    object_key: str
    storage_provider: str
    bucket: str | None
    content_type: str
    size_bytes: int
    checksum: str
    sha256: str
    status: str
    created_at: datetime | None

    category: str = "other"
    business_code: str | None = None
    business_date: datetime | None = None
    conflicts: list[dict] = field(default_factory=list)
    unresolved: bool = False

    # Derived (filled by build_plan):
    extension: str = ""
    new_key: str = ""
    thumbnail_old_key: str = ""
    thumbnail_new_key: str = ""
    plan_status: str = "will_copy"  # will_copy | already_new_structure | missing_source | conflict_unresolved


def _rows(db: Session, sql: str) -> list:
    return [tuple(r) for r in db.execute(text(sql)).all()]


def classify(db: Session) -> dict[uuid.UUID, MediaRecord]:
    """Build a media_id -> MediaRecord map with category/conflicts resolved."""
    records: dict[uuid.UUID, MediaRecord] = {}

    media_rows = _rows(
        db,
        """
        SELECT id, object_key, storage_provider, bucket, content_type, size_bytes,
               checksum, sha256, status, created_at
        FROM media_objects
        """,
    )
    for row in media_rows:
        (
            mid, object_key, storage_provider, bucket, content_type,
            size_bytes, checksum, sha256, status, created_at,
        ) = row
        mid = uuid.UUID(str(mid))
        records[mid] = MediaRecord(
            media_id=mid,
            object_key=object_key,
            storage_provider=storage_provider or "",
            bucket=bucket,
            content_type=content_type or "",
            size_bytes=int(size_bytes or 0),
            checksum=checksum or "",
            sha256=sha256 or "",
            status=status or "",
            created_at=_to_vn(created_at),
        )

    relations: dict[uuid.UUID, list[Relation]] = {mid: [] for mid in records}

    def add(mid, category, business_code, business_date, group_code=None):
        try:
            mid = uuid.UUID(str(mid))
        except (ValueError, TypeError):
            return
        if mid not in records:
            return
        relations[mid].append(Relation(category, business_code, _to_vn(business_date), group_code))

    # --- orders (business date = created_date first, then created_at) ---
    # Also fetch the shared order group so media linked to both -TX/-CK child
    # orders can be collapsed into `order_shared` keyed by group_no.
    for mid, order_no, group_no, created_date, created_at in _rows(
        db,
        """
        SELECT om.media_id, o.order_no, og.group_no, o.created_date, o.created_at
        FROM order_media om
        JOIN orders o ON o.id = om.order_id
        LEFT JOIN order_groups og ON og.id = o.order_group_id
        """,
    ):
        add(mid, "order", order_no, created_date or created_at, group_no)

    # --- invoices (captured invoice image) ---
    for mid, invoice_no, issued_at, created_at in _rows(
        db,
        """
        SELECT captured_invoice_media_id AS media_id, invoice_no, issued_at, created_at
        FROM invoices
        WHERE captured_invoice_media_id IS NOT NULL
        """,
    ):
        add(mid, "invoice", invoice_no, issued_at or created_at)

    # --- invoice_captures (pre-finalize captures) -> resolve invoice_no ---
    captures = _rows(db, "SELECT media_id, order_ids, created_at FROM invoice_captures")
    if captures:
        capture_order_ids: dict[uuid.UUID, list[str]] = {}
        for media_id, order_ids, created_at in captures:
            ids: list[str] = []
            if isinstance(order_ids, list):
                ids = [str(x) for x in order_ids]
            elif order_ids:
                ids = [str(order_ids)]
            capture_order_ids[media_id] = ids
        all_order_ids = sorted({oid for ids in capture_order_ids.values() for oid in ids})
        invoice_by_order: dict[str, tuple[str, datetime | None]] = {}
        if all_order_ids:
            for order_id, invoice_no, issued_at in _rows(
                db,
                """
                SELECT io.order_id, i.invoice_no, i.issued_at
                FROM invoice_orders io
                JOIN invoices i ON i.id = io.invoice_id
                WHERE io.order_id IN :ids
                ORDER BY i.issued_at DESC
                """.replace(":ids", _sql_uuid_list(all_order_ids)),
            ):
                # Keep the most recently issued invoice for a given order.
                existing = invoice_by_order.get(str(order_id))
                if existing is None or (issued_at and existing[1] and issued_at > existing[1]):
                    invoice_by_order[str(order_id)] = (invoice_no, _to_vn(issued_at))
        for media_id, order_ids, created_at in captures:
            invoice_no: str | None = None
            bdate = _to_vn(created_at)
            for oid in order_ids:
                hit = invoice_by_order.get(oid)
                if hit:
                    invoice_no = hit[0]
                    bdate = hit[1] or bdate
                    break
            add(media_id, "invoice", invoice_no, bdate)

    # --- production ---
    for mid, batch_no, cut_date, created_at in _rows(
        db,
        """
        SELECT pbm.media_id, pb.batch_no, pb.cut_date, pb.created_at
        FROM production_batch_media pbm
        JOIN production_batches pb ON pb.id = pbm.batch_id
        """,
    ):
        add(mid, "production", batch_no, cut_date or created_at)

    # --- pattern notes (media_ids is a JSON list of media ids) ---
    for note_no, media_ids, created_at in _rows(
        db, "SELECT note_no, media_ids, created_at FROM pattern_notes"
    ):
        if isinstance(media_ids, str):
            try:
                media_ids = json.loads(media_ids)
            except (ValueError, TypeError):
                media_ids = []
        if not isinstance(media_ids, list):
            continue
        for raw in media_ids:
            try:
                mid = uuid.UUID(str(raw))
            except (ValueError, TypeError):
                continue
            add(mid, "pattern", note_no, created_at)

    # --- partner files ---
    for mid, partner_code, created_at in _rows(
        db,
        """
        SELECT pf.media_id, p.partner_code, pf.created_at
        FROM partner_files pf
        JOIN partners p ON p.id = pf.partner_id
        """,
    ):
        add(mid, "partner", partner_code, created_at)

    # --- partner settlements ---
    for mid, partner_code, created_at in _rows(
        db,
        """
        SELECT ps.media_id, p.partner_code, ps.created_at
        FROM partner_settlements ps
        JOIN partners p ON p.id = ps.partner_id
        WHERE ps.media_id IS NOT NULL
        """,
    ):
        add(mid, "partner", partner_code, created_at)

    # Resolve the winning category per media + collect conflicts.
    for mid, rels in relations.items():
        if not rels:
            continue
        rec = records[mid]

        # Separate order relations from the rest so shared child orders can be
        # collapsed into a single `order_shared` record keyed by group_no.
        order_rels = [r for r in rels if r.category == "order"]
        other_rels = [r for r in rels if r.category != "order"]

        # invoice always wins over everything (priority 0).
        invoice_rels = [r for r in other_rels if r.category == "invoice"]
        if invoice_rels:
            winner = invoice_rels[0]
            rec.category = "invoice"
            rec.business_code = winner.business_code
            rec.business_date = winner.business_date
            # Report any non-invoice relation as a conflict (informational).
            for r in rels:
                if r.category != "invoice":
                    rec.conflicts.append({
                        "category": r.category,
                        "business_code": r.business_code,
                        "priority": CATEGORY_PRIORITY[r.category],
                    })
            continue

        if order_rels:
            order_nos = sorted({r.business_code for r in order_rels if r.business_code})
            if len(order_nos) <= 1:
                rec.category = "order"
                rec.business_code = order_rels[0].business_code
                rec.business_date = order_rels[0].business_date
            else:
                group_codes = sorted({r.group_code for r in order_rels if r.group_code})
                if len(group_codes) == 1:
                    # All child orders belong to a single shared group.
                    rec.category = "order_shared"
                    rec.business_code = group_codes[0]
                    rec.business_date = order_rels[0].business_date
                else:
                    # Cannot determine a common group -> keep as order, mark
                    # unresolved so apply() skips this record.
                    rec.category = "order"
                    rec.business_code = order_rels[0].business_code
                    rec.business_date = order_rels[0].business_date
                    rec.unresolved = True
                    for r in order_rels[1:]:
                        rec.conflicts.append({
                            "category": "order",
                            "business_code": r.business_code,
                            "group_code": r.group_code,
                            "priority": CATEGORY_PRIORITY["order"],
                        })
            # Lower-priority non-order relations are still reported.
            for r in other_rels:
                if r.category != "invoice":
                    rec.conflicts.append({
                        "category": r.category,
                        "business_code": r.business_code,
                        "priority": CATEGORY_PRIORITY[r.category],
                    })
            continue

        # No invoice and no order: generic priority among the rest.
        if other_rels:
            winner = min(other_rels, key=lambda r: CATEGORY_PRIORITY[r.category])
            rec.category = winner.category
            rec.business_code = winner.business_code
            rec.business_date = winner.business_date
            for r in other_rels:
                if r.category != winner.category:
                    rec.conflicts.append({
                        "category": r.category,
                        "business_code": r.business_code,
                        "priority": CATEGORY_PRIORITY[r.category],
                    })

    return records


def _sql_uuid_list(ids: list[str]) -> str:
    """Render a SQL IN list of UUIDs (ids are already sanitized strings)."""
    return "(" + ",".join(f"'{i}'" for i in ids) + ")"


def build_plan(records: dict[uuid.UUID, MediaRecord]) -> list[MediaRecord]:
    """Fill the derived new-key fields for every record (no I/O)."""
    out: list[MediaRecord] = []
    for rec in records.values():
        rec.extension = media_extension(rec.content_type, rec.object_key)
        rec.thumbnail_old_key = thumbnail_object_key(rec.object_key)

        if rec.object_key.startswith(NEW_PREFIXES):
            rec.plan_status = "already_new_structure"
            # Keep existing key (already organized); thumb derives from it.
            rec.new_key = rec.object_key
            rec.thumbnail_new_key = thumbnail_object_key(rec.object_key)
        elif rec.unresolved:
            # Cannot determine a shared group -> keep conflict, do not copy.
            rec.plan_status = "conflict_unresolved"
            rec.new_key = rec.object_key
            rec.thumbnail_new_key = thumbnail_object_key(rec.object_key)
        else:
            rec.plan_status = "will_copy"
            rec.new_key = build_media_object_key(
                category=FOLDER_BY_CATEGORY[rec.category],
                business_code=rec.business_code,
                media_id=str(rec.media_id),
                extension=rec.extension,
                created_at=rec.business_date or rec.created_at,
            )
            rec.thumbnail_new_key = thumbnail_object_key(rec.new_key)
        out.append(rec)
    return out
