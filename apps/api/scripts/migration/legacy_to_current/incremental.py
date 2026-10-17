"""Incremental migration closure: tìm anchor orders trong khoảng ngày và kéo dependency.

Anchor chính = ``order_units`` (order). Khi một order thuộc khoảng ngày, kéo đầy đủ:
- order_groups (via order.group_id) -> az_customers (via group.customer_id)
- order_items (via unit_id)
- order_status_events (via unit_id)
- order_images (via group_id)
- invoices + invoice_lines + invoice_order_links + invoice_payments (link tới order)
- az_customer_opening_debts / az_debt_slips / return_slips / return_items (via customer)

Bảng độc lập còn lại: lọc theo cột thời gian riêng (time_cols).
Bảng KHÔNG xuất hiện trong bất kỳ filter nào = chạy full (không lọc).
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import text
from sqlalchemy.engine import Engine

from .timefields import detect_time_columns, in_range, list_tables, parse_range


class RowFilter:
    """Mô tả cách lọc row cho từng bảng legacy trong incremental mode."""

    def __init__(self, *, start: datetime, end: datetime, time_cols: dict[str, str]) -> None:
        self.start = start
        self.end = end
        self.time_cols = time_cols
        # bảng -> set(str id) kéo theo anchor (lọc theo cột "id")
        self.by_id: dict[str, set[str]] = {}
        # bảng -> (cột, set(str)) lọc theo cột bất kỳ (vd invoice_order_links theo invoice_id)
        self.by_column: dict[str, tuple[str, set[str]]] = {}
        # bảng -> cột thời gian (tự lọc theo time range)
        self.by_time: dict[str, str] = {}
        self.anchor_orders: int = 0

    def include(self, table: str, legacy_id) -> None:
        if legacy_id is None:
            return
        self.by_id.setdefault(table, set()).add(str(legacy_id))

    def include_where(self, table: str, column: str, value) -> None:
        if value is None:
            return
        entry = self.by_column.setdefault(table, (column, set()))
        entry[1].add(str(value))

    def filter_rows(self, table: str, rows: list[dict]) -> list[dict]:
        """Áp dụng bộ lọc lên danh sách row đã đọc."""
        if table in self.by_id:
            allowed = self.by_id[table]
            return [r for r in rows if r.get("id") is not None and str(r.get("id")) in allowed]
        if table in self.by_column:
            column, allowed = self.by_column[table]
            return [r for r in rows if r.get(column) is not None and str(r.get(column)) in allowed]
        time_col = self.by_time.get(table)
        if time_col:
            return [r for r in rows if in_range(r.get(time_col), self.start, self.end)]
        return rows


def _read(engine: Engine, table: str) -> list[dict]:
    with engine.connect() as conn:
        rows = conn.execute(text(f'SELECT * FROM "{table}"')).mappings()
        return [dict(r) for r in rows]


def _ids(rows: list[dict]) -> set[str]:
    return {str(r["id"]) for r in rows if r.get("id") is not None}


def compute_filter(engine: Engine, start: datetime, end: datetime, time_cols: dict[str, str]) -> RowFilter:
    f = RowFilter(start=start, end=end, time_cols=time_cols)

    orders = _read(engine, "order_units")
    invoices = _read(engine, "invoices")
    payments = _read(engine, "invoice_payments")
    slips = _read(engine, "az_debt_slips")
    return_slips = _read(engine, "return_slips")

    # ---- Anchor 1: order_units theo created_at ----
    order_time = time_cols.get("order_units", "created_at")
    anchor_orders = [r for r in orders if in_range(r.get(order_time), start, end)]
    f.anchor_orders = len(anchor_orders)
    for r in anchor_orders:
        f.include("order_units", r.get("id"))
        f.include("order_groups", r.get("group_id"))

    # ---- Anchor 2: invoices theo finalized_at (business timestamp) ----
    inv_time = time_cols.get("invoices", "finalized_at")
    anchor_invoices = [r for r in invoices if in_range(r.get(inv_time), start, end)]
    for r in anchor_invoices:
        f.include("invoices", r.get("id"))
        f.include("az_customers", r.get("customer_id"))

    # ---- Anchor 3: invoice_payments theo created_at (fallback payment_date) ----
    anchor_payments = [
        r for r in payments
        if in_range(r.get("created_at"), start, end)
        or (r.get("created_at") is None and _date_in_range(r.get("payment_date"), start, end))
    ]
    for r in anchor_payments:
        f.include("invoice_payments", r.get("id"))
        f.include("invoices", r.get("invoice_id"))

    # ---- Anchor 4: az_debt_slips theo created_at ----
    for r in slips:
        if in_range(r.get("created_at"), start, end):
            f.include("az_debt_slips", r.get("id"))
            f.include("az_customers", r.get("customer_id"))

    # ---- Anchor 5: return_slips theo created_at ----
    for r in return_slips:
        if in_range(r.get("created_at"), start, end):
            f.include("return_slips", r.get("id"))
            f.include("az_customers", r.get("customer_id"))

    # ---- Transitive dependency ----
    # order_groups -> customers
    groups = {str(r["id"]): r for r in _read(engine, "order_groups") if r.get("id")}
    for gid in list(f.by_id.get("order_groups", set())):
        g = groups.get(gid)
        if g:
            f.include("az_customers", g.get("customer_id"))

    # order_items / order_status_events theo unit_id
    order_ids = f.by_id.get("order_units", set())
    for r in _read(engine, "order_items"):
        if r.get("unit_id") is not None and str(r.get("unit_id")) in order_ids:
            f.include("order_items", r.get("id"))
    for r in _read(engine, "order_status_events"):
        if r.get("unit_id") is not None and str(r.get("unit_id")) in order_ids:
            f.include("order_status_events", r.get("id"))

    # order_images theo group_id
    group_ids = f.by_id.get("order_groups", set())
    for r in _read(engine, "order_images"):
        if r.get("group_id") is not None and str(r.get("group_id")) in group_ids:
            f.include("order_images", r.get("id"))

    # invoices -> invoice_order_links (theo invoice_id) + invoice_lines; và kéo
    # order liên kết của invoice (để order dù cũ vẫn được liên kết invoice đúng).
    invoice_ids = f.by_id.get("invoices", set())
    links = _read(engine, "invoice_order_links")
    for r in links:
        if r.get("invoice_id") is not None and str(r.get("invoice_id")) in invoice_ids:
            f.include_where("invoice_order_links", "invoice_id", r.get("invoice_id"))
            f.include("order_units", r.get("unit_id"))
            # order kéo theo group -> customer
            f.include("order_groups", _group_id_for(orders, r.get("unit_id")))
    for r in _read(engine, "invoice_lines"):
        if r.get("invoice_id") is not None and str(r.get("invoice_id")) in invoice_ids:
            f.include("invoice_lines", r.get("id"))
    # payments trỏ tới invoice trong closure
    for r in payments:
        if r.get("invoice_id") is not None and str(r.get("invoice_id")) in invoice_ids:
            f.include("invoice_payments", r.get("id"))

    # order_groups mới kéo thêm (từ invoice links) -> customer
    for gid in list(f.by_id.get("order_groups", set())):
        g = groups.get(gid)
        if g:
            f.include("az_customers", g.get("customer_id"))

    # debt/returns theo customer trong closure
    customer_ids = f.by_id.get("az_customers", set())
    for cid in customer_ids:
        f.include_where("az_customer_opening_debts", "customer_id", cid)
    for r in slips:
        if r.get("customer_id") is not None and str(r.get("customer_id")) in customer_ids:
            f.include("az_debt_slips", r.get("id"))
    for r in return_slips:
        if r.get("customer_id") is not None and str(r.get("customer_id")) in customer_ids:
            f.include("return_slips", r.get("id"))
    for r in _read(engine, "return_items"):
        if r.get("slip_id") is not None and str(r.get("slip_id")) in f.by_id.get("return_slips", set()):
            f.include("return_items", r.get("id"))

    # Bảng độc lập còn lại: lọc theo thời gian riêng.
    anchored = {"order_units", "invoices", "invoice_payments", "az_debt_slips", "return_slips"}
    for table, col in time_cols.items():
        if table in anchored:
            continue
        if table not in f.by_id and table not in f.by_column:
            f.by_time[table] = col

    return f


def _group_id_for(orders: list[dict], unit_id) -> str | None:
    for r in orders:
        if str(r.get("id")) == str(unit_id):
            gid = r.get("group_id")
            return str(gid) if gid is not None else None
    return None


def _date_in_range(d, start: datetime, end: datetime) -> bool:
    """So sánh cột kiểu DATE (payment_date) với bound datetime theo ngày +07."""
    if d is None:
        return False
    from datetime import date as _date, datetime as _dt
    if isinstance(d, _dt):
        return in_range(d, start, end)
    if isinstance(d, _date):
        day = _dt(d.year, d.month, d.day, 0, 0, 0)
        return start <= day < end
    if isinstance(d, str):
        try:
            return in_range(d, start, end)
        except ValueError:
            return False
    return False


def build_filter(engine: Engine, from_date: str | None, to_date: str | None) -> tuple[RowFilter | None, dict[str, list[str]]]:
    """Shared helper: parse range, detect time columns, compute RowFilter.

    Trả (filter_or_None, missing_time_cols). None khi không chạy incremental.
    """
    if not from_date and not to_date:
        return None, {}
    start, end = parse_range(from_date, to_date)
    tables = list_tables(engine)
    detected, missing = detect_time_columns(engine, tables)
    return compute_filter(engine, start, end, detected), missing
