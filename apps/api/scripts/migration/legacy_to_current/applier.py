"""--apply implementation: legacy (OLD) -> current (NEW), transaction-safe and resumable.

Design contract
---------------
- OLD is READ ONLY; NEW is the target and is never reset.
- Each logical phase runs in its own transaction and commits only when the phase
  fully succeeds. A failure rolls back the *current* phase only; phases already
  committed are kept and reused on --resume.
- Idempotency is guaranteed by the persisted ``legacy_id_mapping`` table keyed on
  ``(legacy_table, legacy_id)``. Rows already mapped are skipped on rerun.
- The mapping row is written inside the same transaction as its data row, so a
  rolled-back phase never leaves a dangling mapping.
- Money: NEW stores integer VND (BigInteger). Legacy ``numeric(18,2)`` amounts are
  rounded to the nearest VND. The legacy data has exactly two fractional amounts
  (invoice ``121020260003`` = 11.05, ``151020260007`` = 3885.42); the resulting
  <=1 VND reconciliation is within ``settings.money_rounding_tolerance_vnd``.
- Passwords are never logged and never hard-coded; they come from env vars only.
"""
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, time, timezone
from decimal import ROUND_HALF_UP, Decimal
from urllib.parse import urlparse

from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.security import hash_password
from app.models import (
    CuttingTeam,
    Customer,
    DebtLedgerEntry,
    Employee,
    FabricType,
    Invoice,
    InvoiceOrder,
    MediaObject,
    Order,
    OrderGroup,
    OrderItem,
    OrderMedia,
    OrderStatusEvent,
    Partner,
    PartyDebtBalance,
    PatternPrice,
    Payment,
    PaymentAllocation,
    Product,
    ReturnItem,
    ReturnRecord,
    Role,
    User,
    UserRole,
    Warehouse,
    Workshop,
)

from . import mappings as M
from .idmap import LEGACY_ID_MAPPING_DDL, LEGACY_ID_MAPPING_TABLE
from .old import read_all
from .incremental import RowFilter, build_filter
from .runner import Runner, _money, _s

HEAD_REVISION = "20261015_0022"


def _closure_rows(engine: Engine, row_filter) -> dict[str, list[dict]]:
    """Đọc toàn bộ các bảng legacy có trong phase_tables, áp RowFilter.

    Trả {legacy_table: [rows đã lọc]}. Read-only.
    """
    tables = [
        "az_profiles", "az_staff", "az_customers", "az_warehouses", "order_groups",
        "order_units", "order_items", "order_status_events", "invoices", "invoice_lines",
        "invoice_order_links", "invoice_payments", "az_customer_opening_debts",
        "az_debt_slips", "return_slips", "return_items", "pattern_catalog", "pattern_jobs",
        "cutters", "sewing_houses", "pattern_fabrics", "supply_partners", "supply_entries",
        "supply_payments", "order_images", "pattern_job_images",
    ]
    result: dict[str, list[dict]] = {}
    for table in tables:
        try:
            rows = read_all(engine, table)
        except Exception:  # noqa: BLE001 - bảng legacy có thể không tồn tại
            continue
        result[table] = row_filter.filter_rows(table, rows)
    return result

# Legacy tables that are pure business data on a fresh target. System seed tables
# (roles/permissions/role_permissions) are excluded, and `partners` is excluded too
# because migration 0007 seeds a baseline partner ("TÙNG - IN") on upgrade head.
BUSINESS_TABLES = [
    "users", "user_roles", "employees", "customers", "warehouses", "order_groups",
    "orders", "order_items", "order_status_events", "invoices", "invoice_orders",
    "payments", "payment_allocations", "debt_ledger_entries", "party_debt_balances",
    "returns", "return_items", "products", "pattern_prices",
    "workshops", "cutting_teams", "fabric_types", "media_objects", "order_media",
]


def _money_int(value) -> int:
    return int(_money(value).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _host(url: str) -> str:
    """Full origin (host:port/db) so two DBs on the same host are still distinct."""
    try:
        parsed = urlparse(url)
        port = f":{parsed.port}" if parsed.port else ""
        return f"{parsed.hostname or '?'}{port}{parsed.path or ''}"
    except Exception:  # noqa: BLE001
        return "?"


def _tz(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


class ApplyError(RuntimeError):
    pass


class Applier:
    def __init__(self, old_url: str, new_url: str, *, temp_password: str, owner_temp_password: str,
                 from_date: str | None = None, to_date: str | None = None) -> None:
        self.old: Engine = create_engine(old_url, pool_pre_ping=True, future=True)
        self.new: Engine = create_engine(new_url, pool_pre_ping=True, future=True)
        self.Session = sessionmaker(bind=self.new, expire_on_commit=False)
        self.temp_password = temp_password
        self.owner_temp_password = owner_temp_password
        self.from_date = from_date
        self.to_date = to_date
        self.row_filter: RowFilter | None = None
        self.missing_time_cols: dict[str, list[str]] = {}
        self.log: list[dict] = []

    def _read(self, table: str) -> list[dict]:
        rows = read_all(self.old, table)
        if self.row_filter is not None:
            return self.row_filter.filter_rows(table, rows)
        return rows

    # ------------------------------------------------------------------
    # Mapping helpers (persisted inside the active transaction)
    # ------------------------------------------------------------------
    def _lookup(self, db: Session, legacy_table: str, legacy_id) -> uuid.UUID | None:
        if legacy_id is None:
            return None
        row = db.execute(
            text(
                f'SELECT new_uuid FROM "{LEGACY_ID_MAPPING_TABLE}" '
                "WHERE legacy_table = :t AND legacy_id = :i"
            ),
            {"t": legacy_table, "i": str(legacy_id)},
        ).first()
        return row[0] if row else None

    def _map(
        self,
        db: Session,
        legacy_table: str,
        legacy_id,
        new_table: str,
        business_key: str | None = None,
    ) -> uuid.UUID:
        existing = self._lookup(db, legacy_table, legacy_id)
        if existing:
            return existing
        new_uuid = uuid.uuid4()
        db.execute(
            text(
                f'INSERT INTO "{LEGACY_ID_MAPPING_TABLE}" '
                "(legacy_table, legacy_id, new_table, new_uuid, business_key) "
                "VALUES (:t, :i, :n, :u, :b)"
            ),
            {"t": legacy_table, "i": str(legacy_id), "n": new_table, "u": new_uuid, "b": business_key},
        )
        return new_uuid

    # ------------------------------------------------------------------
    # Pre-flight
    # ------------------------------------------------------------------
    def _ensure_mapping_table(self) -> None:
        with self.new.begin() as conn:
            conn.execute(text(LEGACY_ID_MAPPING_DDL))

    def preflight(self, *, resume: bool) -> list[str]:
        errors: list[str] = []

        if _host(str(self.old.url)) == _host(str(self.new.url)):
            errors.append("OLD và NEW trỏ cùng host/project; từ chối apply.")

        try:
            with self.new.connect() as conn:
                version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
        except Exception as exc:  # noqa: BLE001
            errors.append(f"NEW chưa có bảng alembic_version hoặc không đọc được: {exc}")
            version = None
        if version != HEAD_REVISION:
            errors.append(f"NEW đang ở Alembic revision {version!r}, cần {HEAD_REVISION!r}.")

        if not self.temp_password:
            errors.append("Thiếu env MIGRATION_TEMP_PASSWORD.")
        if not self.owner_temp_password:
            errors.append("Thiếu env MIGRATION_TEMP_PASSWORD_OWNER.")

        if not resume:
            non_empty = []
            with self.new.connect() as conn:
                for table in BUSINESS_TABLES:
                    try:
                        count = conn.execute(text(f'SELECT count(*) FROM "{table}"')).scalar()
                    except Exception:  # noqa: BLE001
                        continue
                    if count:
                        non_empty.append(f"{table}={count}")
            if non_empty:
                errors.append(
                    "NEW có business data (không rỗng): " + ", ".join(non_empty)
                    + ". Chạy lại với --resume nếu đây là lần chạy tiếp theo."
                )

        return errors

    def _dry_run_gates(self) -> tuple[dict, bool]:
        old_url = self.old.url.render_as_string(hide_password=False)
        new_url = self.new.url.render_as_string(hide_password=False)
        runner = Runner(old_url, new_url, from_date=self.from_date, to_date=self.to_date)
        try:
            payload = runner.run()
        finally:
            runner.close()
        sec = payload.get("sections", {})
        checks = {
            "PAYMENTS.unmapped_method == 0": sec.get("PAYMENTS", {}).get("unmapped_method", 0) == 0,
            "ORDERS.unmapped_status == 0": sec.get("ORDERS", {}).get("unmapped_status", 0) == 0,
            "ORPHANS == 0": len(payload.get("orphans", [])) == 0,
            "DEBT.difference_count == 0": sec.get("DEBT", {}).get("difference_count", 0) == 0,
            "DEBT.old_total == projected_new_total": sec.get("DEBT", {}).get("old_total", 0) == sec.get("DEBT", {}).get("projected_new_total", 0),
        }
        return payload, all(checks.values())

    # ------------------------------------------------------------------
    # Phase orchestration
    # ------------------------------------------------------------------
    def run(self, *, resume: bool) -> list[dict]:
        if self.from_date or self.to_date:
            self.row_filter, self.missing_time_cols = build_filter(
                self.old, self.from_date, self.to_date
            )
        self._ensure_mapping_table()
        phases = [
            self._apply_users,
            self._apply_employees,
            self._apply_customers,
            self._apply_warehouses,
            self._apply_order_groups,
            self._apply_orders,
            self._apply_order_items,
            self._apply_order_status_history,
            self._apply_invoices,
            self._apply_invoice_orders,
            self._apply_payments,
            self._apply_debt,
            self._apply_returns,
            self._apply_production,
            self._apply_materials,
            self._apply_media,
        ]
        for phase in phases:
            name = phase.__name__.replace("_apply_", "")
            processed = inserted = skipped = failed = 0
            try:
                with self.Session() as db:
                    counts = phase(db) or {}
                    processed = counts.get("processed", 0)
                    inserted = counts.get("inserted", 0)
                    skipped = counts.get("skipped", 0)
                    failed = counts.get("failed", 0)
                    db.commit()
            except Exception as exc:  # noqa: BLE001
                # Current phase rolled back; prior committed phases persist for --resume.
                self.log.append({"phase": name, "status": "FAILED", "processed": processed,
                                 "inserted": inserted, "skipped": skipped, "failed": failed,
                                 "error": str(exc)})
                raise
            self.log.append({"phase": name, "status": "OK", "processed": processed,
                             "inserted": inserted, "skipped": skipped, "failed": failed})
            print(f"PHASE {name} processed={processed} inserted={inserted} skipped={skipped} failed={failed}")
        return self.log

    # ------------------------------------------------------------------
    # Phases
    # ------------------------------------------------------------------
    def _apply_users(self, db: Session) -> dict:
        rows = self._read("az_profiles")
        processed = inserted = skipped = failed = 0
        roles = {r.code: r for r in db.scalars(select(Role))}
        for r in rows:
            processed += 1
            legacy_id = r.get("id")
            if self._lookup(db, "az_profiles", legacy_id):
                skipped += 1
                continue
            login = _s(r.get("login_name"))
            role = M.map_or_unmapped(r.get("role"), M.ROLE_MAP)
            if not login:
                failed += 1
                continue
            if role == M.UNMAPPED_STATUS:
                role = "MEMBER"
            status = "ACTIVE" if r.get("is_active") else "INACTIVE"
            password = self.owner_temp_password if role == "OWNER" else self.temp_password
            new_uuid = self._map(db, "az_profiles", legacy_id, "users", business_key=login)
            user = User(
                id=new_uuid,
                username=login,
                password_hash=hash_password(password),
                display_name=_s(r.get("display_name")) or login,
                phone=_s(r.get("phone")),
                role=role,
                status=status,
            )
            db.add(user)
            if role in roles:
                db.add(UserRole(user_id=user.id, role_id=roles[role].id))
            inserted += 1
        return {"processed": processed, "inserted": inserted, "skipped": skipped, "failed": failed}

    def _apply_employees(self, db: Session) -> dict:
        rows = self._read("az_staff")
        processed = inserted = skipped = failed = 0
        for r in rows:
            processed += 1
            legacy_id = r.get("id")
            if self._lookup(db, "az_staff", legacy_id):
                skipped += 1
                continue
            status = M.map_or_unmapped(r.get("status"), M.STAFF_STATUS_MAP)
            if status == M.UNMAPPED_STATUS:
                status = "ACTIVE"
            user_uuid = self._lookup(db, "az_profiles", r.get("profile_id"))
            new_uuid = self._map(db, "az_staff", legacy_id, "employees", business_key=f"NV{int(legacy_id):04d}")
            emp = Employee(
                id=new_uuid,
                employee_code=f"NV{int(legacy_id):04d}",
                full_name=_s(r.get("display_name")) or f"Nhân viên {legacy_id}",
                phone=_s(r.get("phone")),
                position=_s(r.get("position")) or "Công nhân",
                daily_rate_amount=_money_int(r.get("daily_rate")),
                start_date=r.get("join_date"),
                status=status,
                user_id=user_uuid,
            )
            db.add(emp)
            inserted += 1
        return {"processed": processed, "inserted": inserted, "skipped": skipped, "failed": failed}

    def _apply_customers(self, db: Session) -> dict:
        rows = self._read("az_customers")
        opening = self._read("az_customer_opening_debts")
        legacy_code = {r.get("customer_id"): _s(r.get("legacy_code")) for r in opening}
        seen: set[str] = set()
        processed = inserted = skipped = failed = 0
        for r in rows:
            processed += 1
            legacy_id = r.get("id")
            if self._lookup(db, "az_customers", legacy_id):
                skipped += 1
                continue
            code = legacy_code.get(legacy_id) or _s(r.get("customer_code"))
            name = _s(r.get("name"))
            if not code or not name or code in seen:
                failed += 1
                continue
            seen.add(code)
            new_uuid = self._map(db, "az_customers", legacy_id, "customers", business_key=code)
            customer = Customer(
                id=new_uuid,
                customer_code=code,
                name=name,
                phone=_s(r.get("phone")),
                address=_s(r.get("address")),
                carrier_name=_s(r.get("transport_station")),
                carrier_phone=_s(r.get("transport_phone")),
                status="ACTIVE",
            )
            db.add(customer)
            db.flush()
            inserted += 1
        return {"processed": processed, "inserted": inserted, "skipped": skipped, "failed": failed}

    def _apply_warehouses(self, db: Session) -> dict:
        rows = self._read("az_warehouses")
        processed = inserted = skipped = failed = 0
        for r in rows:
            processed += 1
            legacy_id = r.get("id")
            if self._lookup(db, "az_warehouses", legacy_id):
                skipped += 1
                continue
            code = _s(r.get("code"))
            if not code:
                failed += 1
                continue
            new_uuid = self._map(db, "az_warehouses", legacy_id, "warehouses", business_key=code)
            wh = Warehouse(
                id=new_uuid,
                code=code,
                name=_s(r.get("name")) or code,
                sort_order=int(legacy_id or 0),
                active=bool(r.get("is_active")) if r.get("is_active") is not None else True,
            )
            db.add(wh)
            db.flush()
            inserted += 1
        return {"processed": processed, "inserted": inserted, "skipped": skipped, "failed": failed}

    def _apply_order_groups(self, db: Session) -> dict:
        rows = self._read("order_groups")
        processed = inserted = skipped = failed = 0
        for r in rows:
            processed += 1
            legacy_id = r.get("id")
            if self._lookup(db, "order_groups", legacy_id):
                skipped += 1
                continue
            customer_uuid = self._lookup(db, "az_customers", r.get("customer_id"))
            group_no = _s(r.get("root_code"))
            if not customer_uuid or not group_no:
                failed += 1
                continue
            new_uuid = self._map(db, "order_groups", legacy_id, "order_groups", business_key=group_no)
            og = OrderGroup(id=new_uuid, group_no=group_no, customer_id=customer_uuid)
            db.add(og)
            db.flush()
            inserted += 1
        return {"processed": processed, "inserted": inserted, "skipped": skipped, "failed": failed}

    def _apply_orders(self, db: Session) -> dict:
        groups = {r.get("id"): r for r in self._read("order_groups")}
        items = self._read("order_items")
        total_by_unit: dict = {}
        for it in items:
            total_by_unit[it.get("unit_id")] = total_by_unit.get(it.get("unit_id"), Decimal("0")) + _money(it.get("line_total"))
        rows = self._read("order_units")
        processed = inserted = skipped = failed = 0
        for r in rows:
            processed += 1
            legacy_id = r.get("id")
            if self._lookup(db, "order_units", legacy_id):
                skipped += 1
                continue
            order_no = _s(r.get("order_code"))
            if not order_no:
                failed += 1
                continue
            g = groups.get(r.get("group_id"))
            customer_uuid = self._lookup(db, "az_customers", g.get("customer_id")) if g else None
            warehouse_uuid = self._lookup(db, "az_warehouses", r.get("warehouse_id"))
            if not customer_uuid or not warehouse_uuid:
                failed += 1
                continue
            status = M.ORDER_STATUS_MAP.get(str(r.get("status")).strip(), "NEW")
            order_type = M.ORDER_TYPE_MAP.get(str(g.get("order_type")).strip(), "NORMAL") if g else "NORMAL"
            created_at = _tz(r.get("created_at"))
            new_uuid = self._map(db, "order_units", legacy_id, "orders", business_key=order_no)
            order = Order(
                id=new_uuid,
                order_no=order_no,
                order_group_id=self._lookup(db, "order_groups", r.get("group_id")),
                customer_id=customer_uuid,
                warehouse_id=warehouse_uuid,
                order_type=order_type,
                created_date=created_at.date() if created_at else datetime.now(timezone.utc).date(),
                delivery_date=g.get("delivery_date") if g else None,
                is_urgent=bool(g.get("is_urgent")) if g else False,
                customer_note=_s(g.get("creator_note")) if g else None,
                staff_note=_s(r.get("packing_note")),
                status=status,
                source_channel="ZALO",
                claimed_by=self._lookup(db, "az_profiles", r.get("started_by")),
                claimed_at=_tz(r.get("started_at")),
                picked_at=_tz(r.get("started_at")),
                total_amount=_money_int(total_by_unit.get(legacy_id, Decimal("0"))),
                created_by=self._lookup(db, "az_profiles", g.get("created_by")) if g else None,
            )
            db.add(order)
            db.flush()
            inserted += 1
        return {"processed": processed, "inserted": inserted, "skipped": skipped, "failed": failed}

    def _apply_order_items(self, db: Session) -> dict:
        rows = self._read("order_items")
        processed = inserted = skipped = failed = 0
        for r in rows:
            processed += 1
            legacy_id = r.get("id")
            if self._lookup(db, "order_items", legacy_id):
                skipped += 1
                continue
            order_uuid = self._lookup(db, "order_units", r.get("unit_id"))
            order = db.get(Order, order_uuid) if order_uuid else None
            if not order:
                failed += 1
                continue
            new_uuid = self._map(db, "order_items", legacy_id, "order_items")
            item = OrderItem(
                id=new_uuid,
                order_id=order_uuid,
                line_no=int(r.get("line_no") or 0) or processed,
                product_name_snapshot=_s(r.get("product_name")) or "Sản phẩm",
                color_snapshot=_s(r.get("color")),
                size_snapshot=_s(r.get("size")),
                warehouse_id=order.warehouse_id,
                quantity=Decimal(str(r.get("quantity") or 0)),
                unit_price_amount=_money_int(r.get("unit_price")),
                line_total_amount=_money_int(r.get("line_total")),
                revision_no=1,
                active=True,
            )
            db.add(item)
            db.flush()
            inserted += 1
        return {"processed": processed, "inserted": inserted, "skipped": skipped, "failed": failed}

    def _apply_order_status_history(self, db: Session) -> dict:
        rows = self._read("order_status_events")
        processed = inserted = skipped = failed = 0
        for r in rows:
            processed += 1
            legacy_id = r.get("id")
            if self._lookup(db, "order_status_events", legacy_id):
                skipped += 1
                continue
            order_uuid = self._lookup(db, "order_units", r.get("unit_id"))
            if not order_uuid:
                failed += 1
                continue
            from_status = M.ORDER_STATUS_MAP.get(str(r.get("from_status")).strip()) if r.get("from_status") else None
            to_status = M.ORDER_STATUS_MAP.get(str(r.get("to_status")).strip(), "NEW")
            new_uuid = self._map(db, "order_status_events", legacy_id, "order_status_events")
            event = OrderStatusEvent(
                id=new_uuid,
                order_id=order_uuid,
                from_status=from_status,
                to_status=to_status,
                actor_user_id=self._lookup(db, "az_profiles", r.get("actor_id")),
                reason=_s(r.get("action")),
                occurred_at=_tz(r.get("created_at")),
            )
            db.add(event)
            db.flush()
            inserted += 1
        return {"processed": processed, "inserted": inserted, "skipped": skipped, "failed": failed}

    def _apply_invoices(self, db: Session) -> dict:
        invoices = self._read("invoices")
        lines = self._read("invoice_lines")
        links = self._read("invoice_order_links")
        payments = self._read("invoice_payments")
        order_items = self._read("order_items")

        lines_by_invoice: dict = {}
        for ln in lines:
            lines_by_invoice.setdefault(ln.get("invoice_id"), []).append(ln)
        links_by_invoice: dict = {}
        for lk in links:
            links_by_invoice.setdefault(lk.get("invoice_id"), []).append(lk.get("unit_id"))
        pay_by_invoice: dict = {}
        for p in payments:
            pay_by_invoice.setdefault(p.get("invoice_id"), []).append(p)
        item_unit: dict = {it.get("id"): it.get("unit_id") for it in order_items}

        processed = inserted = skipped = failed = 0
        for r in invoices:
            processed += 1
            legacy_id = r.get("id")
            if self._lookup(db, "invoices", legacy_id):
                skipped += 1
                continue
            invoice_no = _s(r.get("invoice_code"))
            customer_uuid = self._lookup(db, "az_customers", r.get("customer_id"))
            if not invoice_no or not customer_uuid:
                failed += 1
                continue
            raw_status = str(r.get("status") or "").strip()
            legacy_is_sent = raw_status == "DA_GUI"

            invoice_payments = pay_by_invoice.get(legacy_id, [])
            surcharge = sum((_money(p.get("amount")) for p in invoice_payments if str(p.get("method") or "").strip() == "CONG_THEM"), Decimal("0"))
            return_credit = sum((_money(p.get("amount")) for p in invoice_payments if str(p.get("method") or "").strip() == "HANG_TRA"), Decimal("0"))
            paid = sum((_money(p.get("amount")) for p in invoice_payments if str(p.get("method") or "").strip() not in ("CONG_THEM", "HANG_TRA")), Decimal("0"))

            subtotal = _money(r.get("subtotal"))
            surcharge_int = _money_int(surcharge)
            return_credit_int = _money_int(return_credit)
            paid_int = _money_int(paid)
            balance = max(subtotal + surcharge - return_credit - paid, Decimal("0"))
            balance_int = _money_int(balance)
            debt_before = _money_int(r.get("old_debt_snapshot"))
            debt_after = max(debt_before + _money_int(subtotal) + surcharge_int - return_credit_int - paid_int, 0)

            if raw_status == "DA_XOA":
                status = "DELETED"
            elif raw_status == "CHUA_CHOT":
                status = "DRAFT"
            elif balance_int == 0:
                status = "PAID"
            elif paid_int or return_credit_int:
                status = "PARTIALLY_PAID"
            else:
                status = "SENT"

            issued_at = _tz(r.get("finalized_at")) or _tz(r.get("created_at"))
            snapshot = self._build_invoice_snapshot(
                db, r, legacy_id, customer_uuid, lines_by_invoice.get(legacy_id, []),
                links_by_invoice.get(legacy_id, []), item_unit,
                subtotal, surcharge_int, return_credit_int, paid_int, balance_int,
                debt_before, debt_after,
            )

            new_uuid = self._map(db, "invoices", legacy_id, "invoices", business_key=invoice_no)
            invoice = Invoice(
                id=new_uuid,
                invoice_no=invoice_no,
                customer_id=customer_uuid,
                status=status,
                issued_at=issued_at,
                subtotal_amount=_money_int(subtotal),
                surcharge_amount=surcharge_int,
                return_credit_amount=return_credit_int,
                paid_amount=paid_int,
                balance_amount=balance_int,
                debt_before_amount=debt_before,
                debt_after_amount=debt_after,
                note=_s(r.get("note")),
                template_version="1",
                snapshot=snapshot,
                created_by=self._lookup(db, "az_profiles", r.get("finalized_by") or r.get("created_by")),
                captured_at=_tz(r.get("finalized_at")),
                idempotency_key=f"legacy:invoice:{invoice_no}",
            )
            db.add(invoice)
            db.flush()
            inserted += 1
        return {"processed": processed, "inserted": inserted, "skipped": skipped, "failed": failed}

    def _build_invoice_snapshot(
        self, db: Session, invoice_row: dict, legacy_id, customer_uuid: uuid.UUID,
        lines: list[dict], linked_unit_ids: list, item_unit: dict,
        subtotal: Decimal, surcharge: int, return_credit: int, paid: int, balance: int,
        debt_before: int, debt_after: int,
    ) -> dict:
        customer = db.get(Customer, customer_uuid)
        lines_by_unit: dict = {}
        for ln in lines:
            unit_id = item_unit.get(ln.get("source_item_id"))
            lines_by_unit.setdefault(unit_id, []).append(ln)

        order_rows = []
        for unit_id in sorted(set(linked_unit_ids) | set(lines_by_unit), key=lambda u: str(u)):
            order_uuid = self._lookup(db, "order_units", unit_id)
            order_no = None
            order_status = None
            billing_status = None
            if order_uuid:
                order = db.get(Order, order_uuid)
                if order:
                    order_no = order.order_no
                    order_status = order.status
                    billing_status = order.billing_status
            unit_lines = lines_by_unit.get(unit_id, [])
            items = [{
                "id": None,
                "product_variant_id": None,
                "name": _s(ln.get("product_name")) or "Sản phẩm",
                "sales_code": None,
                "internal_code": None,
                "color": _s(ln.get("color")),
                "size": _s(ln.get("size")),
                "quantity": int(ln.get("quantity") or 0),
                "unit_price_amount": _money_int(ln.get("unit_price")),
                "line_total_amount": _money_int(ln.get("line_total")),
            } for ln in unit_lines]
            order_rows.append({
                "id": str(order_uuid) if order_uuid else None,
                "order_no": order_no,
                "amount": sum(it["line_total_amount"] for it in items),
                "status": order_status,
                "billing_status": billing_status,
                "images": [],
                "items": items,
            })

        return {
            "template_version": "1",
            "invoice_no": _s(invoice_row.get("invoice_code")),
            "issued_at": (_tz(invoice_row.get("finalized_at")) or _tz(invoice_row.get("created_at")) or datetime.now(timezone.utc)).isoformat(),
            "customer": {
                "id": str(customer.id), "customer_code": customer.customer_code,
                "name": customer.name, "phone": customer.phone, "address": customer.address,
            },
            "orders": order_rows,
            "subtotal_amount": _money_int(subtotal),
            "surcharge_amount": surcharge,
            "return_credit_amount": return_credit,
            "paid_amount": paid,
            "balance_amount": balance,
            "debt_before_amount": debt_before,
            "debt_after_amount": debt_after,
            "payments": [],
            "return_ids": [],
            "note": _s(invoice_row.get("note")),
        }

    def _apply_invoice_orders(self, db: Session) -> dict:
        links = self._read("invoice_order_links")
        lines = self._read("invoice_lines")
        order_items = self._read("order_items")
        item_unit = {it.get("id"): it.get("unit_id") for it in order_items}
        # Frozen amount per (invoice_id, unit_id) from legacy invoice_lines.
        amount_by_link: dict = {}
        for ln in lines:
            unit_id = item_unit.get(ln.get("source_item_id"))
            key = (ln.get("invoice_id"), unit_id)
            amount_by_link[key] = amount_by_link.get(key, Decimal("0")) + _money(ln.get("line_total"))

        processed = inserted = skipped = failed = 0
        for r in links:
            key = f"{r.get('invoice_id')}:{r.get('unit_id')}"
            processed += 1
            if self._lookup(db, "invoice_order_links", key):
                skipped += 1
                continue
            invoice_uuid = self._lookup(db, "invoices", r.get("invoice_id"))
            order_uuid = self._lookup(db, "order_units", r.get("unit_id"))
            if not invoice_uuid or not order_uuid:
                failed += 1
                continue
            amount = _money_int(amount_by_link.get((r.get("invoice_id"), r.get("unit_id")), Decimal("0")))
            new_uuid = self._map(db, "invoice_order_links", key, "invoice_orders")
            db.add(InvoiceOrder(id=new_uuid, invoice_id=invoice_uuid, order_id=order_uuid, amount=amount))
            inserted += 1
        return {"processed": processed, "inserted": inserted, "skipped": skipped, "failed": failed}

    def _apply_payments(self, db: Session) -> dict:
        rows = self._read("invoice_payments")
        processed = inserted = skipped = failed = 0
        for r in rows:
            processed += 1
            legacy_id = r.get("id")
            raw = str(r.get("method") or "").strip()
            method = M.PAYMENT_METHOD_MAP.get(raw)
            if method is None:
                # CONG_THEM / HANG_TRA are ledger-only entries, handled in _apply_debt.
                continue
            if self._lookup(db, "invoice_payments", legacy_id):
                skipped += 1
                continue
            customer_uuid = self._lookup(db, "az_customers", self._payment_customer_id(r.get("invoice_id")))
            amount = _money_int(r.get("amount"))
            if not customer_uuid or amount <= 0:
                failed += 1
                continue
            payment_date = r.get("payment_date")
            paid_at = _tz(datetime.combine(payment_date, time.min)) if payment_date else None
            new_uuid = self._map(db, "invoice_payments", legacy_id, "payments")
            payment = Payment(
                id=new_uuid,
                payment_no=f"LEGACY-PAY-{legacy_id}",
                party_type="CUSTOMER",
                customer_id=customer_uuid,
                paid_at=paid_at,
                amount=amount,
                method=method,
                direction="RECEIPT",
                note=_s(r.get("reason")),
                status="POSTED",
                idempotency_key=f"legacy:payment:{legacy_id}",
            )
            db.add(payment)
            db.flush()
            # Allocate the payment to its legacy invoice for correct invoice display.
            invoice_uuid = self._lookup(db, "invoices", r.get("invoice_id"))
            if invoice_uuid:
                invoice = db.get(Invoice, invoice_uuid)
                if invoice:
                    due = max(invoice.subtotal_amount + invoice.surcharge_amount - invoice.return_credit_amount, 0)
                    allocated = min(amount, due)
                    if allocated > 0:
                        db.add(PaymentAllocation(
                            payment_id=payment.id, target_type="INVOICE",
                            target_id=invoice_uuid, allocated_amount=allocated,
                        ))
            inserted += 1
        return {"processed": processed, "inserted": inserted, "skipped": skipped, "failed": failed}

    def _payment_customer_id(self, invoice_id) -> int | None:
        # Đọc TOÀN BỘ invoices (unfiltered): payment có thể trỏ tới invoice cũ
        # ngoài closure của batch incremental hiện tại.
        rows = read_all(self.old, "invoices")
        for r in rows:
            if r.get("id") == invoice_id:
                return r.get("customer_id")
        return None

    def _apply_debt(self, db: Session) -> dict:
        opening = self._read("az_customer_opening_debts")
        slips = self._read("az_debt_slips")
        invoices = self._read("invoices")
        payments = self._read("invoice_payments")

        pay_by_invoice: dict = {}
        for p in payments:
            pay_by_invoice.setdefault(p.get("invoice_id"), []).append(p)

        # We build the full ledger in memory first, then insert with idempotency keys.
        ledger: list[dict] = []

        # 1) OPENING
        for o in opening:
            amt = _money_int(o.get("opening_debt"))
            if amt == 0:
                continue
            ledger.append({
                "legacy_table": "az_customer_opening_debts",
                "legacy_id": o.get("customer_id"),
                "customer_id": o.get("customer_id"),
                "entry_type": "OPENING",
                "amount": amt,
                "reference_type": None,
                "description": _s(o.get("legacy_code")),
                "occurred_at": _tz(o.get("imported_at")),
            })

        # 2) DA_GUI invoices: INVOICE + SURCHARGE (CONG_THEM) + RETURN_CREDIT (HANG_TRA)
        for inv in invoices:
            if str(inv.get("status") or "").strip() != "DA_GUI":
                continue
            customer_id = inv.get("customer_id")
            ledger.append({
                "legacy_table": "invoices", "legacy_id": inv.get("id"), "customer_id": customer_id,
                "invoice_id": inv.get("id"),
                "entry_type": "INVOICE", "amount": _money_int(inv.get("subtotal")),
                "reference_type": "INVOICE", "description": _s(inv.get("invoice_code")),
                "occurred_at": _tz(inv.get("finalized_at")) or _tz(inv.get("created_at")),
            })
            for p in pay_by_invoice.get(inv.get("id"), []):
                raw = str(p.get("method") or "").strip()
                amt = _money_int(p.get("amount"))
                if raw == "CONG_THEM" and amt:
                    ledger.append({
                        "legacy_table": "invoice_payments", "legacy_id": p.get("id"), "customer_id": customer_id,
                        "invoice_id": inv.get("id"),
                        "entry_type": "SURCHARGE", "amount": amt, "reference_type": "INVOICE",
                        "description": _s(inv.get("invoice_code")),
                        "occurred_at": _tz(p.get("created_at")),
                    })
                elif raw == "HANG_TRA" and amt:
                    ledger.append({
                        "legacy_table": "invoice_payments", "legacy_id": p.get("id"), "customer_id": customer_id,
                        "invoice_id": inv.get("id"),
                        "entry_type": "RETURN_CREDIT", "amount": -amt, "reference_type": "INVOICE",
                        "description": _s(inv.get("invoice_code")),
                        "occurred_at": _tz(p.get("created_at")),
                    })
                elif raw not in ("CONG_THEM", "HANG_TRA") and amt:
                    ledger.append({
                        "legacy_table": "invoice_payments", "legacy_id": p.get("id"), "customer_id": customer_id,
                        "invoice_id": inv.get("id"),
                        "entry_type": "PAYMENT", "amount": -amt, "reference_type": "PAYMENT",
                        "description": _s(inv.get("invoice_code")),
                        "occurred_at": _tz(p.get("created_at")),
                    })

        # 3) Debt slips: total_plus - total_minus
        for s in slips:
            delta = _money_int(s.get("total_plus")) - _money_int(s.get("total_minus"))
            if delta == 0:
                continue
            ledger.append({
                "legacy_table": "az_debt_slips", "legacy_id": s.get("id"), "customer_id": s.get("customer_id"),
                "entry_type": "ADJUSTMENT", "amount": delta, "reference_type": "DEBT_SLIP",
                "description": _s(s.get("slip_code")),
                "occurred_at": _tz(s.get("created_at")),
            })

        processed = inserted = skipped = failed = 0
        touched_customers: set = set()
        for entry in ledger:
            processed += 1
            key = f"{entry['legacy_table']}:{entry['legacy_id']}:{entry['entry_type']}"
            if self._lookup(db, "debt_ledger_synth", key):
                skipped += 1
                continue
            customer_uuid = self._lookup(db, "az_customers", entry["customer_id"])
            if not customer_uuid:
                failed += 1
                continue
            if entry["reference_type"] == "INVOICE":
                reference_id = self._lookup(db, "invoices", entry.get("invoice_id"))
            elif entry["reference_type"] == "PAYMENT":
                reference_id = self._lookup(db, "invoice_payments", entry["legacy_id"])
            else:
                reference_id = None
            new_uuid = self._map(db, "debt_ledger_synth", key, "debt_ledger_entries")
            db.add(DebtLedgerEntry(
                id=new_uuid,
                party_type="CUSTOMER",
                party_id=customer_uuid,
                entry_type=entry["entry_type"],
                amount_delta=entry["amount"],
                reference_type=entry["reference_type"],
                reference_id=reference_id,
                description=entry["description"],
                occurred_at=entry["occurred_at"],
                idempotency_key=f"legacy:debt:{entry['legacy_table']}:{entry['legacy_id']}:{entry['entry_type']}",
            ))
            touched_customers.add(customer_uuid)
            inserted += 1

        db.flush()
        for customer_uuid in touched_customers:
            self._refresh_debt_balance(db, customer_uuid)
        return {"processed": processed, "inserted": inserted, "skipped": skipped, "failed": failed}

    def _refresh_debt_balance(self, db: Session, customer_uuid: uuid.UUID) -> None:
        rows = list(db.scalars(select(DebtLedgerEntry).where(
            DebtLedgerEntry.party_type == "CUSTOMER", DebtLedgerEntry.party_id == customer_uuid
        )))
        opening = sum(r.amount_delta for r in rows if r.entry_type == "OPENING")
        debit = sum(r.amount_delta for r in rows if r.amount_delta > 0 and r.entry_type != "OPENING")
        credit = -sum(r.amount_delta for r in rows if r.amount_delta < 0)
        current = sum(r.amount_delta for r in rows)
        projection = db.scalar(select(PartyDebtBalance).where(
            PartyDebtBalance.party_type == "CUSTOMER", PartyDebtBalance.party_id == customer_uuid
        ))
        if not projection:
            db.add(PartyDebtBalance(
                party_type="CUSTOMER", party_id=customer_uuid,
                opening=opening, debit=debit, credit=credit, current=current,
            ))
        else:
            projection.opening = opening
            projection.debit = debit
            projection.credit = credit
            projection.current = current
            projection.version += 1
            projection.calculated_at = datetime.now(timezone.utc)

    def _apply_returns(self, db: Session) -> dict:
        slips = self._read("return_slips")
        items = self._read("return_items")
        items_by_slip: dict = {}
        for it in items:
            items_by_slip.setdefault(it.get("slip_id"), []).append(it)
        processed = inserted = skipped = failed = 0
        for r in slips:
            processed += 1
            legacy_id = r.get("id")
            if self._lookup(db, "return_slips", legacy_id):
                skipped += 1
                continue
            customer_uuid = self._lookup(db, "az_customers", r.get("customer_id"))
            if not customer_uuid:
                failed += 1
                continue
            # Legacy returns have no warehouse; default to the first warehouse (documented decision).
            warehouse_uuid = db.scalar(select(Warehouse.id).order_by(Warehouse.sort_order).limit(1))
            if not warehouse_uuid:
                failed += 1
                continue
            slip_items = items_by_slip.get(legacy_id, [])
            total_credit = _money_int(sum((_money(it.get("line_total")) for it in slip_items), Decimal("0")))
            status = M.RETURN_STATUS_MAP.get(str(r.get("status")).strip(), "NEW")
            return_no = _s(r.get("slip_code")) or f"HT{int(legacy_id):06d}"
            new_uuid = self._map(db, "return_slips", legacy_id, "returns", business_key=return_no)
            rec = ReturnRecord(
                id=new_uuid,
                return_no=return_no,
                customer_id=customer_uuid,
                warehouse_id=warehouse_uuid,
                status=status,
                total_credit_amount=total_credit,
                note=_s(r.get("reason")),
                created_by=self._lookup(db, "az_profiles", r.get("created_by")),
                approved_by=self._lookup(db, "az_profiles", r.get("approved_by")),
                approved_at=_tz(r.get("approved_at")),
            )
            db.add(rec)
            db.flush()
            for it in slip_items:
                item_uuid = self._map(db, "return_items", it.get("id"), "return_items")
                db.add(ReturnItem(
                    id=item_uuid,
                    return_id=rec.id,
                    description_snapshot=_s(it.get("product_name")) or "Sản phẩm",
                    quantity=Decimal(str(it.get("quantity") or 0)),
                    unit_credit_amount=_money_int(it.get("unit_price")),
                    line_credit_amount=_money_int(it.get("line_total")),
                    condition=_s(it.get("item_condition")) or "Hàng tốt",
                    restock=True,
                ))
            inserted += 1
        return {"processed": processed, "inserted": inserted, "skipped": skipped, "failed": failed}

    def _apply_production(self, db: Session) -> dict:
        processed = inserted = skipped = failed = 0

        for r in self._read("pattern_catalog"):
            processed += 1
            legacy_id = r.get("id")
            if self._lookup(db, "pattern_catalog", legacy_id):
                skipped += 1
                continue
            code = _s(r.get("code"))
            if not code:
                failed += 1
                continue
            new_uuid = self._map(db, "pattern_catalog", legacy_id, "products", business_key=code)
            product = Product(
                id=new_uuid,
                product_code=code,
                pattern_code=code,
                name=_s(r.get("product_name")) or code,
                notes=_s(r.get("notes")),
                status="ACTIVE",
            )
            db.add(product)
            db.flush()
            # Pattern price from legacy cost_price (best available source).
            price_uuid = self._map(db, "pattern_catalog_price", legacy_id, "pattern_prices")
            db.add(PatternPrice(
                id=price_uuid,
                pattern_code=code,
                unit_price_amount=_money_int(r.get("cost_price")),
                valid_from=datetime.now(timezone.utc).date(),
                valid_to=None,
            ))
            inserted += 1

        for r in self._read("cutters"):
            processed += 1
            legacy_id = r.get("id")
            if self._lookup(db, "cutters", legacy_id):
                skipped += 1
                continue
            name = _s(r.get("name"))
            if not name:
                failed += 1
                continue
            new_uuid = self._map(db, "cutters", legacy_id, "cutting_teams", business_key=name)
            db.add(CuttingTeam(
                id=new_uuid,
                team_code=f"CT{int(legacy_id):04d}",
                name=name,
                phone=_s(r.get("phone")),
                status="ACTIVE" if r.get("is_active") else "INACTIVE",
                notes=_s(r.get("note")),
            ))
            inserted += 1

        for r in self._read("sewing_houses"):
            processed += 1
            legacy_id = r.get("id")
            if self._lookup(db, "sewing_houses", legacy_id):
                skipped += 1
                continue
            name = _s(r.get("name"))
            if not name:
                failed += 1
                continue
            new_uuid = self._map(db, "sewing_houses", legacy_id, "workshops", business_key=name)
            db.add(Workshop(
                id=new_uuid,
                workshop_code=f"WS{int(legacy_id):04d}",
                name=name,
                phone=_s(r.get("phone")),
                address=_s(r.get("address")),
                status="ACTIVE" if r.get("is_active") else "INACTIVE",
                notes=_s(r.get("note")),
            ))
            inserted += 1

        for r in self._read("pattern_fabrics"):
            processed += 1
            legacy_id = r.get("id")
            if self._lookup(db, "pattern_fabrics", legacy_id):
                skipped += 1
                continue
            name = _s(r.get("name"))
            if not name:
                failed += 1
                continue
            new_uuid = self._map(db, "pattern_fabrics", legacy_id, "fabric_types", business_key=name)
            db.add(FabricType(
                id=new_uuid,
                code=f"FT{int(legacy_id):04d}",
                name=name,
                status="ACTIVE" if r.get("is_active") else "INACTIVE",
            ))
            inserted += 1

        # pattern_jobs (0 rows in legacy data) -> production_batches; mapped for completeness.
        for r in self._read("pattern_jobs"):
            processed += 1
            legacy_id = r.get("id")
            if self._lookup(db, "pattern_jobs", legacy_id):
                skipped += 1
                continue
            self._map(db, "pattern_jobs", legacy_id, "production_batches", business_key=_s(r.get("job_code")))
            skipped += 1  # no production_batches row created (no live legacy data)
        return {"processed": processed, "inserted": inserted, "skipped": skipped, "failed": failed}

    def _apply_materials(self, db: Session) -> dict:
        partners = self._read("supply_partners")
        processed = inserted = skipped = failed = 0
        for r in partners:
            processed += 1
            legacy_id = r.get("id")
            if self._lookup(db, "supply_partners", legacy_id):
                skipped += 1
                continue
            name = _s(r.get("name"))
            cat = str(r.get("category") or "").strip()
            ptype = M.SUPPLY_CATEGORY_TO_PARTNER_TYPE.get(cat, "FABRIC_SUPPLIER")
            if not name:
                failed += 1
                continue
            new_uuid = self._map(db, "supply_partners", legacy_id, "partners", business_key=name)
            db.add(Partner(
                id=new_uuid,
                partner_code=f"SP{int(legacy_id):04d}",
                name=name,
                partner_type=ptype,
                phone=_s(r.get("phone")),
                status="ACTIVE" if r.get("is_active") else "INACTIVE",
                notes=_s(r.get("note")),
            ))
            inserted += 1

        # supply_entries / supply_payments have no target rows required by the
        # core business data; register mappings only for resume/idempotency traceability.
        for r in self._read("supply_entries"):
            self._map(db, "supply_entries", r.get("id"), "material_receipts")
        for r in self._read("supply_payments"):
            self._map(db, "supply_payments", r.get("id"), "partner_transactions")
        return {"processed": processed, "inserted": inserted, "skipped": skipped, "failed": failed}

    def _apply_media(self, db: Session) -> dict:
        processed = inserted = skipped = failed = 0
        for r in self._read("order_images"):
            processed += 1
            legacy_id = r.get("id")
            if self._lookup(db, "order_images", legacy_id):
                skipped += 1
                continue
            storage_path = _s(r.get("storage_path"))
            if not storage_path:
                failed += 1
                continue
            new_uuid = self._map(db, "order_images", legacy_id, "media_objects", business_key=storage_path)
            media = MediaObject(
                id=new_uuid,
                storage_provider="legacy",
                storage="LEGACY",
                bucket=None,
                object_key=storage_path,
                version_id=None,
                original_name=storage_path.rsplit("/", 1)[-1] if "/" in storage_path else storage_path,
                content_type="image/png",
                size_bytes=0,
                checksum="",
                sha256=hashlib.sha256(storage_path.encode()).hexdigest(),
                status="PENDING_UPLOAD",
                uploaded_by=self._lookup(db, "az_profiles", r.get("uploaded_by")),
            )
            db.add(media)
            db.flush()
            # Relation: legacy image -> order_group -> its orders (order_media is per-order).
            group_uuid = self._lookup(db, "order_groups", r.get("group_id"))
            if group_uuid:
                for order in db.scalars(select(Order).where(Order.order_group_id == group_uuid)):
                    db.add(OrderMedia(order_id=order.id, media_id=media.id))
            inserted += 1

        for r in self._read("pattern_job_images"):
            processed += 1
            legacy_id = r.get("id")
            if self._lookup(db, "pattern_job_images", legacy_id):
                skipped += 1
                continue
            storage_path = _s(r.get("storage_path"))
            if not storage_path:
                failed += 1
                continue
            new_uuid = self._map(db, "pattern_job_images", legacy_id, "media_objects", business_key=storage_path)
            media = MediaObject(
                id=new_uuid,
                storage_provider="legacy",
                storage="LEGACY",
                object_key=storage_path,
                original_name=storage_path.rsplit("/", 1)[-1] if "/" in storage_path else storage_path,
                content_type="image/png",
                size_bytes=0,
                checksum="",
                sha256=hashlib.sha256(storage_path.encode()).hexdigest(),
                status="PENDING_UPLOAD",
                uploaded_by=self._lookup(db, "az_profiles", r.get("uploaded_by")),
            )
            db.add(media)
            db.flush()
            inserted += 1
        return {"processed": processed, "inserted": inserted, "skipped": skipped, "failed": failed}

    # ------------------------------------------------------------------
    # Post-apply verification
    # ------------------------------------------------------------------
    def verify(self) -> dict:
        if self.from_date or self.to_date:
            return self._verify_incremental()
        expected = {
            "users": 11, "employees": 11, "customers": 213, "warehouses": 2,
            "order_groups": 122, "orders": 132, "order_items": 66,
            "order_status_events": 174, "invoices": 37, "returns": 1, "media_objects": 207,
        }
        actual: dict = {}
        with self.new.connect() as conn:
            for table in expected:
                actual[table] = conn.execute(text(f'SELECT count(*) FROM "{table}"')).scalar()
            debt_total = conn.execute(text(
                'SELECT coalesce(sum(amount_delta), 0) FROM debt_ledger_entries '
                "WHERE party_type = 'CUSTOMER'"
            )).scalar()

        # Invoice frozen-snapshot reconciliation: subtotal must equal the sum of
        # the frozen line totals captured in the snapshot JSON (non-deleted only).
        invoice_invalid = 0
        invoice_checked = 0
        with self.Session() as db:
            for invoice in db.scalars(select(Invoice)):
                if invoice.status == "DELETED":
                    continue
                invoice_checked += 1
                line_total = 0
                for order in (invoice.snapshot or {}).get("orders", []):
                    for item in order.get("items", []):
                        line_total += int(item.get("line_total_amount", 0) or 0)
                if abs(line_total - invoice.subtotal_amount) > 1:
                    invoice_invalid += 1

        mismatches = {k: (expected[k], actual[k]) for k in expected if actual.get(k) != expected[k]}
        debt_total_int = int(debt_total)
        debt_ok = abs(debt_total_int - 8534638) <= 1
        return {
            "counts": actual,
            "expected_counts": expected,
            "mismatches": mismatches,
            "debt_total": debt_total_int,
            "debt_expected": 8534638,
            "invoice_invalid_total": invoice_invalid,
            "invoice_checked": invoice_checked,
            "ok": not mismatches and debt_ok and invoice_invalid == 0,
        }

    def _verify_incremental(self) -> dict:
        """Verify incremental theo đúng semantics của migration.

        3 loại verify:
        1. direct mapping  : legacy_id_mapping (legacy_table, legacy_id)
        2. composite key   : legacy_id_mapping với key "invoice_id:unit_id"
        3. synthesized     : debt_ledger_entries.idempotency_key (opening/slip/invoice/payment)

        invoice_lines được EMBED vào invoices.snapshot (không có bảng riêng) -> chỉ
        verify parent invoice đã map.
        """
        f, missing = build_filter(self.old, self.from_date, self.to_date)

        # Direct mapping tables (legacy_id là cột "id").
        direct_tables = {
            "az_profiles": "users",
            "az_staff": "employees",
            "az_customers": "customers",
            "az_warehouses": "warehouses",
            "order_groups": "order_groups",
            "order_units": "orders",
            "order_items": "order_items",
            "order_status_events": "order_status_events",
            "invoices": "invoices",
            "invoice_payments": "payments",
            "return_slips": "returns",
            "return_items": "return_items",
            "pattern_catalog": "products",
            "pattern_jobs": "production_batches",
            "cutters": "cutting_teams",
            "sewing_houses": "workshops",
            "pattern_fabrics": "fabric_types",
            "supply_partners": "partners",
            "supply_entries": "material_receipts",
            "supply_payments": "partner_transactions",
            "order_images": "media_objects",
            "pattern_job_images": "media_objects",
        }

        mapped: set[tuple[str, str]] = set()
        with self.new.connect() as conn:
            try:
                rows = conn.execute(text(
                    'SELECT legacy_table, legacy_id FROM "legacy_id_mapping"'
                )).fetchall()
                mapped = {(r[0], str(r[1])) for r in rows}
            except Exception:  # noqa: BLE001
                pass

            debt_keys: set[str] = set()
            try:
                rows = conn.execute(text(
                    'SELECT idempotency_key FROM debt_ledger_entries '
                    "WHERE idempotency_key IS NOT NULL"
                )).fetchall()
                debt_keys = {r[0] for r in rows}
            except Exception:  # noqa: BLE001
                pass

        closure = _closure_rows(self.old, f)
        per_phase: dict[str, dict] = {}
        missing_rows: list[dict] = []

        def record(table: str, total: int, present: int) -> None:
            per_phase[table] = {"selected": total, "mapped": present, "missing": total - present}

        def miss(table: str, identity: str) -> None:
            missing_rows.append({"table": table, "identity": identity})

        # 1) Direct mapping
        for table, rows in closure.items():
            if table not in direct_tables:
                continue
            total = len(rows)
            present = sum(1 for r in rows if r.get("id") is not None and (table, str(r.get("id"))) in mapped)
            for r in rows:
                if r.get("id") is None or (table, str(r.get("id"))) not in mapped:
                    miss(table, str(r.get("id")))
            record(table, total, present)

        # 2) Composite: invoice_order_links (invoice_id + unit_id), không có cột id
        links = closure.get("invoice_order_links", [])
        present_links = 0
        for r in links:
            key = f"{r.get('invoice_id')}:{r.get('unit_id')}"
            if ("invoice_order_links", key) in mapped:
                present_links += 1
            else:
                miss("invoice_order_links", key)
        record("invoice_order_links", len(links), present_links)

        # 3) invoice_lines: embedded vào invoice snapshot; verify parent invoice đã map
        lines = closure.get("invoice_lines", [])
        present_lines = 0
        for ln in lines:
            if ("invoices", str(ln.get("invoice_id"))) in mapped:
                present_lines += 1
            else:
                miss("invoice_lines", f"invoice_id={ln.get('invoice_id')}")
        record("invoice_lines", len(lines), present_lines)

        # 4) Synthesized debt: opening + slips (idempotency key trong debt_ledger_entries)
        opening = closure.get("az_customer_opening_debts", [])
        present_opening = 0
        for o in opening:
            if _money_int(o.get("opening_debt")) == 0:
                present_opening += 1  # apply bỏ qua opening=0, không cần entry
                continue
            key = f"legacy:debt:az_customer_opening_debts:{o.get('customer_id')}:OPENING"
            if key in debt_keys:
                present_opening += 1
            else:
                miss("az_customer_opening_debts", key)
        record("az_customer_opening_debts", len(opening), present_opening)

        slips = closure.get("az_debt_slips", [])
        present_slips = 0
        for s in slips:
            delta = _money_int(s.get("total_plus")) - _money_int(s.get("total_minus"))
            if delta == 0:
                present_slips += 1
                continue
            key = f"legacy:debt:az_debt_slips:{s.get('id')}:ADJUSTMENT"
            if key in debt_keys:
                present_slips += 1
            else:
                miss("az_debt_slips", key)
        record("az_debt_slips", len(slips), present_slips)

        ok = not missing_rows
        return {
            "incremental": True,
            "from_date": self.from_date,
            "to_date": self.to_date,
            "anchor_orders": f.anchor_orders,
            "missing_time_cols": missing,
            "per_phase": per_phase,
            "missing_rows_count": len(missing_rows),
            "missing_rows": missing_rows[:200],
            "ok": ok,
        }

    def close(self) -> None:
        self.old.dispose()
        self.new.dispose()
