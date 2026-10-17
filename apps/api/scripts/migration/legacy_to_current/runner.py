"""Orchestrate the DRY-RUN legacy -> current migration and build the report."""
from __future__ import annotations

import uuid
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import create_engine, text

from . import mappings as M
from .idmap import IdMap, LEGACY_ID_MAPPING_TABLE
from .old import read_all
from .incremental import RowFilter, build_filter


def _money(value) -> Decimal:
    try:
        if value is None:
            return Decimal("0")
        return Decimal(str(value))
    except Exception:  # noqa: BLE001
        return Decimal("0")


def _s(value) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    return s or None


def _debt_synth_keys(opening: list[dict], slips: list[dict], invoices: list[dict], payments: list[dict]) -> set[str]:
    """Tái tạo idempotency keys mà _apply_debt sẽ INSERT (read-only, để đối chiếu NEW)."""
    keys: set[str] = set()
    for o in opening:
        if float(_money(o.get("opening_debt"))) == 0:
            continue
        keys.add(f"legacy:debt:az_customer_opening_debts:{o.get('customer_id')}:OPENING")
    pay_by_invoice: dict = defaultdict(list)
    for p in payments:
        pay_by_invoice[p.get("invoice_id")].append(p)
    for inv in invoices:
        if str(inv.get("status") or "").strip() != "DA_GUI":
            continue
        keys.add(f"legacy:debt:invoices:{inv.get('id')}:INVOICE")
        for p in pay_by_invoice.get(inv.get("id"), []):
            raw = str(p.get("method") or "").strip()
            amt = float(_money(p.get("amount")))
            if raw == "CONG_THEM" and amt:
                keys.add(f"legacy:debt:invoice_payments:{p.get('id')}:SURCHARGE")
            elif raw == "HANG_TRA" and amt:
                keys.add(f"legacy:debt:invoice_payments:{p.get('id')}:RETURN_CREDIT")
            elif raw not in ("CONG_THEM", "HANG_TRA") and amt:
                keys.add(f"legacy:debt:invoice_payments:{p.get('id')}:PAYMENT")
    for s in slips:
        delta = float(_money(s.get("total_plus"))) - float(_money(s.get("total_minus")))
        if delta == 0:
            continue
        keys.add(f"legacy:debt:az_debt_slips:{s.get('id')}:ADJUSTMENT")
    return keys


class Runner:
    def __init__(self, old_url: str, new_url: str, *, from_date: str | None = None, to_date: str | None = None) -> None:
        self.old = create_engine(old_url, pool_pre_ping=True, future=True)
        self.new = create_engine(new_url, pool_pre_ping=True, future=True)
        self.from_date = from_date
        self.to_date = to_date
        self.row_filter: RowFilter | None = None
        self.missing_time_cols: dict[str, list[str]] = {}
        self.idmap = IdMap()
        self.unmapped_status: list[dict] = []
        self.missing_customer: list[dict] = []
        self.missing_relation: list[dict] = []
        self.orphans: list[dict] = []
        self.status_conflicts: list[dict] = []
        self.debt_differences: list[dict] = []
        self.risks: list[str] = []
        self.extra: dict[str, list[dict]] = defaultdict(list)
        self.sections: dict[str, dict] = {}
        self._group_fields: dict = {}
        self.payment_unmapped: list[dict] = []
        self.debt_details: list[dict] = []
        self.invoice_line_details: list[dict] = []
        self.invalid_invoice_lines: list[dict] = []
        self.media_classification: dict[str, int] = {
            "media_existing": 0,
            "media_downloadable": 0,
            "media_missing": 0,
            "media_uploaded": 0,
            "media_failed": 0,
        }

    # ------------------------------------------------------------------
    def _section(self, name: str, **fields) -> dict:
        sec = {"source_count": 0, "mapped": 0}
        sec.update(fields)
        self.sections[name] = sec
        return sec

    def _read_new_keys(self, table: str, key_col: str) -> set[str]:
        with self.new.connect() as conn:
            rows = conn.execute(text(f'SELECT "{key_col}" FROM "{table}"')).fetchall()
            return {_s(r[0]) for r in rows if r[0] is not None}

    def _read(self, table: str) -> list[dict]:
        rows = read_all(self.old, table)
        if self.row_filter is not None:
            return self.row_filter.filter_rows(table, rows)
        return rows

    def _prepare_incremental(self) -> None:
        """Khi có --from-date/--to-date, xác định cột thời gian + build RowFilter."""
        self.row_filter, self.missing_time_cols = build_filter(
            self.old, self.from_date, self.to_date
        )
        if self.row_filter is not None:
            self.incremental_range = (self.row_filter.start, self.row_filter.end)

    # ------------------------------------------------------------------
    def run(self) -> dict:
        if self.from_date or self.to_date:
            self._prepare_incremental()
        self._run_users()
        self._run_employees()
        self._run_customers()
        self._run_warehouses()
        self._run_order_groups()
        self._run_orders()
        self._run_order_items()
        self._run_order_status_history()
        self._run_invoices()
        self._run_invoice_lines_and_links()
        self._run_payments()
        self._run_debt()
        self._run_returns()
        self._run_production()
        self._run_materials()
        self._run_media()
        return self.as_dict()

    # ------------------------------------------------------------------
    def _run_users(self) -> None:
        rows = self._read("az_profiles")
        existing = self._read_new_keys("users", "username")
        sec = self._section("USERS", source_count=len(rows), duplicate=0, invalid=0)
        already = 0
        for r in rows:
            legacy_id = r.get("id")  # already a UUID
            login = _s(r.get("login_name"))
            role = M.map_or_unmapped(r.get("role"), M.ROLE_MAP)
            if not login:
                sec["invalid"] += 1
                self.extra["invalid_user"].append({"legacy_id": str(legacy_id), "reason": "login_name null"})
                continue
            if login in existing:
                already += 1
            self.idmap.add("az_profiles", legacy_id, "users", business_key=login, new_uuid=legacy_id)
            if role == M.UNMAPPED_STATUS:
                self.unmapped_status.append({"table": "az_profiles", "legacy_id": str(legacy_id), "field": "role", "raw": str(r.get("role"))})
        sec["mapped"] = len(rows) - sec["invalid"]
        sec["already_exists"] = already
        sec["will_insert"] = max(0, sec["mapped"] - already)

    def _run_employees(self) -> None:
        rows = self._read("az_staff")
        existing = self._read_new_keys("employees", "employee_code")
        sec = self._section("EMPLOYEES", source_count=len(rows), invalid=0)
        already = 0
        for r in rows:
            legacy_id = r.get("id")
            code = f"NV{int(legacy_id):04d}"
            if code in existing:
                already += 1
            status = M.map_or_unmapped(r.get("status"), M.STAFF_STATUS_MAP)
            self.idmap.add("az_staff", legacy_id, "employees", business_key=code)
            if status == M.UNMAPPED_STATUS:
                self.unmapped_status.append({"table": "az_staff", "legacy_id": str(legacy_id), "field": "status", "raw": str(r.get("status"))})
        sec["mapped"] = len(rows)
        sec["already_exists"] = already
        sec["will_insert"] = max(0, sec["mapped"] - already)

    def _run_customers(self) -> None:
        rows = self._read("az_customers")
        existing = self._read_new_keys("customers", "customer_code")
        # The real legacy business key is az_customer_opening_debts.legacy_code
        # (az_customers.customer_code is a regenerated internal "KH000NNN").
        opening = self._read("az_customer_opening_debts")
        legacy_code_by_customer: dict = {
            r.get("customer_id"): _s(r.get("legacy_code")) for r in opening
        }
        seen: dict[str, int] = defaultdict(int)
        sec = self._section("CUSTOMERS", source_count=len(rows), duplicate=0, invalid=0)
        for r in rows:
            legacy_id = r.get("id")
            generated = _s(r.get("customer_code"))
            code = legacy_code_by_customer.get(legacy_id) or generated
            name = _s(r.get("name"))
            if code in seen:
                seen[code] += 1
                continue
            seen[code] = 1
            if not code or not name:
                sec["invalid"] += 1
                self.extra["invalid_customer"].append({"legacy_id": str(legacy_id), "reason": "missing code/name"})
                continue
            new_uuid = self.idmap.add("az_customers", legacy_id, "customers", business_key=code)
            if code in existing:
                self.extra["customer_exists_in_new"].append(code)
            if code != generated:
                self.extra["customer_code_normalized"].append({"legacy_id": str(legacy_id), "generated": generated, "legacy_code": code})
        # duplicates = customers whose code appeared more than once
        sec["duplicate"] = sum(1 for c in seen.values() if c > 1)
        sec["mapped"] = len(rows) - sec["invalid"] - sec["duplicate"]
        sec["already_exists"] = sum(1 for c in seen if c in existing)
        sec["will_insert"] = max(0, sec["mapped"] - sec["already_exists"])

    def _run_warehouses(self) -> None:
        rows = self._read("az_warehouses")
        existing = self._read_new_keys("warehouses", "code")
        sec = self._section("WAREHOUSE", source_count=len(rows))
        already = 0
        for r in rows:
            legacy_id = r.get("id")
            code = _s(r.get("code"))
            if code in existing:
                already += 1
            self.idmap.add("az_warehouses", legacy_id, "warehouses", business_key=code)
        sec["mapped"] = len(rows)
        sec["already_exists"] = already
        sec["will_insert"] = max(0, sec["mapped"] - already)

    def _run_order_groups(self) -> None:
        rows = self._read("order_groups")
        self._section("ORDER_GROUPS", source_count=len(rows), mapped=0)
        for r in rows:
            legacy_id = r.get("id")
            self._group_fields[str(legacy_id)] = r
            self.idmap.add("order_groups", legacy_id, "order_groups", business_key=_s(r.get("root_code")))
        self.sections["ORDER_GROUPS"]["mapped"] = len(rows)

    def _run_orders(self) -> None:
        rows = self._read("order_units")
        existing = self._read_new_keys("orders", "order_no")
        seen_orders: set[str] = set()
        sec = self._section("ORDERS", source_count=len(rows), missing_customer=0, unmapped_status=0)
        for r in rows:
            legacy_id = r.get("id")
            order_no = _s(r.get("order_code"))
            if order_no:
                seen_orders.add(order_no)
            status = M.map_or_unmapped(r.get("status"), M.ORDER_STATUS_MAP)
            g = self._group_fields.get(str(r.get("group_id") or ""))
            customer_id = g.get("customer_id") if g else None
            customer_uuid = self.idmap.uuid("az_customers", customer_id)
            self.idmap.add("order_units", legacy_id, "orders", business_key=order_no)
            if customer_uuid is None:
                sec["missing_customer"] += 1
                self.missing_customer.append({"table": "order_units", "legacy_id": str(legacy_id), "order_no": order_no, "customer_id": str(customer_id or "")})
            if status == M.UNMAPPED_STATUS:
                sec["unmapped_status"] += 1
                self.unmapped_status.append({"table": "order_units", "legacy_id": str(legacy_id), "field": "status", "raw": str(r.get("status")), "order_no": order_no})
        sec["mapped"] = len(rows) - sec["missing_customer"] - sec["unmapped_status"]
        sec["already_exists"] = sum(1 for no in seen_orders if no in existing)
        sec["will_insert"] = max(0, sec["mapped"] - sec["already_exists"])

    def _run_order_items(self) -> None:
        rows = self._read("order_items")
        sec = self._section("ORDER_ITEMS", source_count=len(rows), orphan=0)
        for r in rows:
            legacy_id = r.get("id")
            order_uuid = self.idmap.uuid("order_units", r.get("unit_id"))
            self.idmap.add("order_items", legacy_id, "order_items")
            if order_uuid is None:
                sec["orphan"] += 1
                self.orphans.append({"table": "order_items", "legacy_id": str(legacy_id), "unit_id": str(r.get("unit_id") or "")})
        sec["mapped"] = len(rows) - sec["orphan"]

    def _run_order_status_history(self) -> None:
        rows = self._read("order_status_events")
        sec = self._section("ORDER_STATUS_HISTORY", source_count=len(rows), orphan=0, unmapped_status=0)
        for r in rows:
            legacy_id = r.get("id")
            order_uuid = self.idmap.uuid("order_units", r.get("unit_id"))
            self.idmap.add("order_status_events", legacy_id, "order_status_events")
            if order_uuid is None:
                sec["orphan"] += 1
                self.orphans.append({"table": "order_status_events", "legacy_id": str(legacy_id), "unit_id": str(r.get("unit_id") or "")})
            for field, mp in (("from_status", M.ORDER_STATUS_MAP), ("to_status", M.ORDER_STATUS_MAP)):
                raw = r.get(field)
                if raw is not None and str(raw) not in mp:
                    sec["unmapped_status"] += 1
                    self.unmapped_status.append({"table": "order_status_events", "legacy_id": str(legacy_id), "field": field, "raw": str(raw)})
        sec["mapped"] = len(rows) - sec["orphan"]

    def _run_invoices(self) -> None:
        rows = self._read("invoices")
        sec = self._section("INVOICES", source_count=len(rows), invalid_link=0, unmapped_status=0)
        for r in rows:
            legacy_id = r.get("id")
            invoice_no = _s(r.get("invoice_code"))
            status = M.map_or_unmapped(r.get("status"), M.INVOICE_STATUS_MAP)
            customer_uuid = self.idmap.uuid("az_customers", r.get("customer_id"))
            self.idmap.add("invoices", legacy_id, "invoices", business_key=invoice_no)
            if customer_uuid is None:
                sec["invalid_link"] += 1
                self.missing_customer.append({"table": "invoices", "legacy_id": str(legacy_id), "invoice_no": invoice_no, "customer_id": str(r.get("customer_id") or "")})
            if status == M.UNMAPPED_STATUS:
                sec["unmapped_status"] += 1
                self.unmapped_status.append({"table": "invoices", "legacy_id": str(legacy_id), "field": "status", "raw": str(r.get("status")), "invoice_no": invoice_no})
        sec["mapped"] = len(rows) - sec["invalid_link"]

    def _run_invoice_lines_and_links(self) -> None:
        # Legacy invoice_lines is the FROZEN invoice snapshot (source_item_id -> order_items.id).
        # NEW has no invoice_lines table: lines live inside invoice.snapshot["orders"][].items[]
        # and invoice_orders links invoice -> order. Reconstruct from the frozen table, not
        # from current order_items (which drift after post-invoice edits).
        lines = self._read("invoice_lines")
        links = self._read("invoice_order_links")
        invoices = self._read("invoices")

        link_by_invoice: dict = defaultdict(list)
        for r in links:
            link_by_invoice[r.get("invoice_id")].append(r.get("unit_id"))
        line_by_invoice: dict = defaultdict(list)
        for r in lines:
            line_by_invoice[r.get("invoice_id")].append(r)

        sec = self._section("INVOICE_LINES", source_count=len(lines) + len(links), mapped=0, invalid_link=0, invalid_total=0)

        for inv in invoices:
            inv_id = inv.get("id")
            invoice_code = _s(inv.get("invoice_code"))
            subtotal = float(_money(inv.get("subtotal")))
            inv_lines = line_by_invoice.get(inv_id, [])
            inv_links = link_by_invoice.get(inv_id, [])
            line_total = float(sum((_money(r.get("line_total")) for r in inv_lines), Decimal("0")))
            diff = round(subtotal - line_total, 2)
            detail = {
                "invoice_id": str(inv_id),
                "invoice_code": invoice_code,
                "linked_order_ids": sorted(str(u) for u in inv_links),
                "source_order_item_count": len(inv_lines),
                "generated_invoice_line_count": len(inv_lines),
                "source_subtotal": subtotal,
                "generated_line_total": line_total,
                "difference": diff,
            }
            self.invoice_line_details.append(detail)
            if abs(diff) > 0.005:
                detail["reason"] = "line_total mismatch vs subtotal"
                self.invalid_invoice_lines.append(detail)
                sec["invalid_total"] += 1

        for r in links:
            invoice_uuid = self.idmap.uuid("invoices", r.get("invoice_id"))
            order_uuid = self.idmap.uuid("order_units", r.get("unit_id"))
            if invoice_uuid is None or order_uuid is None:
                sec["invalid_link"] += 1
                self.extra["invalid_invoice_order_link"].append({"invoice_id": str(r.get("invoice_id") or ""), "unit_id": str(r.get("unit_id") or "")})
            else:
                self.idmap.add("invoice_order_links", f"{r.get('invoice_id')}:{r.get('unit_id')}", "invoice_orders")
        for r in lines:
            self.idmap.add("invoice_lines", r.get("id"), "invoice_lines_snapshot")
        sec["mapped"] = (len(lines) + len(links)) - sec["invalid_link"] - sec["invalid_total"]

    def _run_payments(self) -> None:
        rows = self._read("invoice_payments")
        sec = self._section("PAYMENTS", source_count=len(rows), unmapped_method=0, surcharge_count=0)
        for r in rows:
            legacy_id = r.get("id")
            raw = str(r.get("method") or "").strip()
            method = M.PAYMENT_METHOD_MAP.get(raw)
            entry_type = M.INVOICE_PAYMENT_DEBT_ENTRY_TYPE.get(raw)
            if method is not None:
                self.idmap.add("invoice_payments", legacy_id, "payments")
            elif entry_type is not None:
                # CONG_THEM -> debt SURCHARGE entry; HANG_TRA -> RETURN_CREDIT entry.
                self.idmap.add("invoice_payments", legacy_id, "debt_ledger_entries")
                if entry_type == "SURCHARGE":
                    sec["surcharge_count"] += 1
            else:
                sec["unmapped_method"] += 1
                self.payment_unmapped.append({
                    "legacy_id": str(legacy_id),
                    "invoice_id": str(r.get("invoice_id") or ""),
                    "method": raw,
                    "amount": str(r.get("amount") or ""),
                })
                self.unmapped_status.append({"table": "invoice_payments", "legacy_id": str(legacy_id), "field": "method", "raw": raw})
        sec["mapped"] = len(rows) - sec["unmapped_method"]

    # ------------------------------------------------------------------
    def _run_debt(self) -> None:
        # Legacy business rule (az_customer_balance):
        #   balance = opening_debt
        #           + SUM[DA_GUI invoices]( subtotal
        #                + SUM payments(CONG_THEM ? +amount : -amount) )
        #           + SUM[debt_slips]( total_plus - total_minus )
        opening = self._read("az_customer_opening_debts")
        slips = self._read("az_debt_slips")
        invoices = self._read("invoices")
        payments = self._read("invoice_payments")
        customers = self._read("az_customers")

        name_by_id = {r.get("id"): _s(r.get("name")) for r in customers}
        opening_by_customer: dict = defaultdict(lambda: Decimal("0"))
        opening_code_by_customer: dict = {}
        for r in opening:
            cid = r.get("customer_id")
            opening_by_customer[cid] += _money(r.get("opening_debt"))
            opening_code_by_customer[cid] = _s(r.get("legacy_code"))

        # payment effect per invoice: CONG_THEM increases debt, everything else decreases
        pay_effect_by_invoice: dict = defaultdict(lambda: Decimal("0"))
        pay_lines_by_invoice: dict = defaultdict(list)
        for p in payments:
            raw = str(p.get("method") or "").strip()
            amt = _money(p.get("amount"))
            if raw == "CONG_THEM":
                pay_effect_by_invoice[p.get("invoice_id")] += amt
            else:
                pay_effect_by_invoice[p.get("invoice_id")] -= amt
            pay_lines_by_invoice[p.get("invoice_id")].append({
                "id": p.get("id"), "method": raw, "amount": float(amt),
                "return_slip_id": p.get("return_slip_id"),
            })

        invoice_lines_by_customer: dict = defaultdict(list)
        invoice_effect_by_customer: dict = defaultdict(lambda: Decimal("0"))
        for i in invoices:
            if str(i.get("status") or "").strip() != "DA_GUI":
                continue
            cid = i.get("customer_id")
            subtotal = _money(i.get("subtotal"))
            pay_effect = pay_effect_by_invoice.get(i.get("id"), Decimal("0"))
            effect = subtotal + pay_effect
            invoice_effect_by_customer[cid] += effect
            invoice_lines_by_customer[cid].append({
                "invoice_id": i.get("id"),
                "invoice_code": _s(i.get("invoice_code")),
                "subtotal": float(subtotal),
                "payment_effect": float(pay_effect),
                "net_effect": float(effect),
                "payments": pay_lines_by_invoice.get(i.get("id"), []),
            })

        slip_lines_by_customer: dict = defaultdict(list)
        slip_effect_by_customer: dict = defaultdict(lambda: Decimal("0"))
        for s in slips:
            cid = s.get("customer_id")
            plus = _money(s.get("total_plus"))
            minus = _money(s.get("total_minus"))
            effect = plus - minus
            slip_effect_by_customer[cid] += effect
            slip_lines_by_customer[cid].append({
                "slip_id": s.get("id"),
                "slip_code": _s(s.get("slip_code")),
                "old_balance": float(_money(s.get("old_balance"))),
                "new_balance": float(_money(s.get("new_balance"))),
                "total_plus": float(plus),
                "total_minus": float(minus),
                "return_slip_id": s.get("return_slip_id"),
            })

        customer_ids = set(opening_by_customer) | set(invoice_effect_by_customer) | set(slip_effect_by_customer)
        old_total = Decimal("0")
        projected_total = Decimal("0")
        details: list[dict] = []
        for cid in sorted(customer_ids, key=str):
            opening_amt = opening_by_customer.get(cid, Decimal("0"))
            invoice_amt = invoice_effect_by_customer.get(cid, Decimal("0"))
            slip_amt = slip_effect_by_customer.get(cid, Decimal("0"))
            old_balance = opening_amt + invoice_amt + slip_amt
            projected = old_balance  # NEW ledger reproduces the same business rule
            diff = projected - old_balance
            old_total += old_balance
            projected_total += projected
            cid_map = self.idmap.get("az_customers", cid)
            details.append({
                "customer_id": str(cid),
                "customer_code": cid_map["business_key"] if cid_map else None,
                "customer_name": name_by_id.get(cid),
                "opening_debt": float(opening_amt),
                "opening_legacy_code": opening_code_by_customer.get(cid),
                "invoice_effect": float(invoice_amt),
                "slip_effect": float(slip_amt),
                "old_balance": float(old_balance),
                "projected_new_balance": float(projected),
                "difference": float(diff),
                "invoices": invoice_lines_by_customer.get(cid, []),
                "slips": slip_lines_by_customer.get(cid, []),
            })

        differences = [d for d in details if abs(d["difference"]) > 0.005]
        self.debt_differences = differences
        self.debt_details = details

        # Tổng hợp ledger thực tế mà _apply_debt sẽ INSERT (read-only, để báo cáo
        # already_exists / will_insert chính xác, không phải số customer).
        synth_keys = _debt_synth_keys(opening, slips, invoices, payments)
        existing_debt_keys = self._read_new_keys("debt_ledger_entries", "idempotency_key")
        already = sum(1 for k in synth_keys if k in existing_debt_keys)

        sec = self._section(
            "DEBT",
            source_count=len(customer_ids),
            mapped=len(customer_ids) - len(differences),
            customers_checked=len(customer_ids),
            old_total=float(old_total),
            projected_new_total=float(projected_total),
            difference_count=len(differences),
            ledger_rows=len(synth_keys),
            already_exists=already,
            will_insert=max(0, len(synth_keys) - already),
        )

    # ------------------------------------------------------------------
    def _run_returns(self) -> None:
        slips = self._read("return_slips")
        items = self._read("return_items")
        sec = self._section("RETURNS", source_count=len(slips), invalid=0, unmapped_status=0)
        for r in slips:
            legacy_id = r.get("id")
            status = M.map_or_unmapped(r.get("status"), M.RETURN_STATUS_MAP)
            customer_uuid = self.idmap.uuid("az_customers", r.get("customer_id"))
            self.idmap.add("return_slips", legacy_id, "returns", business_key=_s(r.get("slip_code")))
            if customer_uuid is None:
                sec["invalid"] += 1
            if status == M.UNMAPPED_STATUS:
                sec["unmapped_status"] += 1
                self.unmapped_status.append({"table": "return_slips", "legacy_id": str(legacy_id), "field": "status", "raw": str(r.get("status"))})
        for r in items:
            self.idmap.add("return_items", r.get("id"), "return_items")
        sec["mapped"] = len(slips) - sec["invalid"]

    def _run_production(self) -> None:
        catalog = self._read("pattern_catalog")
        jobs = self._read("pattern_jobs")
        cutters = self._read("cutters")
        houses = self._read("sewing_houses")
        fabrics = self._read("pattern_fabrics")
        source = len(catalog) + len(jobs) + len(cutters) + len(houses) + len(fabrics)
        sec = self._section("PRODUCTION", source_count=source)
        for r in catalog:
            self.idmap.add("pattern_catalog", r.get("id"), "products", business_key=_s(r.get("code")))
            self.idmap.add("pattern_catalog_price", r.get("id"), "pattern_prices")
        for r in jobs:
            self.idmap.add("pattern_jobs", r.get("id"), "production_batches", business_key=_s(r.get("job_code")))
        for r in cutters:
            self.idmap.add("cutters", r.get("id"), "cutting_teams", business_key=_s(r.get("name")))
        for r in houses:
            self.idmap.add("sewing_houses", r.get("id"), "workshops", business_key=_s(r.get("name")))
        for r in fabrics:
            self.idmap.add("pattern_fabrics", r.get("id"), "fabric_types", business_key=_s(r.get("name")))
        sec["mapped"] = source

    def _run_materials(self) -> None:
        partners = self._read("supply_partners")
        entries = self._read("supply_entries")
        payments = self._read("supply_payments")
        source = len(partners) + len(entries) + len(payments)
        sec = self._section("MATERIALS", source_count=source, unmapped_category=0)
        for r in partners:
            cat = str(r.get("category") or "").strip()
            ptype = M.SUPPLY_CATEGORY_TO_PARTNER_TYPE.get(cat)
            self.idmap.add("supply_partners", r.get("id"), "partners", business_key=_s(r.get("name")))
            if ptype is None:
                sec["unmapped_category"] += 1
                self.unmapped_status.append({"table": "supply_partners", "legacy_id": str(r.get("id")), "field": "category", "raw": cat})
        for r in entries:
            self.idmap.add("supply_entries", r.get("id"), "material_receipts")
        for r in payments:
            self.idmap.add("supply_payments", r.get("id"), "partner_transactions")
        sec["mapped"] = source - sec["unmapped_category"]

    def _run_media(self) -> None:
        images = self._read("order_images")
        job_images = self._read("pattern_job_images")
        source = len(images) + len(job_images)
        sec = self._section("MEDIA", source_count=source, missing_relation=0)
        for r in images:
            legacy_id = r.get("id")
            group = self.idmap.get("order_groups", r.get("group_id"))
            storage_path = _s(r.get("storage_path"))
            self.idmap.add("order_images", legacy_id, "media_objects", business_key=storage_path)
            # Phase 1: metadata exists (storage_path present). Actual file download is Phase 2.
            if storage_path:
                self.media_classification["media_existing"] += 1
                self.media_classification["media_downloadable"] += 1
            else:
                self.media_classification["media_missing"] += 1
            if group is None:
                sec["missing_relation"] += 1
                self.missing_relation.append({"table": "order_images", "legacy_id": str(legacy_id), "group_id": str(r.get("group_id") or "")})
        for r in job_images:
            legacy_id = r.get("id")
            job = self.idmap.get("pattern_jobs", r.get("job_id"))
            storage_path = _s(r.get("storage_path"))
            self.idmap.add("pattern_job_images", legacy_id, "media_objects", business_key=storage_path)
            if storage_path:
                self.media_classification["media_existing"] += 1
                self.media_classification["media_downloadable"] += 1
            else:
                self.media_classification["media_missing"] += 1
            if job is None:
                sec["missing_relation"] += 1
                self.missing_relation.append({"table": "pattern_job_images", "legacy_id": str(legacy_id), "job_id": str(r.get("job_id") or "")})
        sec["mapped"] = source - sec["missing_relation"]

    # ------------------------------------------------------------------
    def as_dict(self) -> dict:
        self.risks = [
            "users.password_hash is NOT NULL in NEW but legacy has no password: --apply needs a password strategy.",
            "invoice_lines have no dedicated table in NEW; mapped to invoice snapshot JSON + invoice_orders link.",
            "Legacy order_images attach to order_group (many orders); NEW order_media attaches per order.",
            "media phase maps metadata only; R2 upload is a later phase.",
            "Debt is projected from ledger (opening + DA_GUI invoice subtotals + invoice payments/surcharges + debt slips); not copied directly.",
            "Invoice status CHUA_CHOT maps to DRAFT but NEW has a separate invoice_drafts table.",
        ]
        return {
            "sections": self.sections,
            "incremental": self._incremental_summary(),
            "id_map_count": len(self.idmap),
            "id_mapping_table": LEGACY_ID_MAPPING_TABLE,
            "id_mapping": self.idmap.rows(),
            "unmapped_status": self.unmapped_status,
            "status_conflicts": self.status_conflicts,
            "debt_differences": self.debt_differences,
            "debt_details": self.debt_details,
            "payment_unmapped": self.payment_unmapped,
            "invoice_line_details": self.invoice_line_details,
            "invalid_invoice_lines": self.invalid_invoice_lines,
            "media_classification": self.media_classification,
            "orphans": self.orphans,
            "missing_customer": self.missing_customer,
            "missing_relation": self.missing_relation,
            "extra": {k: v for k, v in self.extra.items()},
            "risks": self.risks,
        }

    def _incremental_summary(self) -> dict | None:
        """Trả summary incremental (None nếu chạy full)."""
        if self.row_filter is None:
            return None
        start, end = self.incremental_range
        per_phase: dict[str, dict] = {}
        for name, sec in self.sections.items():
            per_phase[name] = {
                "source_today": sec.get("source_count", 0),
                "already_exists": sec.get("already_exists", 0),
                "will_insert": sec.get("will_insert", sec.get("mapped", 0)),
                "will_update": 0,  # apply hiện insert-only
                "dependencies_added": 0,
                "skipped": sec.get("invalid", 0) + sec.get("orphan", 0) + sec.get("unmapped_status", 0),
                "failed": 0,
            }
        # dependencies_added cho bảng kéo theo anchor (ngoài source_today)
        if self.row_filter.by_id:
            for table, ids in self.row_filter.by_id.items():
                key = table.upper()
                if key in per_phase:
                    per_phase[key]["dependencies_added"] = len(ids)
        return {
            "from_date": start.date().isoformat(),
            "to_date": end.date().isoformat(),
            "anchor_orders": self.row_filter.anchor_orders,
            "missing_time_cols": self.missing_time_cols,
            "per_phase": per_phase,
        }

    def close(self) -> None:
        self.old.dispose()
        self.new.dispose()
