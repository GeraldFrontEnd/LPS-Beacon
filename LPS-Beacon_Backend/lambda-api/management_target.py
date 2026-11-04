"""Management target (MT) vs actual, the P&L summary Finance keeps per fiscal year (4 Nov 2026 meeting).

The page shows one full-year view and the four quarters beside it. Columns: last fiscal year (a), the management
target (b), this fiscal year actual + forecast (c), c - a and c - b. Most lines (cost of sales, staff cost, opex) are
not in any file the system reads, so people type them in; the web app works out the formula lines (gross staff cost,
GP, GP %, total HC, per-HC figures, PCON) and fills what the files do give (revenue from ABCD, average delivery HC from
the capacity plan, last year's HC and staff cost from the MBR headcount file).

The MT column (b) is a set figure from management (4 Nov 2026): every line of it is typed in, including the lines the
page works out for the other columns, and it starts blank.

Typed values are shared by everyone and kept in plan/management_target.json:
    {"cells": {"<FY>|<period>|<column>|<rowId>": {"value", "by", "byName", "at"}}}
      FY      the fiscal year the MT is for, e.g. "FY26" (Apr 2026 - Mar 2027)
      period  "FY" or "Q1".."Q4"
      column  "prior" (a), "mt" (b) or "current" (c)
Money in USD (dollars; costs negative, as on Finance's sheet), headcount in people.
"""
from __future__ import annotations

import re

KEY = "plan/management_target.json"
PERIODS = ("FY", "Q1", "Q2", "Q3", "Q4")
COLUMNS = ("prior", "mt", "current")
# The lines people type in, and the range a value may take. Costs are kept negative: a positive value typed for
# a cost is turned negative (Finance's sheet shows costs as negative numbers).
MONEY_LIMIT = 10_000_000_000
INPUT_ROWS = {
    "revenue": (0, MONEY_LIMIT, 1),
    "cos": (-MONEY_LIMIT, MONEY_LIMIT, -1),
    "perm-staff-cost": (-MONEY_LIMIT, MONEY_LIMIT, -1),
    "secondment-staff-cost": (-MONEY_LIMIT, MONEY_LIMIT, -1),
    "staff-cost-transfer": (-MONEY_LIMIT, MONEY_LIMIT, 1),
    "third-party-cost": (-MONEY_LIMIT, MONEY_LIMIT, -1),
    "hc-secondment": (0, 100_000, 1),
    "hc-permanent": (0, 100_000, 1),
    "opex": (-MONEY_LIMIT, MONEY_LIMIT, -1),
}
# The worked-out lines: typed only in the MT column. Per-HC money in USD, percentages as fractions (0.24 = 24 %).
MT_ONLY_ROWS = {
    "gross-staff-cost": (-MONEY_LIMIT, MONEY_LIMIT, -1),
    "net-staff-cost": (-MONEY_LIMIT, MONEY_LIMIT, 1),
    "gp": (-MONEY_LIMIT, MONEY_LIMIT, 1),
    "gp-pct": (-10, 10, 1),
    "hc-total": (0, 100_000, 1),
    "avg-staff-cost": (-MONEY_LIMIT, MONEY_LIMIT, -1),
    "avg-perm-cost": (-MONEY_LIMIT, MONEY_LIMIT, -1),
    "avg-sec-cost": (-MONEY_LIMIT, MONEY_LIMIT, -1),
    "revenue-per-hc": (-MONEY_LIMIT, MONEY_LIMIT, 1),
    "gp-per-hc": (-MONEY_LIMIT, MONEY_LIMIT, 1),
    "revenue-per-staff-cost": (-1_000, 1_000, 1),
    "pcon": (-MONEY_LIMIT, MONEY_LIMIT, 1),
    "pcon-pct": (-10, 10, 1),
}


class EditError(ValueError):
    pass


def check_edit(body: dict) -> tuple[str, float | None]:
    """{"fiscalYear", "period", "column", "rowId", "value"} -> (cell key, value or None to clear)."""
    fy = str(body.get("fiscalYear") or "")
    period, column, row = str(body.get("period") or ""), str(body.get("column") or ""), str(body.get("rowId") or "")
    if not re.fullmatch(r"FY\d{2}", fy):
        raise EditError("fiscalYear must look like FY26")
    if period not in PERIODS or column not in COLUMNS:
        raise EditError("period must be FY or Q1..Q4 and column prior, mt or current")
    rows = {**INPUT_ROWS, **MT_ONLY_ROWS} if column == "mt" else INPUT_ROWS
    if row not in rows:
        raise EditError(f"{row!r} is worked out, not typed in")
    raw = body.get("value")
    key = f"{fy}|{period}|{column}|{row}"
    if raw is None or raw == "":
        return key, None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        raise EditError("value must be a number")
    low, high, sign = rows[row]
    if sign < 0 and value > 0:
        value = -value
    if not (low <= value <= high) or value != value:
        raise EditError(f"value must be between {low:,} and {high:,}")
    return key, value


def public(doc: dict, user_id: str) -> dict:
    """The cells for the page: value, who typed it and when."""
    return {k: {"value": c["value"], "mine": c.get("by") == user_id, "byName": c.get("byName"), "at": c.get("at")}
            for k, c in (doc.get("cells") or {}).items()}
