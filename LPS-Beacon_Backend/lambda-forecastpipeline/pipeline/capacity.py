"""The capacity plan's inputs: everything the Analysis page and the Dashboard need from the uploaded files,
in one small JSON file the API Lambda reads.

    results/capacity/inputs.json

It is rebuilt whenever a UR report or a staff list is cleaned, after every published run, and on demand
({"mode": "capacity_inputs"}, e.g. after changing pipeline/plan_settings.py). The API Lambda works out the
formula rows (ending headcount, revenue per FTE, cost, margin, quarter and year totals) from it plus the
cells people typed in, so editing a cell needs no pipeline run.

What it holds (all money in USD):
  months               the plan's months (two fiscal years from the first UR month), each marked actual
                       (the UR report has it) or forecast
  settings             per fiscal year: UR targets, day rates in USD (and as given), the SGD rate, the
                       revenue placeholder (see plan_settings.py)
  billableUr           actual Billable UR per month, for all staff and per band (UR report)
  workingDays          standard working days per month (UR report)
  startingHeadcount    headcount per band (staff list), used as the plan's first month
  hiringNeeds          the people the latest published review found must be hired (its hiring gap: demand
                       nobody could be matched to), per month and band, with the roles. They are the plan's
                       default joiners. A need starting in an actual month is moved to the first forecast
                       month (the demand already started unstaffed, so the hire comes as soon as possible).
  headcountBreakdown   today's headcount by employment type, for the Dashboard boxes
  sources, notes       which files were used, and what to know about them
"""
from __future__ import annotations

import datetime as dt

import pandas as pd

from . import fiscal, plan_settings
from .s3io import Store

KEY = "results/capacity/inputs.json"
PERMANENT_TYPES = {"Regular Employee": "regular", "Supplemental-Other": "supplementalOther",
                   "Supplemental-Retiree": "supplementalRetiree"}
SECONDMENT_TYPES = {"Secondment"}
PLAN_FISCAL_YEARS = 2


def _band_key(band) -> str:
    return f"b{int(band)}"


def _source(store: Store, dataset: str) -> dict | None:
    quality = store.read_json_or(f"clean/{dataset}/latest.quality.json", None)
    if not quality:
        return None
    return {"file": str(quality.get("sourceKey") or "").rsplit("/", 1)[-1], "cleanedAt": quality.get("cleanedAt"),
            "warnings": quality.get("warnings") or []}


def _plan_months(first_fy_start: int) -> list[str]:
    start = dt.date(first_fy_start, 4, 1)
    return [fiscal.add_months(start, i).strftime("%Y-%m") for i in range(12 * PLAN_FISCAL_YEARS)]


def _hiring_needs(store: Store, months: list[str], first_forecast: str | None) -> tuple[dict | None, list[str]]:
    """The latest published review's hiring gap, per month and band: {"2026-11": {"b7": {"heads", "roles"}}}."""
    pointer = store.read_json_or("results/latest.json", None)
    if not pointer or not pointer.get("prefix"):
        return None, ["no review has been published yet, so joiners start at 0"]
    key = pointer["prefix"] + "summary/hiring_gap.json"
    if not store.exists(key):
        return None, ["the latest published run has no hiring gap (it did not go through the review), "
                      "so joiners start at 0"]
    by_month: dict[str, dict] = {}
    no_band = moved = outside = 0
    for row in store.read_json(key):
        heads = int(row.get("heads") or 0)
        if heads <= 0:
            continue
        try:
            band = int(row.get("band") or 0)
        except (TypeError, ValueError):
            band = 0
        if band not in range(3, 10):
            no_band += heads
            continue
        month = str(row.get("month") or "")
        if first_forecast and month < first_forecast:
            month, moved = first_forecast, moved + heads
        if month not in months:
            outside += heads
            continue
        cell = by_month.setdefault(month, {}).setdefault(f"b{band}", {"heads": 0, "roles": {}})
        cell["heads"] += heads
        role = str(row.get("role") or "UNMAPPED - FOR REVIEW")
        cell["roles"][role] = cell["roles"].get(role, 0) + heads
    total = sum(c["heads"] for m in by_month.values() for c in m.values())
    published = str(pointer.get("publishedAt") or "")[:10]
    notes = [f"joiners in forecast months default to the {total} people the review published on {published} "
             "found must be hired (its hiring gap); type over a cell to change it"]
    if moved:
        notes.append(f"{moved} of those hires were needed before the first forecast month and are counted in it")
    if no_band:
        notes.append(f"{no_band} hires have no band (grade) and are left out of the joiners")
    if outside:
        notes.append(f"{outside} hires fall after the plan's last month and are left out")
    return {"runId": pointer.get("runId"), "publishedAt": pointer.get("publishedAt"), "byMonth": by_month}, notes


def build(store: Store, today: dt.date | None = None) -> dict:
    today = today or dt.date.today()
    notes: list[str] = []
    sources = {d: _source(store, d) for d in ("bu_ur", "staff_list")}

    billable_ur: dict[str, dict] = {}
    working_days: dict[str, float] = {}
    if sources["bu_ur"]:
        monthly = store.read_table("clean/bu_ur/monthly.json.gz")
        for row in monthly.itertuples(index=False):
            if pd.isna(row.billableUr):
                continue
            key = "all" if pd.isna(row.Band) else _band_key(row.Band)
            billable_ur.setdefault(row.Month, {})[key] = round(float(row.billableUr), 6)
        days = store.read_table("clean/bu_ur/working_days.json.gz")
        working_days = {r.Month: float(r.standardWorkingDays) for r in days.itertuples(index=False)
                        if pd.notna(r.standardWorkingDays)}
    else:
        notes.append("no UR report uploaded yet: there are no actual months, every month uses the targets")

    actual = sorted(billable_ur)
    first = dt.date.fromisoformat(actual[0] + "-01") if actual else today
    first_fy = int(fiscal.fy_label(first)[2:]) + 2000
    months = _plan_months(first_fy)
    month_fy = {m: fiscal.fy_label(dt.date.fromisoformat(m + "-01")) for m in months}

    settings = {}
    for fy in dict.fromkeys(month_fy.values()):
        settings[fy] = plan_settings.resolve(fy)
        if settings[fy].get("basedOn"):
            notes.append(f"{fy} has no settings of its own yet: it uses the {settings[fy]['basedOn']} UR targets, "
                         "day rates and SGD rate")

    starting = None
    breakdown = None
    if sources["staff_list"]:
        by_band = store.read_table("clean/staff_list/headcount_by_band.json.gz")
        starting = {"month": months[0],
                    "bands": {_band_key(r.Band): int(r.headcount) for r in by_band.itertuples(index=False)}}
        by_type = store.read_table("clean/staff_list/headcount_by_type.json.gz")
        counts = {str(r[0]): int(r[1]) for r in by_type.itertuples(index=False)}
        other = {t: n for t, n in counts.items() if t not in PERMANENT_TYPES and t not in SECONDMENT_TYPES}
        cleaned = sources["staff_list"].get("cleanedAt") or ""
        as_of = f"{cleaned[:4]}-{cleaned[4:6]}-{cleaned[6:8]}" if len(cleaned) >= 8 else today.isoformat()
        breakdown = {"asOf": as_of,
                     "permanent": {key: counts.get(t, 0) for t, key in PERMANENT_TYPES.items()},
                     "secondment": sum(counts.get(t, 0) for t in SECONDMENT_TYPES),
                     "otherTypes": other}
        if other:
            notes.append("staff of type " + ", ".join(sorted(other)) + " are counted in the headcount by band but "
                         "not in the permanent or secondment boxes")
        notes.append(f"the starting headcount ({months[0]}) is the staff list as uploaded, not a month-end snapshot")
    else:
        notes.append("no staff list uploaded yet: the starting headcount is empty")

    first_forecast = next((m for m in months if m not in billable_ur), None)
    hiring, hiring_notes = _hiring_needs(store, months, first_forecast)
    notes.extend(hiring_notes)

    return {
        "version": 1, "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "currency": "USD",
        "months": [{"month": m, "fiscalYear": month_fy[m], "actual": m in billable_ur} for m in months],
        "settings": settings,
        "billableUr": billable_ur,
        "workingDays": working_days,
        "startingHeadcount": starting,
        "hiringNeeds": hiring,
        "headcountBreakdown": breakdown,
        "sources": sources,
        "notes": notes,
    }


def write(store: Store) -> dict:
    inputs = build(store)
    store.write_json(KEY, inputs)
    return inputs
