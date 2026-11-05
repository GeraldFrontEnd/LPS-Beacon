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
  startingHeadcount    headcount per band in the plan's first month: staff with a grade on the UR report's first
                       month (else the staff list as uploaded)
  actualFlows          joiners and leavers per month and band from the Workday new hire / leaver reports (the
                       file's Grade column when it has one, else the band found by name on the UR report or staff
                       list; people not found are spread over the
                       bands like that month's headcount). Used for the plan's months that have a report.
  revenue              revenue and cost per month for Singapore delivery (ABCD report): actuals where the ABCD
                       report has them, its forecast after. The Revenue row's default.
  demand               FTE demand per month on won and ongoing work: SL x RP "Project" and "Quote Won" man-days / 18
                       (the backlog the headcount delivers), for "demand vs capacity today" on the Dashboard
  productivity         per agency (customer) and project, this fiscal year to date: revenue (ABCD), HC, FTE actual
                       (clocked, clocking.py), planned FTE (SL x RP "Project" rows), clocked days per head, HC cost
                       at the rate card (iRate), and the ratios; flagged red / green on clocked days per head (15.3 to
                       18) and against the company average (DRAFT thresholds in plan_settings.PRODUCTIVITY)
  actualFte            FTE actual for the organisation per clocked month: all clocked billable days / 18
  roster               results/capacity/roster.json: plan vs actual per person, project and month (clocking.py)
  hiringNeeds          the people the latest published review found must be hired (its hiring gap: demand
                       nobody could be matched to), per month and band, with the roles. They are the plan's
                       default joiners. A need starting in an actual month is moved to the first forecast
                       month (the demand already started unstaffed, so the hire comes as soon as possible).
  headcountBreakdown   today's headcount by employment type, for the Dashboard boxes
  sources, notes       which files were used, and what to know about them
"""
from __future__ import annotations

import calendar
import json
import datetime as dt

import pandas as pd

from . import clocking, fiscal, plan_settings
from .clean import UR_WORKING_DAYS as UR_DAYS
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


# ---------------------------------------------------------------- headcount and flows
def _ur_starting(store: Store) -> tuple[str, dict[str, int]] | None:
    """(first month, staff with a grade per band) from the UR report, or None."""
    if not store.exists("clean/bu_ur/monthly.json.gz"):
        return None
    monthly = store.read_table("clean/bu_ur/monthly.json.gz")
    if "staff" not in monthly.columns or monthly.empty:
        return None
    first = sorted(monthly["Month"].dropna().astype(str))[0]
    rows = monthly[(monthly["Month"].astype(str) == first) & monthly["Band"].notna()]
    return first, {_band_key(r.Band): int(r.staff) for r in rows.itertuples(index=False)}


def _name_bands(store: Store) -> dict[str, int]:
    """nameKey -> band from the staff list and the UR report (the UR report wins: it is monthly)."""
    out: dict[str, int] = {}
    for key in ("clean/staff_list/names.json.gz", "clean/bu_ur/names.json.gz"):
        if store.exists(key):
            for r in store.read_table(key).itertuples(index=False):
                if pd.notna(r.Band):
                    out[str(r.nameKey)] = int(r.Band)
    return out


def _spread(count: int, weights: dict[str, float]) -> dict[str, int]:
    """count people over bands in proportion to weights (largest remainder, so the parts add up to count)."""
    total = sum(weights.values())
    if count <= 0 or total <= 0:
        return {}
    exact = {b: count * w / total for b, w in weights.items()}
    parts = {b: int(v) for b, v in exact.items()}
    for b in sorted(exact, key=lambda b: exact[b] - parts[b], reverse=True)[:count - sum(parts.values())]:
        parts[b] += 1
    return {b: n for b, n in parts.items() if n}


def _actual_flows(store: Store, mix: dict[str, float]) -> tuple[dict | None, list[str]]:
    """{"2026-09": {"joiners": {"b7": 5, ...}, "leavers": {...}, "unbanded": {"joiners": 2, "leavers": 0}}}."""
    key = "clean/workday_hire_leaver/all.json.gz"
    if not store.exists(key):
        return None, ["no Workday new hire / leaver report uploaded yet: joiners come from the hiring gap and "
                      "leavers start at 0"]
    events = store.read_table(key)
    bands = _name_bands(store)
    flows: dict[str, dict] = {}
    unbanded_total = 0
    for (month, kind), group in events.groupby(["Month", "Kind"]):
        found: dict[str, int] = {}
        missing = 0
        own = group["Band"] if "Band" in group.columns else pd.Series([pd.NA] * len(group), index=group.index)
        for k, given in zip(group["nameKey"].astype(str), own):
            # The file's own grade when it has one, else the person's band found by name.
            band = int(given) if pd.notna(given) else bands.get(k)
            if band in range(3, 10):
                found[f"b{band}"] = found.get(f"b{band}", 0) + 1
            else:
                missing += 1
        for b, n in _spread(missing, mix).items():
            found[b] = found.get(b, 0) + n
        cell = flows.setdefault(str(month), {"joiners": {}, "leavers": {}, "unbanded": {"joiners": 0, "leavers": 0}})
        cell[f"{kind}s"] = found
        cell["unbanded"][f"{kind}s"] = missing
        unbanded_total += missing
    months = sorted(flows)
    notes = [f"joiners and leavers for {months[0]} to {months[-1]} come from the Workday reports "
             f"({len(months)} month{'s' if len(months) != 1 else ''}); type over a cell to change it"]
    if unbanded_total:
        notes.append(f"{unbanded_total} Workday joiners/leavers were not found on the UR report or staff list by "
                     "name, so their band is unknown: they are spread over the bands like the headcount")
    return flows, notes


# ---------------------------------------------------------------- revenue and productivity
def _abcd_scope(monthly: pd.DataFrame) -> pd.DataFrame:
    for col, allowed in plan_settings.PRODUCTIVITY["abcdScope"].items():
        if col in monthly.columns:
            monthly = monthly[monthly[col].astype("string").isin(allowed)]
    return monthly


def _revenue(store: Store) -> tuple[dict | None, pd.DataFrame | None, list[str]]:
    key = "clean/abcd/monthly.json.gz"
    if not store.exists(key):
        return None, None, ["no ABCD report with monthly revenue uploaded yet: the Revenue row uses the "
                            "placeholder in the settings"]
    monthly = _abcd_scope(store.read_table(key))
    monthly["Actual"] = monthly["Actual"].astype(bool)
    by_month = monthly.groupby("Month").agg(revenue=("Revenue", "sum"), cost=("Cost", "sum"), actual=("Actual", "max"))
    out = {str(m): {"revenue": round(float(r.revenue), 2), "cost": round(float(r.cost), 2), "actual": bool(r.actual)}
           for m, r in by_month.iterrows()}
    actual = sorted(m for m, v in out.items() if v["actual"])
    scope = ", ".join(f"{c} {'/'.join(v)}" for c, v in plan_settings.PRODUCTIVITY["abcdScope"].items())
    notes = [f"revenue comes from the ABCD report ({scope}): actuals"
             + (f" {actual[0]} to {actual[-1]}" if actual else " none") + ", its forecast after"]
    return out, monthly, notes


def _agency_of(abcd: pd.DataFrame) -> dict[str, str]:
    out: dict[str, str] = {}
    cols = [c for c in plan_settings.PRODUCTIVITY["agencyColumns"] if c in abcd.columns]
    for r in abcd.drop_duplicates("Project_ID").itertuples(index=False):
        for c in cols:
            v = getattr(r, c)
            if isinstance(v, str) and v.strip():
                out[str(r.Project_ID)] = v.strip()
                break
    return out


def _flag(value: float | None, average: float | None, rules: dict) -> str | None:
    if value is None or not average:
        return None
    below = (average - value) / average
    if below > rules["redBelowPct"]:
        return "red"
    if below > rules["amberBelowPct"]:
        return "amber"
    return "green"


def _productivity(store: Store, abcd: pd.DataFrame, settings: dict, working_days: dict[str, float],
                  clocked_months: set[str], rp_full_month_mds: float = 18.0) -> tuple[dict | None, list[str]]:
    """This fiscal year to date, per agency and project (4 Nov 2026 rules):
         headcount     people on it in the latest month (distinct names); headcountAverage = the average a month
         byMonth       the same building blocks per month, so the page can show any month, quarter or the FY
         fte           FTE actual: clocked billable days / 18 (MSPO clocking, else the UR report; clocking.py), averaged
         planFte       SL x RP man-days / 18, averaged
         daysPerHead   clocked billable days per person per month; red below 15.3 or above 18
    Months: the ABCD report's actual months in the latest FY that the UR report also has (so revenue and clocking
    cover the same months). Without a UR report the planned FTE stands in, and the notes say so."""
    actual = sorted(abcd.loc[abcd["Actual"], "Month"].astype(str).unique())
    if not actual:
        return None, ["the ABCD report has no actual months yet, so productivity by agency is not worked out"]
    fy = fiscal.fy_label(dt.date.fromisoformat(actual[-1] + "-01"))
    months = [m for m in actual if fiscal.fy_label(dt.date.fromisoformat(m + "-01")) == fy]
    notes: list[str] = []
    clocked = bool(clocked_months & set(months))
    if clocked:
        dropped = [m for m in months if m not in clocked_months]
        months = [m for m in months if m in clocked_months]
        if dropped:
            notes.append(f"productivity leaves out {', '.join(dropped)}: ABCD has revenue but there is no "
                         "clocking for it yet")
    else:
        notes.append("no clocking for these months: delivery FTE is the planned FTE (SL x RP), not clocked")
    fy_settings = settings.get(fy) or plan_settings.resolve(fy)
    rates = fy_settings["bandDayRatesUsd"]
    days = {m: float(working_days.get(m) or _weekdays(m)) for m in months}

    rev = abcd[abcd["Month"].astype(str).isin(months)]
    agency = _agency_of(abcd)
    names = abcd.drop_duplicates("Project_ID").set_index("Project_ID")["Project_Name"].to_dict() \
        if "Project_Name" in abcd.columns else {}

    pm = clocking.person_months(store, months, rp_full_month_mds)
    if pm.empty and not store.exists("clean/sl_rp/latest.json.gz"):
        notes.append("no SL x RP uploaded: headcount and FTE by agency are unknown, so per-FTE figures are left out")
    for r in pm.drop_duplicates("project").itertuples(index=False):
        if r.project not in agency and isinstance(r.customer, str) and r.customer.strip():
            agency[r.project] = r.customer.strip()
        if r.project not in names and isinstance(r.projectName, str):
            names[r.project] = r.projectName
    pm = pm.copy()
    pm["fteDays"] = pm["actualDays"].fillna(0.0) if clocked else pm["planDays"]
    latest = months[-1] if months else None
    rules = plan_settings.PRODUCTIVITY["flags"]

    def cost_of(rows: pd.DataFrame) -> float:
        total = 0.0
        for r in rows.itertuples(index=False):
            band = f"b{int(r.band)}" if pd.notna(r.band) and int(r.band) in range(3, 10) else None
            rate = rates.get(band) if band else None
            if rate is None:     # no band: the average of the rate card
                rate = sum(rates.values()) / len(rates)
            total += r.fteDays * rate          # man-days x day rate
        return total

    n = len(months)
    target = fy_settings["target"]

    def metrics(revenue: float, rows: pd.DataFrame) -> dict:
        fte = float(rows["fteDays"].sum()) / rp_full_month_mds / n if len(rows) else 0.0
        plan_fte = float(rows["planDays"].sum()) / rp_full_month_mds / n if len(rows) else 0.0
        hc_cost = cost_of(rows)
        gp = revenue - hc_cost
        annual = 12 / n
        fte_days = float(rows["fteDays"].sum())
        rate_per_day = hc_cost / fte_days if fte_days else None              # weighted iRate of this mix
        required = fte_required(revenue * annual, rate_per_day, target) if rate_per_day else None
        per_person = rows.dropna(subset=["clockedDays"]).drop_duplicates(["itCode", "month"])
        days_per_head = float(per_person["clockedDays"].mean()) if clocked and len(per_person) else None
        return {"revenue": round(revenue, 2), "hcCost": round(hc_cost, 2), "gp": round(gp, 2),
                "headcount": int(rows.loc[rows["month"] == latest, "itCode"].nunique()) if len(rows) else 0,
                "headcountAverage": round(rows.groupby("month")["itCode"].nunique().sum() / n, 1) if len(rows) else 0,
                "fte": round(fte, 2), "planFte": round(plan_fte, 2),
                "daysPerHead": round(days_per_head, 2) if days_per_head is not None else None,
                "revenuePerFte": round(revenue * annual / fte, 2) if fte else None,
                "gpPerFte": round(gp * annual / fte, 2) if fte else None,
                "revenuePerHcCost": round(revenue / hc_cost, 3) if hc_cost else None,
                "ratePerDay": round(rate_per_day, 2) if rate_per_day else None,
                "requiredFte": round(required, 2) if required else None}

    rev_by_project = rev.groupby(rev["Project_ID"].astype(str))["Revenue"].sum().to_dict()
    rev_by_month = {(str(k[0]), str(k[1])): float(v)
                    for k, v in rev.groupby([rev["Project_ID"].astype(str), rev["Month"].astype(str)])["Revenue"].sum().items()}

    def by_month(rows: pd.DataFrame, pids: list[str]) -> dict[str, dict]:
        """The month-by-month figures the Analysis page adds up for the period picked (a month, a quarter, the FY):
        revenue, HC cost, actual and plan days, people (distinct names) and clocked days per person-month."""
        out: dict[str, dict] = {}
        for m in months:
            part = rows[rows["month"] == m]
            revenue = sum(rev_by_month.get((pid, m), 0.0) for pid in pids)
            if not len(part) and not revenue:
                continue
            heads = part.dropna(subset=["clockedDays"]).drop_duplicates(["itCode"]) if clocked else part.iloc[0:0]
            out[m] = {"revenue": round(revenue, 2), "hcCost": round(cost_of(part), 2),
                      "actualDays": round(float(part["fteDays"].sum()), 2),
                      "planDays": round(float(part["planDays"].sum()), 2),
                      "people": int(part["itCode"].nunique()),
                      "clockedDays": round(float(heads["clockedDays"].sum()), 2), "clockedPeople": int(len(heads))}
        return out

    projects = set(rev_by_project) | set(pm["project"].astype(str))
    by_agency: dict[str, dict] = {}
    for pid in projects:
        name = agency.get(pid, "(no customer)")
        rows = pm[pm["project"] == pid]
        m = metrics(float(rev_by_project.get(pid, 0.0)), rows)
        if not m["revenue"] and not m["fte"] and not m["planFte"]:
            continue
        a = by_agency.setdefault(name, {"agency": name, "projects": [], "_rows": []})
        a["projects"].append({"projectId": pid, "projectName": names.get(pid) or pid, **m,
                              "byMonth": by_month(rows, [pid])})
        a["_rows"].append(rows)

    agencies = []
    for a in by_agency.values():
        rows = pd.concat(a.pop("_rows"), ignore_index=True) if a["_rows"] else pm.iloc[0:0]
        a.update(metrics(sum(p["revenue"] for p in a["projects"]), rows))
        a["byMonth"] = by_month(rows, [p["projectId"] for p in a["projects"]])
        a["projects"].sort(key=lambda p: -p["revenue"])
        agencies.append(a)
    flagged = [a for a in agencies if a["fte"] >= rules["minFte"] and a["revenue"] > 0]
    tot_fte = sum(a["fte"] for a in flagged)
    tot_rev = sum(a["revenue"] for a in flagged)
    tot_gp = sum(a["gp"] for a in flagged)
    annual = 12 / n
    average = {"revenuePerFte": round(tot_rev * annual / tot_fte, 2) if tot_fte else None,
               "gpPerFte": round(tot_gp * annual / tot_fte, 2) if tot_fte else None,
               "revenuePerHcCost": round(tot_rev / sum(a["hcCost"] for a in flagged), 3)
               if sum(a["hcCost"] for a in flagged) else None}
    util = rules["utilisation"]

    def flags_for(item: dict) -> None:
        use = clocking.utilisation_flag(item["daysPerHead"], util)
        item["utilisationFlag"] = use
        if item["fte"] < rules["minFte"] or item["revenue"] <= 0:
            reasons = []
            if use == "red":
                reasons.append(_days_reason(item["daysPerHead"], util))
            item.update(flag=use if use == "red" else None, productivityFlag=None,
                        flagReason="; ".join(reasons) or
                        "Too small to judge productivity (under %g FTE or no revenue)" % rules["minFte"])
            return
        per = [_flag(item[k], average[k], rules["productivity"]) for k in rules["metrics"]]
        order = {"red": 2, "amber": 1, "green": 0}
        prod = max((f for f in per if f), key=lambda f: order[f], default=None)
        overall = max((f for f in (prod, use) if f), key=lambda f: order[f], default=None)
        reasons = []
        if use == "red":
            reasons.append(_days_reason(item["daysPerHead"], util))
        for k, f in zip(rules["metrics"], per):
            if f in ("red", "amber") and average[k]:
                reasons.append(f"{'Revenue' if k == 'revenuePerFte' else 'GP'} per FTE is "
                               f"{(average[k] - item[k]) / average[k]:.0%} below the company average")
        item.update(flag=overall, productivityFlag=prod,
                    flagReason="; ".join(reasons) or "On track: people clock %g to %g days a month, and revenue per "
                                                      "FTE is at or above the company average"
                                                      % (util["redBelowDays"], util["redAboveDays"]))

    for a in agencies:
        flags_for(a)
        for p in a["projects"]:
            flags_for(p)
    order = {"red": 0, "amber": 1, "green": 2, None: 3}
    agencies.sort(key=lambda a: (order[a["flag"]], -a["revenue"]))
    no_fte = sum(1 for a in agencies if not a["fte"])
    notes.append(f"productivity by agency covers {fy} {months[0]} to {months[-1]}; per-FTE figures are annualised; "
                 "delivery FTE = clocked billable days / 18 (" + ("MSPO clocking by project" if clocking.source(store)
                 == "mspo" else "UR report, split by plan") + "); headcount = people on the project (names on SL x RP "
                 "and the clocking); both are averages a month")
    split = int((pm["projectsThatMonth"] > 1).sum()) if len(pm) else 0
    if split:
        notes.append(f"{split} person-months are on more than one project: their clocked days are split by plan days")
    if no_fte:
        notes.append(f"{no_fte} agencies have revenue but no delivery FTE (resale, or projects not in SL x RP): "
                     "listed, not flagged on productivity")
    if rules.get("draft"):
        notes.append("the revenue-per-FTE thresholds are a draft, waiting for Ethan to confirm them")
    return {"fiscalYear": fy, "months": months, "latestMonth": latest, "clocked": clocked,
            "companyAverage": average, "rules": {k: v for k, v in rules.items()}, "agencies": agencies}, notes


def _days_reason(days: float, util: dict) -> str:
    if days < util["redBelowDays"]:
        return f"Under-utilised: people clock {days:.1f} days a month on average (minimum {util['redBelowDays']:g})"
    return f"Over-utilised: people clock {days:.1f} days a month on average (limit {util['redAboveDays']:g})"


DEMAND_TYPES = ("project", "quote won")


def _demand(store: Store, months: list[str], rp_full_month_mds: float = 18.0) -> tuple[dict | None, list[str]]:
    """{"2026-10": {"fte": 731.2, "project": 723.0, "quoteWon": 8.2}} for the plan's months."""
    if not store.exists("clean/sl_rp/latest.json.gz"):
        return None, ["no SL x RP uploaded yet: the Dashboard can't compare demand with headcount"]
    sl = store.read_table("clean/sl_rp/latest.json.gz")
    kind = sl["Demand Type"].astype("string").str.lower()
    sl = sl[kind.isin(DEMAND_TYPES)].copy()
    sl["month"] = pd.to_datetime(sl["Calendar Date"]).dt.strftime("%Y-%m")
    sl = sl[sl["month"].isin(months)]
    sl["fte"] = pd.to_numeric(sl["MD"], errors="coerce").fillna(0) / rp_full_month_mds
    by = sl.groupby(["month", sl["Demand Type"].astype("string").str.lower()])["fte"].sum().unstack(fill_value=0.0)
    out = {}
    for month, r in by.iterrows():
        project, won = float(r.get("project", 0.0)), float(r.get("quote won", 0.0))
        out[str(month)] = {"fte": round(project + won, 1), "project": round(project, 1), "quoteWon": round(won, 1)}
    return out, ["demand on won and ongoing work is the SL x RP Project and Quote Won man-days / 18 per month "
                 "(Pre Sales, Internal and open quotes O1-O5 left out)"]


SECONDMENT_EMPLOYEE_TYPES = {"secondment", "secondment pm"}


def _people_types(store: Store) -> dict[str, str]:
    """IT Code -> "permanent" | "secondment" | "other". Staff list Employee Type first (Regular Employee = permanent,
    Secondment / Secondment PM = secondment, the Supplemental types = other: open question #12); for people not on
    the staff list, the UR report's Tier ("Tier S_..." = secondment, else permanent)."""
    out: dict[str, str] = {}
    if store.exists("clean/bu_ur/latest.json.gz"):
        ur = store.read_table("clean/bu_ur/latest.json.gz")
        if "Tier" in ur.columns:
            for code, tier in ur.dropna(subset=["IT Code"])[["IT Code", "Tier"]].itertuples(index=False):
                out[str(code)] = "secondment" if str(tier).startswith("Tier S") else "permanent"
    if store.exists("clean/staff_list/latest.json.gz"):
        staff = store.read_table("clean/staff_list/latest.json.gz")
        for code, kind in staff.dropna(subset=["IT Code"])[["IT Code", "Employee Type"]].itertuples(index=False):
            k = str(kind or "").strip().lower()
            out[str(code)] = ("permanent" if k == "regular employee" else
                              "secondment" if k in SECONDMENT_EMPLOYEE_TYPES else "other")
    return out


QL_LONG_KEY = "clean/quoteline/latest_long.json.gz"
RP_LONG_KEY = "clean/resource_plan/latest_long.json.gz"


def _as_sold(store: Store, months: list[str], full_month_mds: float = 18.0) -> tuple[dict | None, list[str]]:
    """As sold (5 Nov 2026, Finance): the FTE sold on each project = its quote line man-days per month / 18 (the
    same 18-day month as As planned and Actual). The quote line export carries the project's ID once the quote is
    won and becomes a project; a line without one is linked through its work order number (Contract Number,
    ORD-...), which the project resource plan also carries. Work order numbers starting 32 / 36 are old and are
    not used. Lines that link to no project are quotes not won yet and are left out.
    Returns {"byProject": {project: {month: man-days}}, "byMonth": {month: man-days}} over the plan's months."""
    if not store.exists(QL_LONG_KEY):
        return None, ["no quote line export uploaded: As sold is empty"]
    ql = store.read_table(QL_LONG_KEY)
    if "project_id" not in ql.columns:
        return None, ["the quote line export has no Project ID column, so As sold can't be linked to projects"]
    ql = ql.copy()
    ql["month"] = pd.to_datetime(ql["month"]).dt.strftime("%Y-%m")
    ql = ql[ql["month"].isin(months)]
    ql["mds"] = pd.to_numeric(ql["mds"], errors="coerce").fillna(0.0)
    pid = ql["project_id"].astype("string").str.strip()
    if "contract" in ql.columns and store.exists(RP_LONG_KEY):
        rp = store.read_table(RP_LONG_KEY)
        if {"contract", "project_id"} <= set(rp.columns):
            rp = rp.dropna(subset=["contract", "project_id"])
            rp = rp[rp["contract"].astype(str).str.upper().str.startswith("ORD-")]
            rp = rp.drop_duplicates("contract")
            by_order = pd.Series(rp["project_id"].astype(str).to_numpy(), index=rp["contract"].astype(str).to_numpy())
            pid = pid.fillna(ql["contract"].astype("string").map(by_order))
    ql["project"] = pid
    linked = ql.dropna(subset=["project"])
    notes = []
    unlinked = float(ql.loc[ql["project"].isna(), "mds"].sum())
    if unlinked:
        notes.append(f"As sold leaves out {round(unlinked):,} quote line man-days that link to no project (quotes "
                     "not won yet)")
    by_project: dict[str, dict[str, float]] = {}
    for (p, m), v in linked.groupby(["project", "month"])["mds"].sum().items():
        if v:
            by_project.setdefault(str(p), {})[str(m)] = round(float(v), 2)
    by_month = {str(m): round(float(v), 2) for m, v in linked.groupby("month")["mds"].sum().items()}
    notes.append(f"As sold = quote line man-days / {full_month_mds:g} per project and month (quote line export, "
                 "linked by Project ID or work order number)")
    return {"byProject": by_project, "byMonth": by_month, "fullMonthManDays": full_month_mds}, notes


def _breakdown(store: Store, months: list[str], rp_full_month_mds: float = 18.0) -> tuple[dict | None, list[str]]:
    """Per agency and per project, per month, for the Dashboard's agency / project / quarter filter:
         fte          demand on won and ongoing work: SL x RP "Project" + "Quote Won" man-days / 18
         people       people planned on the project that month (SL x RP "Project" rows with man-days)
         permanent, secondment, other, unknown   those people by employment type (_people_types)
         billable, workingDays   their UR report days that month, so the page can work out the UR of a selection
         actualFte    FTE actual: clocked billable days on its projects that month / 18 (clocking.py), clocked
                      months only
    A person on two projects counts in both (their FTE is split; their headcount is not)."""
    if not store.exists("clean/sl_rp/latest.json.gz"):
        return None, []
    sl = store.read_table("clean/sl_rp/latest.json.gz")
    kind = sl["Demand Type"].astype("string").str.lower()
    sl = sl[kind.isin(DEMAND_TYPES)].copy()
    sl["kind"] = kind[kind.isin(DEMAND_TYPES)]
    sl["month"] = pd.to_datetime(sl["Calendar Date"]).dt.strftime("%Y-%m")
    sl = sl[sl["month"].isin(months)]
    sl["fte"] = pd.to_numeric(sl["MD"], errors="coerce").fillna(0) / rp_full_month_mds
    sl["project"] = sl["ID"].astype("string")
    sl = sl.dropna(subset=["project"])

    agency: dict[str, str] = {}
    names: dict[str, str] = {}
    if store.exists("clean/abcd/latest.json.gz"):
        abcd = store.read_table("clean/abcd/latest.json.gz")
        agency = _agency_of(abcd)
        names = abcd.drop_duplicates("Project_ID").set_index("Project_ID")["Project_Name"].dropna().astype(str).to_dict()
    for r in sl.drop_duplicates("project").itertuples(index=False):
        if r.project not in agency and isinstance(r.Customer, str) and r.Customer.strip():
            agency[r.project] = r.Customer.strip()
        if r.project not in names and isinstance(r.Name, str):
            names[r.project] = r.Name
    sl["agency"] = sl["project"].map(lambda p: agency.get(p, "(no customer)"))

    types = _people_types(store)
    ur_days: dict[tuple[str, str], tuple[float, float]] = {}
    if store.exists("clean/bu_ur/latest.json.gz"):
        ur = store.read_table("clean/bu_ur/latest.json.gz").dropna(subset=["IT Code"])
        sums = ur.groupby(["IT Code", "Month"])[["Billable", UR_DAYS]].sum()
        ur_days = {(str(c), str(m)): (float(v.iloc[0]), float(v.iloc[1])) for (c, m), v in sums.iterrows()}

    staffed = sl[(sl["kind"] == "project") & (sl["fte"] > 0) & sl["IT Code"].notna()]
    clocked = clocking.clocked_months(store) & set(months)
    pm = clocking.person_months(store, sorted(clocked), rp_full_month_mds) if clocked else None
    actual_days: dict[tuple[str, str], float] = {}
    if pm is not None and len(pm):
        actual_days = {(str(k[0]), str(k[1])): float(v)
                       for k, v in pm.groupby(["project", "month"])["actualDays"].sum().items()}

    def cells(frame: pd.DataFrame, people: pd.DataFrame, clocked_only: frozenset = frozenset()) -> dict[str, dict]:
        out: dict[str, dict] = {}
        fte = frame.groupby("month")["fte"].sum()
        for month, value in fte.items():
            out[str(month)] = {"fte": round(float(value), 2), "people": 0, "permanent": 0, "secondment": 0, "other": 0,
                               "unknown": 0, "billable": 0.0, "workingDays": 0.0}
        for month, part in people.groupby("month"):
            cell = out.setdefault(str(month), {"fte": 0.0, "people": 0, "permanent": 0, "secondment": 0, "other": 0,
                                               "unknown": 0, "billable": 0.0, "workingDays": 0.0})
            codes = sorted(set(part["IT Code"].astype(str)))
            cell["people"] = len(codes)
            for code in codes:
                cell[types.get(code, "unknown")] += 1
                b, d = ur_days.get((code, str(month)), (0.0, 0.0))
                cell["billable"] += b
                cell["workingDays"] += d
            cell["billable"], cell["workingDays"] = round(cell["billable"], 2), round(cell["workingDays"], 2)
        projects_here = set(frame["project"].astype(str)) | clocked_only   # + projects clocked but not planned
        for month in clocked:
            days = sum(actual_days.get((p, month), 0.0) for p in projects_here)
            if days or month in out:
                cell = out.setdefault(month, {"fte": 0.0, "people": 0, "permanent": 0, "secondment": 0, "other": 0,
                                              "unknown": 0, "billable": 0.0, "workingDays": 0.0})
                cell["actualFte"] = round(days / rp_full_month_mds, 2)
        return dict(sorted(out.items()))

    # Projects with clocking but no SL x RP plan count in their agency's FTE actual, as in the HC details panels
    # (roster.json), so the Actual card and the panel agree.
    clocked_by_agency: dict[str, set[str]] = {}
    planned = set(sl["project"].astype(str))
    if pm is not None and len(pm):
        for r in pm.drop_duplicates("project").itertuples(index=False):
            pid = str(r.project)
            if pid in planned:
                continue
            owner = agency.get(pid) or (r.customer.strip() if isinstance(r.customer, str) and r.customer.strip()
                                        else "(no customer)")
            clocked_by_agency.setdefault(owner, set()).add(pid)
    agencies: dict[str, dict] = {}
    for name, part in sl.groupby("agency"):
        extra = frozenset(clocked_by_agency.get(str(name), set()))
        projects = sorted(set(part["project"].astype(str)) | extra)
        agencies[str(name)] = {"projects": projects,
                               "byMonth": cells(part, staffed[staffed["agency"] == name], extra)}
    projects: dict[str, dict] = {}
    for pid, part in sl.groupby("project"):
        projects[str(pid)] = {"name": names.get(str(pid)) or str(pid), "agency": agency.get(str(pid), "(no customer)"),
                              "byMonth": cells(part, staffed[staffed["project"] == pid])}
    unknown = sum(c["unknown"] for a in agencies.values() for c in a["byMonth"].values())
    notes = ["the Dashboard's agency and project filter uses the people planned in SL x RP; a person on two "
             "projects counts in both"]
    if unknown:
        notes.append("some people planned in SL x RP are on neither the staff list nor the UR report, so their "
                     "employment type is unknown")
    return {"agencies": agencies, "projects": projects}, notes


def fte_required(annual_revenue: float, rate_per_day: float, target: dict) -> float:
    """FTE an annual revenue needs (section 8.2 of the 3 Nov instructions, the same formula as the Analysis page):
        revenue per FTE-day = weighted iRate / (1 - GP %)
        billable FTE        = annual revenue / (12 x man-days per FTE per month x revenue per FTE-day)
        total FTE           = billable FTE / UR when the man-days are working days (manDaysAreBillable false, the
                              default: 18 working days is the company's standard baseline, 4 Nov 2026); billable FTE
                              as it is when they are billable days.
    The formula is agreed to be incorrect (4 Nov 2026) and will be replaced."""
    price = rate_per_day / (1 - target["gpPct"])
    billable = annual_revenue / (12 * target["manDaysPerFte"] * price)
    return billable if target.get("manDaysAreBillable", False) else billable / target["billableUr"]


def _weekdays(month: str) -> int:
    year, number = (int(p) for p in month.split("-"))
    days = calendar.monthrange(year, number)[1]
    return sum(1 for d in range(1, days + 1) if dt.date(year, number, d).weekday() < 5)


def _fy_months(fy: str) -> list[str]:
    start = dt.date(2000 + int(fy[2:]), 4, 1)
    return [fiscal.add_months(start, i).strftime("%Y-%m") for i in range(12)]


def build(store: Store, today: dt.date | None = None) -> dict:
    today = today or dt.date.today()
    notes: list[str] = []
    sources = {d: _source(store, d) for d in ("bu_ur", "staff_list", "workday_hire_leaver", "abcd", "sl_rp",
                                              "mspo_clocking")}

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
    ur_start = _ur_starting(store)
    if ur_start and ur_start[0] == months[0]:
        starting = {"month": months[0], "bands": ur_start[1], "source": "bu_ur"}
        notes.append(f"the starting headcount ({months[0]}) is the staff with a grade on that month's UR report "
                     f"({sum(ur_start[1].values())})")
    elif starting:
        starting["source"] = "staff_list"
        notes.append(f"the starting headcount ({months[0]}) is the staff list as uploaded, not a month-end snapshot")
    else:
        notes.append("no staff list or UR report uploaded yet: the starting headcount is empty")

    mix = {b: float(n) for b, n in ((starting or {}).get("bands") or {}).items()}
    flows, flow_notes = _actual_flows(store, mix)
    notes.extend(flow_notes)
    if starting and starting.get("source") == "bu_ur" and flows and months[0] in flows:
        # The UR report lists everyone who worked in the month, including that month's joiners. The plan adds the
        # joiners itself, so the opening headcount leaves them out (ending HC = the report's staff - leavers).
        joined = flows[months[0]]["joiners"]
        starting["bands"] = {b: max(n - joined.get(b, 0), 0) for b, n in starting["bands"].items()}
        notes.append(f"the opening headcount leaves out {months[0]}'s {sum(joined.values())} Workday joiners "
                     "(they are added as that month's joiners)")
    revenue, abcd, revenue_notes = _revenue(store)
    notes.extend(revenue_notes)
    demand, demand_notes = _demand(store, months)
    notes.extend(demand_notes)
    split, split_notes = _breakdown(store, months)
    notes.extend(split_notes)
    as_sold, sold_notes = _as_sold(store, months)
    notes.extend(sold_notes)
    # FTE actual for the organisation: every clocked billable day that month / 18.
    actual_fte = {m: round(d / 18.0, 1) for m, d in clocking.billable_days_by_month(store).items() if m in months}
    actual_source = clocking.source(store)
    if actual_fte:
        notes.append("FTE actual = clocked billable days / 18 from the " + (
            "MSPO clocking export (SANDBOX: synthetic file)" if actual_source == "mspo" else
            "UR report (no MSPO clocking export uploaded; projects split by plan days)"))
    productivity = None
    if abcd is not None:
        productivity, prod_notes = _productivity(store, abcd, settings, working_days, clocking.clocked_months(store))
        notes.extend(prod_notes)

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
        "actualFlows": flows,
        "revenue": revenue,
        "productivity": productivity,
        "asSold": as_sold,
        "demand": demand,
        "breakdown": split,
        "actualFte": actual_fte or None,
        "actualFteSource": actual_source,
        "productivitySettings": {"headcountBase": plan_settings.PRODUCTIVITY["headcountBase"],
                                 "abcdScope": plan_settings.PRODUCTIVITY["abcdScope"]},
        "headcountBreakdown": breakdown,
        "sources": sources,
        "notes": notes,
    }


def _roster(store: Store, inputs: dict) -> dict:
    """Plan vs actual per person, project and month over the plan's months (clocking.roster)."""
    months = [m["month"] for m in inputs["months"]]
    agency: dict[str, str] = {}
    names: dict[str, str] = {}
    if store.exists("clean/abcd/latest.json.gz"):
        abcd = store.read_table("clean/abcd/latest.json.gz")
        agency = _agency_of(abcd)
        names = abcd.drop_duplicates("Project_ID").set_index("Project_ID")["Project_Name"].dropna().astype(str).to_dict()
    pm = clocking.person_months(store, months)
    actual = clocking.clocked_months(store) & set(months)
    return clocking.roster(store, pm, agency, names, _people_types(store), actual)


def write(store: Store) -> dict:
    inputs = build(store)
    store.write_json(KEY, inputs)
    roster = json.dumps(_roster(store, inputs), ensure_ascii=False, default=str, separators=(",", ":"))
    store.write_bytes(clocking.ROSTER_KEY, roster.encode("utf-8"), "application/json")   # compact: about 2 MB
    return inputs
