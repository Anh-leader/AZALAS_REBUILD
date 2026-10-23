"""Repair customer OPENING debt ledger entries to match OLD's current debt.

Root cause of the "công nợ" drift between OLD and NEW:

  - OLD keeps a per-customer "old debt" (``az_customer_opening_debts.opening_debt``)
    that is *corrected over time*: when an invoice is finalized, OLD writes an
    ``old_debt_override`` + ``old_debt_applied_delta`` on the invoice and bumps the
    customer's opening debt to the corrected value.
  - The migration captures ``opening_debt`` once and stores it as an OPENING ledger
    entry keyed idempotently on the customer. Re-running ``--apply`` therefore never
    refreshes a stale OPENING value.

So NEW's OPENING entries drift from OLD for exactly the customers whose opening debt
was corrected after their first migration. Everything else (INVOICE / SURCHARGE /
PAYMENT / ADJUSTMENT) already reconciles 1:1.

This module re-syncs ONLY the OPENING ledger entries (mapped customers only — orders
and customers created natively on NEW are never touched). Idempotent; dry-run by
default.
"""
from __future__ import annotations

import uuid
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from .old import read_query


def _money_int(value) -> int:
    try:
        if value is None:
            return 0
        return int(Decimal(str(value)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    except Exception:  # noqa: BLE001
        return 0


def build_opening_plan(
    old_opening: dict[str, int],
    mapping: dict[str, str],
    current_opening: dict[str, int],
) -> dict:
    """Pure plan builder (testable without a database).

    ``old_opening`` maps legacy customer id (str) -> opening debt (int VND).
    ``mapping`` maps legacy id -> NEW customer uuid (str).
    ``current_opening`` maps NEW customer uuid (str) -> current OPENING amount.

    Returns ``{updates, inserts, missing_mapping}``. NEW-native customers (absent
    from ``mapping``) are reported but never updated.
    """
    updates: list[dict] = []
    inserts: list[dict] = []
    missing_mapping: list[dict] = []
    for legacy_id, target in old_opening.items():
        new_uuid = mapping.get(legacy_id)
        if new_uuid is None:
            if target != 0:
                missing_mapping.append({"legacy_id": legacy_id, "opening_debt": target})
            continue
        cur = current_opening.get(new_uuid)
        if cur is None:
            if target != 0:
                inserts.append(
                    {"party_id": new_uuid, "legacy_id": legacy_id, "amount_delta": target}
                )
            continue
        if cur != target:
            updates.append(
                {"party_id": new_uuid, "legacy_id": legacy_id, "from": cur, "to": target}
            )
    return {"updates": updates, "inserts": inserts, "missing_mapping": missing_mapping}


def repair_opening_debts(old_url: str, new_url: str, *, dry_run: bool = True) -> dict:
    """Re-sync OPENING ledger entries OLD -> NEW. Read-only when ``dry_run``."""
    old = create_engine(old_url, future=True)
    new = create_engine(new_url, future=True)
    try:
        old_opening: dict[str, int] = {}
        for r in read_query(
            old, 'SELECT customer_id, opening_debt FROM az_customer_opening_debts'
        ):
            old_opening[str(r["customer_id"])] = _money_int(r["opening_debt"])

        with new.connect() as conn:
            mapping = {
                str(legacy_id): str(new_uuid)
                for legacy_id, new_uuid in conn.execute(
                    text(
                        "SELECT legacy_id, new_uuid FROM legacy_id_mapping "
                        "WHERE legacy_table = 'az_customers' AND new_table = 'customers'"
                    )
                ).fetchall()
            }
            # SUM (không last-wins) để idempotent: sau khi đã sửa, opening_sum = target
            # nên build_opening_plan tự sinh delta=0 và bỏ qua ở lần chạy sau.
            current_opening: dict[str, int] = {}
            opening_entry_id: dict[str, str] = {}
            for party_id, amount, entry_id in conn.execute(
                text(
                    "SELECT party_id, SUM(amount_delta), (array_agg(id))[1] FROM debt_ledger_entries "
                    "WHERE party_type = 'CUSTOMER' AND entry_type = 'OPENING' "
                    "GROUP BY party_id"
                )
            ).fetchall():
                current_opening[str(party_id)] = int(amount or 0)
                opening_entry_id[str(party_id)] = str(entry_id)

        plan = build_opening_plan(old_opening, mapping, current_opening)
        updates, inserts = plan["updates"], plan["inserts"]

        if dry_run:
            return {
                "dry_run": True,
                "old_opening_customers": len(old_opening),
                "will_update": len(updates),
                "will_insert": len(inserts),
                "missing_mapping": plan["missing_mapping"],
                "updates": updates,
                "inserts": inserts,
            }

        # debt_ledger_entries là append-only (trigger cấm UPDATE/DELETE), nên sửa
        # bằng reversal + re-insert (cả hai đều là INSERT).
        with new.begin() as conn:
            for u in updates:
                rev_id = uuid.uuid4()
                conn.execute(
                    text(
                        "INSERT INTO debt_ledger_entries "
                        "(id, party_type, party_id, entry_type, amount_delta, reference_type, "
                        " reference_id, reversal_of_id, description, occurred_at, idempotency_key) "
                        "VALUES (:id, 'CUSTOMER', :p, 'OPENING', :amt, NULL, NULL, :rev_of, "
                        " 'Opening debt correction (reversal)', now(), :key)"
                    ),
                    {
                        "id": rev_id,
                        "p": u["party_id"],
                        "amt": -u["from"],
                        "rev_of": opening_entry_id.get(u["party_id"]),
                        "key": f"legacy:debt:az_customer_opening_debts:{u['legacy_id']}:OPENING:REVERSAL",
                    },
                )
                corr_id = uuid.uuid4()
                conn.execute(
                    text(
                        "INSERT INTO debt_ledger_entries "
                        "(id, party_type, party_id, entry_type, amount_delta, reference_type, "
                        " reference_id, description, occurred_at, idempotency_key) "
                        "VALUES (:id, 'CUSTOMER', :p, 'OPENING', :amt, NULL, NULL, "
                        " 'Opening debt correction', now(), :key)"
                    ),
                    {
                        "id": corr_id,
                        "p": u["party_id"],
                        "amt": u["to"],
                        "key": f"legacy:debt:az_customer_opening_debts:{u['legacy_id']}:OPENING:CORRECTED",
                    },
                )
            for ins in inserts:
                new_uuid = uuid.uuid4()
                conn.execute(
                    text(
                        "INSERT INTO legacy_id_mapping "
                        "(legacy_table, legacy_id, new_table, new_uuid, business_key) "
                        "VALUES ('az_customer_opening_debts', :lid, 'debt_ledger_entries', :u, NULL)"
                    ),
                    {"lid": ins["legacy_id"], "u": new_uuid},
                )
                conn.execute(
                    text(
                        "INSERT INTO debt_ledger_entries "
                        "(id, party_type, party_id, entry_type, amount_delta, reference_type, "
                        " reference_id, description, occurred_at, idempotency_key) "
                        "VALUES (:id, 'CUSTOMER', :p, 'OPENING', :amt, NULL, NULL, "
                        " 'Opening debt (migration repair)', now(), :key)"
                    ),
                    {
                        "id": new_uuid,
                        "p": ins["party_id"],
                        "amt": ins["amount_delta"],
                        "key": f"legacy:debt:az_customer_opening_debts:{ins['legacy_id']}:OPENING:CORRECTED",
                    },
                )

        # Refresh per-customer projection so party_debt_balances stays consistent.
        # Self-heal: recompute cho MỌI customer đã migrate (không chỉ các customer
        # vừa sửa), để lần chạy lại sau khi ledger đã đúng vẫn đồng bộ được cache.
        with new.begin() as conn:
            for party_id in sorted(set(mapping.values())):
                conn.execute(
                    text(
                        "INSERT INTO party_debt_balances "
                        "(id, party_type, party_id, opening, debit, credit, current, version, calculated_at) "
                        "SELECT gen_random_uuid(), 'CUSTOMER', :p, "
                        "  COALESCE(SUM(amount_delta) FILTER (WHERE entry_type='OPENING'), 0), "
                        "  COALESCE(SUM(amount_delta) FILTER (WHERE amount_delta > 0 AND entry_type<>'OPENING'), 0), "
                        "  COALESCE(-SUM(amount_delta) FILTER (WHERE amount_delta < 0), 0), "
                        "  COALESCE(SUM(amount_delta), 0), 1, now() "
                        "FROM debt_ledger_entries WHERE party_type='CUSTOMER' AND party_id=:p2 "
                        "ON CONFLICT (party_type, party_id) DO UPDATE SET "
                        "  opening=EXCLUDED.opening, debit=EXCLUDED.debit, credit=EXCLUDED.credit, "
                        "  current=EXCLUDED.current, version=party_debt_balances.version+1, "
                        "  calculated_at=now()"
                    ),
                    {"p": party_id, "p2": party_id},
                )

        return {
            "dry_run": False,
            "old_opening_customers": len(old_opening),
            "updated": len(updates),
            "inserted": len(inserts),
            "missing_mapping": plan["missing_mapping"],
        }
    finally:
        old.dispose()
        new.dispose()
