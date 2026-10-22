"""The Dashboard's insights from all the uploaded files (not only the capacity plan), in one JSON file the API
Lambda reads:

    results/dashboard/insights.json

Rebuilt with the capacity plan's inputs (see lambda_function._refresh_dashboard_data): after a UR report, staff
list or SFDC pipeline is cleaned, after every published run, and on demand ({"mode": "capacity_inputs"}).
Each part is left out (null) when its file was not uploaded yet. All money in USD.

  pipeline      SFDC pipeline: open pipeline by stage (TCV and probability-weighted TCV), forecast revenue per
                month (booked = Closed Won, open = probability-weighted), the largest open opportunities, win rate
  resources     latest published run: people becoming available per month against pipeline demand, and the roles
                with the most people free now or within 6 months that nothing is matched to (bench risk)
  utilisation   UR report: where non-billable time goes per month, and Billable UR by team and by tier for the
                latest month against the overall target
  workforce     staff list: leavers already recorded, per month and band
"""
from __future__ import annotations

import datetime as dt
import json

import pandas as pd

from . import fiscal, plan_settings
from .s3io import Store

KEY = "results/dashboard/insights.json"
OPEN_STAGES = ("O1", "O2", "O3", "O4", "O5")
REVENUE_MONTHS = 18
ROLL_OFF_MONTHS = 12
TOP = 10
NON_BILLABLE = [("leave", "Leave"), ("missingManday", "Missing Manday"), ("admin", "Admin"),
                ("training", "Training"), ("presales", "Presales"), ("internal", "Internal"), ("bench", "Bench")]
BANDS = ("b9", "b8", "b7", "b6", "b5", "b4", "b3")


def _num(v) -> float:
    return 0.0 if v is None or pd.isna(v) else float(v)


def _month(d) -> str | None:
    return None if d is None or pd.isna(d) else pd.Timestamp(d).strftime("%Y-%m")


def _source(store: Store, dataset: str) -> dict | None:
    q = store.read_json_or(f"clean/{dataset}/latest.quality.json", None)
    if not q:
        return None
    return {"file": str(q.get("sourceKey") or "").rsplit("/", 1)[-1], "cleanedAt": q.get("cleanedAt")}


def _stage_code(stage) -> str | None:
    """"O2 - Qualify" -> "O2" for an open stage; None for closed or blank."""
    if stage is None or pd.isna(stage):
        return None
    text = str(stage)
    return text.split(" ")[0] if text[:2] in OPEN_STAGES else None


def sales_pipeline(store: Store, today: dt.date) -> dict | None:
    if not store.exists("clean/sfdc_pipeline/latest.json.gz"):
        return None
    opps = store.read_table("clean/sfdc_pipeline/latest.json.gz")
    opps["prob"] = opps["Probability (%)"].fillna(0.0).clip(0, 1)
    opps["tcv"] = opps["TCV (converted)"].fillna(0.0)
    opps["code"] = opps["Stage"].map(_stage_code)
    open_ = opps[opps["code"].notna()].copy()
    open_["weighted"] = open_["tcv"] * open_["prob"]

    by_stage = []
    for code in OPEN_STAGES:
        part = open_[open_["code"] == code]
        if len(part):
            by_stage.append({"stage": part["Stage"].mode().iloc[0], "count": int(len(part)),
                             "tcv": round(part["tcv"].sum(), 2), "weightedTcv": round(part["weighted"].sum(), 2)})

    # Win rate: closed opportunities whose expected close date falls in the last 12 months.
    since = pd.Timestamp(fiscal.add_months(today.replace(day=1), -12))
    closed = opps[opps["Stage"].isin(["Closed Won", "Closed Lost/Cancel"])
                  & (opps["Expected Closed Date"] >= since)]
    won = closed[closed["Stage"] == "Closed Won"]

    months = [fiscal.add_months(today.replace(day=1), i).strftime("%Y-%m") for i in range(REVENUE_MONTHS)]
    revenue = []
    if store.exists("clean/sfdc_pipeline/monthly_revenue.json.gz"):
        monthly = store.read_table("clean/sfdc_pipeline/monthly_revenue.json.gz")
        monthly = monthly.merge(opps[["CRM ID", "Stage", "code", "prob"]], on="CRM ID", how="inner")
        for m in months:
            part = monthly[monthly["Month"] == m]
            booked = part[part["Stage"] == "Closed Won"]["Revenue"].sum()
            pipe = part[part["code"].notna()]
            revenue.append({"month": m, "booked": round(_num(booked), 2),
                            "openWeighted": round(_num((pipe["Revenue"] * pipe["prob"]).sum()), 2),
                            "open": round(_num(pipe["Revenue"].sum()), 2)})

    top = open_.sort_values(["weighted", "tcv"], ascending=False).head(TOP)
    return {
        "kpis": {"openCount": int(len(open_)), "openTcv": round(open_["tcv"].sum(), 2),
                 "openWeightedTcv": round(open_["weighted"].sum(), 2),
                 "winRate": round(len(won) / len(closed), 4) if len(closed) else None,
                 "closedLast12m": int(len(closed)), "wonTcvLast12m": round(won["tcv"].sum(), 2)},
        "byStage": by_stage,
        "revenueByMonth": revenue,
        "topOpen": [{"crmId": r["CRM ID"], "name": r["Opportunity Name (English)"], "customer": r["End Customer"],
                     "stage": r["Stage"], "probability": round(r["prob"], 4), "tcv": round(r["tcv"], 2),
                     "weightedTcv": round(r["weighted"], 2), "expectedClose": _month(r["Expected Closed Date"]),
                     "offering": r["Major Solution Offering"]}
                    for _, r in top.iterrows()],
    }


def resources(store: Store, today: dt.date) -> dict | None:
    pointer = store.read_json_or("results/latest.json", None)
    if not pointer or not pointer.get("prefix"):
        return None
    prefix = pointer["prefix"] + "summary/"

    def table(name):
        key = prefix + name + ".json"
        return pd.DataFrame(store.read_json(key)) if store.exists(key) else None

    forecast = table("availability_forecast")
    by_role = table("availability_by_role")
    out: dict = {"run": {"runId": pointer.get("runId"), "asOf": pointer.get("asOf"),
                         "publishedAt": pointer.get("publishedAt")}}
    if forecast is not None and len(forecast):
        forecast["month"] = pd.to_datetime(forecast["Month"]).dt.strftime("%Y-%m")
        sums = forecast.groupby("month")[["New Available - confirmed end", "New Available - FY-end (plan)",
                                          "Pipeline Demand Starting", "Matched Starting"]].sum()
        first = today.replace(day=1).strftime("%Y-%m")
        out["rollOffs"] = [{"month": m, "available": int(r.iloc[0]), "availableIfNotRenewed": int(r.iloc[1]),
                            "pipelineDemand": int(r.iloc[2]), "matched": int(r.iloc[3])}
                           for m, r in sums.iterrows() if m >= first][:ROLL_OFF_MONTHS]
    if by_role is not None and len(by_role):
        soon = by_role[by_role["availability_status"].isin(["Available now", "Rolling off 0-6m"])]
        pivot = soon.pivot_table(index="standardized_position", columns="availability_status", values="unmatched",
                                 aggfunc="sum", fill_value=0)
        pivot["total"] = pivot.sum(axis=1)
        pivot = pivot[pivot["total"] > 0].sort_values("total", ascending=False).head(TOP)
        out["benchRisk"] = [{"role": role, "availableNow": int(r.get("Available now", 0)),
                             "rollingOff6m": int(r.get("Rolling off 0-6m", 0)), "total": int(r["total"])}
                            for role, r in pivot.iterrows()]
        out["benchRiskTotal"] = int(soon["unmatched"].sum())
    return out


def utilisation(store: Store) -> dict | None:
    if not store.exists("clean/bu_ur/latest.json.gz"):
        return None
    ur = store.read_table("clean/bu_ur/latest.json.gz")
    days_col = "Standard Working days (Current month)"
    by_month = ur.groupby("Month")
    non_billable = []
    for month, part in by_month:
        row = {"month": month, "workingDays": round(_num(part[days_col].sum()), 1)}
        for key, col in NON_BILLABLE:
            row[key] = round(_num(part[col].sum()), 1) if col in part.columns else 0.0
        non_billable.append(row)
    latest = max(ur["Month"])
    target = plan_settings.resolve(fiscal.fy_label(dt.date.fromisoformat(latest + "-01")))["urTargets"]
    last = ur[ur["Month"] == latest]

    def ur_by(col):
        rows = []
        for key, part in last.groupby(col):
            days = part[days_col].sum()
            rows.append({"name": key, "staff": int(len(part)),
                         "billableUr": round(part["Billable"].sum() / days, 4) if days else None})
        return sorted(rows, key=lambda r: -r["staff"])

    return {"latestMonth": latest, "overallTarget": target.get("all"), "nonBillableByMonth": non_billable,
            "byTeam": ur_by("Team") if "Team" in last.columns else [],
            "byTier": ur_by("Tier") if "Tier" in last.columns else []}


def workforce(store: Store, today: dt.date) -> dict | None:
    if not store.exists("clean/staff_list/latest.json.gz"):
        return None
    staff = store.read_table("clean/staff_list/latest.json.gz")
    leaving = staff[staff["Last Employment Date"].notna()
                    & (staff["Last Employment Date"] >= pd.Timestamp(today.replace(day=1)))].copy()
    leaving["month"] = leaving["Last Employment Date"].dt.strftime("%Y-%m")
    rows = []
    for month, part in leaving.groupby("month"):
        bands = {b: int((part["Band"] == int(b[1])).sum()) for b in BANDS}
        rows.append({"month": month, **bands, "total": int(len(part))})
    return {"upcomingLeavers": rows, "upcomingLeaversTotal": int(len(leaving))}


def build(store: Store, today: dt.date | None = None) -> dict:
    today = today or dt.date.today()
    parts = {"pipeline": sales_pipeline(store, today), "resources": resources(store, today),
             "utilisation": utilisation(store), "workforce": workforce(store, today)}
    notes = []
    if parts["pipeline"] is None:
        notes.append("no SFDC pipeline uploaded yet")
    if parts["resources"] is None:
        notes.append("no review has been completed yet, so there are no roll-off and bench figures")
    return {"version": 1, "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "asOf": today.isoformat(), "currency": "USD", **parts,
            "sources": {d: _source(store, d) for d in ("sfdc_pipeline", "bu_ur", "staff_list")},
            "notes": notes}


def write(store: Store) -> dict:
    data = json.loads(json.dumps(build(store), default=str))   # plain JSON (no numpy or NaN surprises)
    store.write_json(KEY, data)
    return data
