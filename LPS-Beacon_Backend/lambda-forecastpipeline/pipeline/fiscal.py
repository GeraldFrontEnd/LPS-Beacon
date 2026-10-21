"""Fiscal calendar helpers. The fiscal year runs April to March.

FY26 = April 2026 to March 2027 (checked against matching_result_new.xlsx:
a FY26 resource-plan line ending in "Mar" is last active in 2027-03).
Quarters: Q1 Apr-Jun, Q2 Jul-Sep, Q3 Oct-Dec, Q4 Jan-Mar. H1 = Q1+Q2, H2 = Q3+Q4.
"""
from __future__ import annotations

import datetime as dt
import re

import pandas as pd

FY_MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"]
_MONTH_NUMBER = {name: i for i, name in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], start=1)}
_FY_RE = re.compile(r"^\s*FY\s*'?(\d{2}|\d{4})\s*$", re.IGNORECASE)


def fy_start_year(label) -> int | None:
    """'FY26' -> 2026, 'FY2026' -> 2026, anything else -> None."""
    if label is None or (isinstance(label, float) and pd.isna(label)):
        return None
    match = _FY_RE.match(str(label))
    if not match:
        return None
    year = int(match.group(1))
    return year + 2000 if year < 100 else year


def month_start(fy_label, month_name: str) -> dt.date | None:
    """First day of a fiscal month, e.g. ('FY26', 'Jan') -> 2027-01-01."""
    start = fy_start_year(fy_label)
    if start is None or month_name not in _MONTH_NUMBER:
        return None
    number = _MONTH_NUMBER[month_name]
    year = start if number >= 4 else start + 1
    return dt.date(year, number, 1)


def fy_label(date) -> str:
    year = date.year if date.month >= 4 else date.year - 1
    return f"FY{year % 100:02d}"


def quarter(date) -> str:
    return {4: "Q1", 5: "Q1", 6: "Q1", 7: "Q2", 8: "Q2", 9: "Q2",
            10: "Q3", 11: "Q3", 12: "Q3", 1: "Q4", 2: "Q4", 3: "Q4"}[date.month]


def half(date) -> str:
    return "H1" if quarter(date) in ("Q1", "Q2") else "H2"


def add_months(date: dt.date, months: int) -> dt.date:
    index = date.year * 12 + (date.month - 1) + months
    return dt.date(index // 12, index % 12 + 1, 1)


def add_period_columns(df: pd.DataFrame, date_col: str = "month") -> pd.DataFrame:
    """Adds fy, half, quarter and fy_quarter columns from a month column."""
    dates = pd.to_datetime(df[date_col])
    out = df.copy()
    def column(fn):
        return pd.Series([fn(d) for d in dates], index=df.index, dtype="object")

    out["fy"] = column(fy_label)
    out["half"] = column(half)
    out["quarter"] = column(quarter)
    out["fy_quarter"] = out["fy"].astype(str) + " " + out["quarter"].astype(str)
    return out
