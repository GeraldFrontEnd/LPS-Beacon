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
                       band found by name on the UR report or staff list; people not found are spread over the
                       bands like that month's headcount). Used for the plan's months that have a report.
  revenue              revenue and cost per month for Singapore delivery (ABCD report): actuals where the ABCD
                       report has them, its forecast after. The Revenue row's default.
  demand               FTE demand per month on won and ongoing work: SL x RP "Project" and "Quote Won" man-days / 18
                       (the backlog the headcount delivers), for "demand vs capacity today" on the Dashboard
  productivity         per agency (customer) and project, this fiscal year to date: revenue (ABCD), delivery FTE
                       (SL x RP man-days on "Project" rows), HC cost at the rate card (iRate), and the ratios,
                       flagged against the company average with the DRAFT thresholds in plan_settings.PRODUCTIVITY
  hiringNeeds          the people the latest published review found must be hired (its hiring gap: demand
                       nobody could be matched to), per month and band, with the roles. They are the plan's
                       default joiners. A need starting in an actual month is moved to the first forecast
                       month (the demand already started unstaffed, so the hire comes as soon as possible).
  headcountBreakdown   today's headcount by employment type, for the Dashboard boxes
  sources, notes       which files were used, and what to know about them
"""
from __future__ import annotations

import calendar
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
        for k in group["nameKey"].astype(str):
            band = bands.get(k)
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


def _staffing_flag(fte: float, required: float | None, rules: dict) -> tuple[str | None, str | None]:
    if not required:
        return None, None
    off = (fte - required) / required
    state = "over" if off > 0 else "under"
    if abs(off) > rules["redOffPct"]:
        return "red", state
    if abs(off) > rules["amberOffPct"]:
        return "amber", state
    return "green", "on target"


def _productivity(store: Store, abcd: pd.DataFrame, settings: dict, working_days: dict[str, float],
                  rp_full_month_mds: float = 18.0) -> tuple[dict | None, list[str]]:
    """This fiscal year to date, per agency and project. Months: the ABCD report's actual months in the latest FY."""
    actual = sorted(abcd.loc[abcd["Actual"], "Month"].astype(str).unique())
    if not actual:
        return None, ["the ABCD report has no actual months yet, so productivity by agency is not worked out"]
    fy = fiscal.fy_label(dt.date.fromisoformat(actual[-1] + "-01"))
    months = [m for m in actual if fiscal.fy_label(dt.date.fromisoformat(m + "-01")) == fy]
    fy_settings = settings.get(fy) or plan_settings.resolve(fy)
    rates = fy_settings["bandDayRatesUsd"]
    days = {m: float(working_days.get(m) or _weekdays(m)) for m in months}

    rev = abcd[abcd["Month"].astype(str).isin(months)]
    agency = _agency_of(abcd)
    names = abcd.drop_duplicates("Project_ID").set_index("Project_ID")["Project_Name"].to_dict() \
        if "Project_Name" in abcd.columns else {}

    # Delivery FTE per project per month and band: SL x RP "Project" rows (named people), man-days / 18.
    fte_rows = pd.DataFrame(columns=["project", "month", "band", "fte"])
    notes: list[str] = []
    if store.exists("clean/sl_rp/latest.json.gz"):
        sl = store.read_table("clean/sl_rp/latest.json.gz")
        sl = sl[sl["Demand Type"].astype("string").str.lower().eq("project")].copy()
        sl["month"] = pd.to_datetime(sl["Calendar Date"]).dt.strftime("%Y-%m")
        sl = sl[sl["month"].isin(months)]
        sl["band"] = pd.to_numeric(sl["Grade"], errors="coerce")
        sl["fte"] = pd.to_numeric(sl["MD"], errors="coerce").fillna(0) / rp_full_month_mds
        sl["project"] = sl["ID"].astype("string")
        for r in sl.dropna(subset=["project"]).drop_duplicates("project").itertuples(index=False):
            if r.project not in agency and isinstance(r.Customer, str) and r.Customer.strip():
                agency[r.project] = r.Customer.strip()
            if r.project not in names and isinstance(r.Name, str):
                names[r.project] = r.Name
        fte_rows = sl.groupby(["project", "month", "band"], dropna=False, as_index=False)["fte"].sum()
    else:
        notes.append("no SL x RP uploaded: delivery FTE by agency is unknown, so per-FTE figures are left out")

    def cost_of(rows: pd.DataFrame) -> float:
        total = 0.0
        for r in rows.itertuples(index=False):
            band = f"b{int(r.band)}" if pd.notna(r.band) and int(r.band) in range(3, 10) else None
            rate = rates.get(band) if band else None
            if rate is None:     # no band: the average of the rate card
                rate = sum(rates.values()) / len(rates)
            total += r.fte * rate * days.get(r.month, 0.0)
        return total

    n = len(months)
    target = fy_settings["target"]
    year_days = sum(_weekdays(m) for m in _fy_months(fy))

    def metrics(revenue: float, rows: pd.DataFrame) -> dict:
        fte = float(rows["fte"].sum()) / n if len(rows) else 0.0
        hc_cost = cost_of(rows)
        gp = revenue - hc_cost
        annual = 12 / n
        rate_per_day = (hc_cost / (fte * sum(days.values()))) if fte else None   # weighted iRate of this mix
        required = None
        if rate_per_day:
            price = rate_per_day / (1 - target["gpPct"])
            required = revenue * annual / (price * year_days * target["billableUr"])
        return {"revenue": round(revenue, 2), "hcCost": round(hc_cost, 2), "gp": round(gp, 2), "fte": round(fte, 2),
                "revenuePerFte": round(revenue * annual / fte, 2) if fte else None,
                "gpPerFte": round(gp * annual / fte, 2) if fte else None,
                "revenuePerHcCost": round(revenue / hc_cost, 3) if hc_cost else None,
                "requiredFte": round(required, 2) if required else None}

    rev_by_project = rev.groupby(rev["Project_ID"].astype(str))["Revenue"].sum().to_dict()
    projects = set(rev_by_project) | set(fte_rows["project"].astype(str))
    by_agency: dict[str, dict] = {}
    for pid in projects:
        name = agency.get(pid, "(no customer)")
        rows = fte_rows[fte_rows["project"].astype(str) == pid]
        m = metrics(float(rev_by_project.get(pid, 0.0)), rows)
        if not m["revenue"] and not m["fte"]:
            continue
        a = by_agency.setdefault(name, {"agency": name, "projects": [], "_rows": []})
        a["projects"].append({"projectId": pid, "projectName": names.get(pid) or pid, **m})
        a["_rows"].append(rows)

    rules = plan_settings.PRODUCTIVITY["flags"]
    agencies = []
    for a in by_agency.values():
        rows = pd.concat(a.pop("_rows"), ignore_index=True) if a["_rows"] else fte_rows.iloc[0:0]
        a.update(metrics(sum(p["revenue"] for p in a["projects"]), rows))
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

    def flags_for(item: dict) -> None:
        if item["fte"] < rules["minFte"] or item["revenue"] <= 0:
            item.update(flag=None, productivityFlag=None, staffingFlag=None, staffing=None,
                        flagReason="not flagged: less than %g delivery FTE or no revenue" % rules["minFte"])
            return
        per = [_flag(item[k], average[k], rules["productivity"]) for k in rules["metrics"]]
        order = {"red": 2, "amber": 1, "green": 0}
        prod = max((f for f in per if f), key=lambda f: order[f], default=None)
        staff, state = _staffing_flag(item["fte"], item["requiredFte"], rules["staffing"])
        overall = max((f for f in (prod, staff) if f), key=lambda f: order[f], default=None)
        reasons = []
        for k, f in zip(rules["metrics"], per):
            if f in ("red", "amber") and average[k]:
                reasons.append(f"{'Revenue' if k == 'revenuePerFte' else 'GP'} per FTE "
                               f"{(average[k] - item[k]) / average[k]:.0%} below the company average")
        if staff in ("red", "amber") and item["requiredFte"]:
            reasons.append(f"{state}staffed: {item['fte']:.1f} FTE vs {item['requiredFte']:.1f} needed")
        item.update(flag=overall, productivityFlag=prod, staffingFlag=staff, staffing=state,
                    flagReason="; ".join(reasons) or "at or above the company average")

    for a in agencies:
        flags_for(a)
        for p in a["projects"]:
            flags_for(p)
    order = {"red": 0, "amber": 1, "green": 2, None: 3}
    agencies.sort(key=lambda a: (order[a["flag"]], -a["revenue"]))
    no_fte = sum(1 for a in agencies if not a["fte"])
    notes.append(f"productivity by agency covers {fy} {months[0]} to {months[-1]} (ABCD actuals); per-FTE figures "
                 "are annualised and use the FTE planned on each project in SL x RP")
    if no_fte:
        notes.append(f"{no_fte} agencies have revenue but no delivery FTE in SL x RP (resale, or projects not "
                     "planned there): listed, not flagged")
    if rules.get("draft"):
        notes.append("the red / amber / green thresholds are a draft, waiting for Ethan to confirm them")
    return {"fiscalYear": fy, "months": months, "companyAverage": average,
            "rules": {k: v for k, v in rules.items()}, "agencies": agencies}, notes


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
    sources = {d: _source(store, d) for d in ("bu_ur", "staff_list", "workday_hire_leaver", "abcd", "sl_rp")}

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
    productivity = None
    if abcd is not None:
        productivity, prod_notes = _productivity(store, abcd, settings, working_days)
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
        "demand": demand,
        "productivitySettings": {"headcountBase": plan_settings.PRODUCTIVITY["headcountBase"],
                                 "abcdScope": plan_settings.PRODUCTIVITY["abcdScope"]},
        "headcountBreakdown": breakdown,
        "sources": sources,
        "notes": notes,
    }


def write(store: Store) -> dict:
    inputs = build(store)
    store.write_json(KEY, inputs)
    return inputs
