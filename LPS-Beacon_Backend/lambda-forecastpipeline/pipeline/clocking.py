"""Plan vs actual per person, project and month (4 Nov 2026 meeting).

    HC          people on the project: the distinct names with man-days on its SL x RP "Project" rows that month
    plan        SL x RP man-days (MD) per person per project per month; plan FTE = MD / 18
    actual      clocked billable days per person, project and month from the MSPO clocking export when it is
                uploaded (exact, by project; the sandbox file is synthetic). Without it: the person's billable days on
                the UR report, given to their projects in proportion to their plan days that month (only people on more
                than one project are split, and they are marked "split"). Actual FTE = actual days / 18.
                People who clocked to a project they were not planned on appear with plan 0.
    days / head a person's total clocked billable days that month (all projects). The red rule: below 15.3
                (18 man-days x the 85 % UR target) or above 18.

The roster (names, plan and actual days per person) is written to results/capacity/roster.json for the chat's
project questions. It holds names, so the API gives it to Finance/HR users only (others get counts).
"""
from __future__ import annotations

import datetime as dt

import pandas as pd

from .clean import UR_WORKING_DAYS
from .s3io import Store

ROSTER_KEY = "results/capacity/roster.json"
SL_KEY = "clean/sl_rp/latest.json.gz"
UR_KEY = "clean/bu_ur/latest.json.gz"
MSPO_KEY = "clean/mspo_clocking/all.json.gz"


def source(store: Store) -> str:
    """Where actual days come from: "mspo" (clocking by project), "ur" (UR report, split by plan) or "none"."""
    if store.exists(MSPO_KEY):
        return "mspo"
    return "ur" if store.exists(UR_KEY) else "none"


def clocked_months(store: Store) -> set[str]:
    """Months with clocking: the MSPO export's, else the UR report's."""
    if store.exists(MSPO_KEY):
        return set(store.read_table(MSPO_KEY)["Month"].astype(str))
    if store.exists(UR_KEY):
        return set(store.read_table(UR_KEY)["Month"].astype(str))
    return set()


def billable_days_by_month(store: Store) -> dict[str, float]:
    """All clocked billable days per month (every person, every project), for the organisation's FTE actual."""
    if store.exists(MSPO_KEY):
        m = store.read_table(MSPO_KEY)
        m = m[m["Billable"].astype(bool)]
        return {str(k): float(v) for k, v in m.groupby("Month")["Days"].sum().items()}
    if store.exists(UR_KEY):
        u = store.read_table(UR_KEY)
        return {str(k): float(v) for k, v in u.groupby("Month")["Billable"].sum().items()}
    return {}


def person_months(store: Store, months: list[str], full_month_mds: float = 18.0) -> pd.DataFrame:
    """One row per person, project and month with plan man-days on a SL x RP "Project" row:
    project, customer, projectName, month, itCode, resource, position, band, planDays, clockedDays (the person's
    UR billable days that month, NaN when the UR report does not have them), workingDays, projectsThatMonth,
    actualDays (clockedDays x this project's share of the person's plan days)."""
    cols = ["project", "customer", "projectName", "month", "itCode", "resource", "position", "band", "planDays",
            "clockedDays", "workingDays", "projectsThatMonth", "actualDays"]
    if not store.exists(SL_KEY) and not store.exists(MSPO_KEY):
        return pd.DataFrame(columns=cols)
    sl = store.read_table(SL_KEY) if store.exists(SL_KEY) else pd.DataFrame(
        columns=["Demand Type", "ID", "Calendar Date", "MD", "IT Code", "Resource", "Position Name", "Grade",
                 "Customer", "Name"])
    for col in ("Resource", "Position Name", "Grade", "Customer", "Name", "IT Code"):
        if col not in sl.columns:
            sl[col] = pd.NA
    sl = sl[sl["Demand Type"].astype("string").str.lower().eq("project")].copy()
    sl["month"] = pd.to_datetime(sl["Calendar Date"]).dt.strftime("%Y-%m")
    sl = sl[sl["month"].isin(months)]
    sl["planDays"] = pd.to_numeric(sl["MD"], errors="coerce").fillna(0.0)
    sl = sl[(sl["planDays"] > 0) & sl["ID"].notna()]
    sl["itCode"] = sl["IT Code"].astype("string")
    sl["resource"] = sl["Resource"].astype("string")
    # A person without an IT code is still a person: key them by name so they count once.
    sl["itCode"] = sl["itCode"].fillna("name:" + sl["resource"].fillna("?"))
    out = (sl.groupby(["ID", "month", "itCode"], as_index=False)
             .agg(planDays=("planDays", "sum"), resource=("resource", "first"),
                  position=("Position Name", "first"), band=("Grade", "first"),
                  customer=("Customer", "first"), projectName=("Name", "first"))
             .rename(columns={"ID": "project"}))
    out["project"] = out["project"].astype(str)
    out["band"] = pd.to_numeric(out["band"], errors="coerce")
    if store.exists(MSPO_KEY):
        return _with_mspo(store, out, sl, months, cols)
    total = out.groupby(["itCode", "month"])["planDays"].transform("sum")
    out["projectsThatMonth"] = out.groupby(["itCode", "month"])["project"].transform("nunique")
    share = out["planDays"] / total

    clocked = pd.Series(dtype="float64")
    days = pd.Series(dtype="float64")
    if store.exists(UR_KEY):
        ur = store.read_table(UR_KEY).dropna(subset=["IT Code"])
        sums = ur.groupby([ur["IT Code"].astype(str), "Month"])[["Billable", UR_WORKING_DAYS]].sum()
        clocked, days = sums["Billable"], sums[UR_WORKING_DAYS]
    idx = list(zip(out["itCode"].astype(str), out["month"]))
    out["clockedDays"] = [clocked.get(k, float("nan")) for k in idx]
    out["workingDays"] = [days.get(k, float("nan")) for k in idx]
    out["actualDays"] = out["clockedDays"] * share
    return out[cols]


def _with_mspo(store: Store, plan: pd.DataFrame, sl: pd.DataFrame, months: list[str], cols: list[str]) -> pd.DataFrame:
    """Plan rows joined with the MSPO clocking by person, project and month (an outer join: clocked but not planned
    keeps plan 0; planned but not clocked keeps actual NaN in clocked months)."""
    m = store.read_table(MSPO_KEY)
    m = m[m["Month"].astype(str).isin(months)].copy()
    clocked = set(m["Month"].astype(str))
    bill = m[m["Billable"].astype(bool)]
    act = (bill.groupby(["Project ID", "Month", "IT Code"], as_index=False)
               .agg(actualDays=("Days", "sum"), mResource=("Resource", "first"), mName=("Project Name", "first"),
                    mCustomer=("Customer", "first"))
               .rename(columns={"Project ID": "project", "Month": "month", "IT Code": "itCode"}))
    act["project"], act["itCode"] = act["project"].astype(str), act["itCode"].astype(str)
    total = bill.groupby(["IT Code", "Month"])["Days"].sum()
    present = set(zip(m["IT Code"].astype(str), m["Month"].astype(str)))   # on the export that month (any row)
    out = plan.merge(act, on=["project", "month", "itCode"], how="outer")
    out["planDays"] = out["planDays"].fillna(0.0)
    out["resource"] = out["resource"].fillna(out["mResource"])
    out["projectName"] = out["projectName"].fillna(out["mName"])
    out["customer"] = out["customer"].fillna(out["mCustomer"])
    # A clocked-only person's position and band: from their SL x RP rows in any month, if any.
    if len(sl):
        who = sl.dropna(subset=["IT Code"]).drop_duplicates("IT Code")
        who = who.set_index(who["IT Code"].astype(str))
        out["position"] = out["position"].fillna(out["itCode"].map(who["Position Name"]))
        out["band"] = out["band"].fillna(pd.to_numeric(out["itCode"].map(who["Grade"]), errors="coerce"))
    # Not on the export that month = not clocked (NaN); on it with no billable time = 0 days.
    out["clockedDays"] = [total.get((c, mo), 0.0) if (c, mo) in present else float("nan")
                          for c, mo in zip(out["itCode"], out["month"])]
    in_clocked = out["month"].isin(clocked)
    out.loc[in_clocked, "actualDays"] = out.loc[in_clocked, "actualDays"].fillna(0.0)
    out["workingDays"] = float("nan")
    out["projectsThatMonth"] = 1                      # exact by project: nothing is split
    return out[cols]


def roster(store: Store, pm: pd.DataFrame, agency: dict[str, str], names: dict[str, str],
           types: dict[str, str], actual_months: set[str], full_month_mds: float = 18.0) -> dict:
    """results/capacity/roster.json: per project and month, the totals and one line per person."""
    projects: dict[str, dict] = {}
    for (pid, month), part in pm.sort_values(["project", "month", "resource"]).groupby(["project", "month"]):
        actual = month in actual_months
        clocked = part["clockedDays"].dropna()
        people = []
        for r in part.itertuples(index=False):
            people.append({
                "name": None if pd.isna(r.resource) else str(r.resource),
                "position": None if pd.isna(r.position) else str(r.position),
                "band": None if pd.isna(r.band) else int(r.band),
                "employment": types.get(str(r.itCode), "unknown"),
                "planDays": round(float(r.planDays), 2),
                "planFte": round(float(r.planDays) / full_month_mds, 2),
                "clockedDaysAllProjects": None if pd.isna(r.clockedDays) else round(float(r.clockedDays), 2),
                "actualDays": None if pd.isna(r.actualDays) else round(float(r.actualDays), 2),
                "actualFte": None if pd.isna(r.actualDays) else round(float(r.actualDays) / full_month_mds, 2),
                "split": bool(r.projectsThatMonth > 1),
            })
        p = projects.setdefault(pid, {"name": names.get(pid) or (None if part["projectName"].isna().all()
                                                                else str(part["projectName"].dropna().iloc[0])),
                                      "agency": agency.get(pid) or (None if part["customer"].isna().all()
                                                                    else str(part["customer"].dropna().iloc[0])),
                                      "byMonth": {}})
        plan_days = float(part["planDays"].sum())
        actual_days = float(part["actualDays"].sum()) if actual else None
        p["byMonth"][str(month)] = {
            "actual": actual,
            "headcount": int(part["itCode"].nunique()),
            "planDays": round(plan_days, 2), "planFte": round(plan_days / full_month_mds, 2),
            "actualDays": None if actual_days is None else round(actual_days, 2),
            "actualFte": None if actual_days is None else round(actual_days / full_month_mds, 2),
            "daysPerHead": round(float(clocked.mean()), 2) if actual and len(clocked) else None,
            "notClocked": int(part["clockedDays"].isna().sum()) if actual else None,
            "people": people,
        }
    return {"generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "fullMonthManDays": full_month_mds,
            "actualMonths": sorted(actual_months),
            "actualSource": source(store),
            "notes": ["plan = SL x RP man-days; actual = clocked billable days by project from the MSPO clocking "
                      "export" if source(store) == "mspo" else
                      "plan = SL x RP man-days; actual = the person's UR report billable days, split over their "
                      "projects by plan days when they are on more than one (split = true)",
                      "clockedDaysAllProjects is the person's whole month, used for the 15.3 to 18 days rule",
                      "plan 0 with actual days = clocked to a project they were not planned on"],
            "projects": projects}


def utilisation_flag(days_per_head: float | None, rules: dict) -> str | None:
    """Red below rules["redBelowDays"] (15.3) or above rules["redAboveDays"] (18) clocked days per head a month."""
    if days_per_head is None:
        return None
    if days_per_head < rules["redBelowDays"] or days_per_head > rules["redAboveDays"]:
        return "red"
    return "green"
