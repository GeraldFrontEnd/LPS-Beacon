"""Stage 4: forecast tables for the dashboard, the analysis tab and the chatbot.

Inputs: the cleaned month-level tables (resource plan = supply, quote lines =
demand) and the sheets returned by your matching script.

Outputs (all aggregates, all repeatable from the same inputs):
  headcount_monthly        per month x standardised position: supply/demand FTE and
                           heads, gap, actual vs forecast, fiscal year/half/quarter,
                           plus *_projected_fte = plan + FY-end renewals x RENEWAL_RATE
  headcount_fiscal         the same rolled up to FY, half and quarter
  project_variance         per quote line x month: sold MDs (QL) vs planned MDs (RP),
                           variance and variance % (the "Variance" column)
  project_variance_fy      the same per quote line per fiscal year
  unlinked_plan            resource-plan months with no quote line (pre-sales, internal)
  availability_by_role     resources by availability status per role (from matching)
  availability_forecast,
  forecast_6_12m_summary   passed through from your matching script when it returns them
  role_coverage            how many rows got a standardised position (data quality)
  kpis                     a small dict of headline numbers

Months missing from a source file (the resource-plan export has no "Apr" column) are
"no data", not zero: their supply (or demand) figures are empty and flagged, and they
are left out of averages and of the worst-month gap. Treating them as zero showed every
April as a large shortfall.
Finance only, and only if a rates file was uploaded:
  finance_monthly, finance_by_project   revenue, cost, margin, margin per FTE
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import fiscal
from .config import Config

UNMAPPED = "UNMAPPED - FOR REVIEW"


# ---------------------------------------------------------------- helpers
def _role_lookup(matching: dict[str, pd.DataFrame]) -> dict[str, str]:
    """Position Name -> Standardized Position, taken from your matching output."""
    lookup: dict[str, str] = {}
    pm = matching.get("position_mapping")
    if pm is not None and {"Position Name", "Standardized Position"} <= set(pm.columns):
        lookup.update(zip(pm["Position Name"].astype(str), pm["Standardized Position"].astype(str)))
    # Rows in the matching sheets carry the role too; use them for names not listed above.
    for sheet in ("matching", "unmatched_resources", "unmatched_projects"):
        df = matching.get(sheet)
        if df is None:
            continue
        for side in ("PRP", "QL"):
            name, role = f"{side} | Position Name", f"{side} | Standardized Position"
            if {name, role} <= set(df.columns):
                pairs = df[[name, role]].dropna().astype(str)
                for n, r in zip(pairs[name], pairs[role]):
                    lookup.setdefault(n, r)
    return lookup


def _assign_roles(long: pd.DataFrame, lookup: dict[str, str],
                  matching: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Role per row: your script's standardize_positions() result first (by name and
    grade), then the names found in the matching sheets, otherwise UNMAPPED."""
    out = long.copy()
    by_name = out["position_name"].astype(str).map(lookup)
    full = matching.get("position_lookup_all")
    if full is not None and len(full):
        keyed = {(str(n), str(g)): r for n, g, r in
                 zip(full["Position Name"], full["Grade"], full["Standardized Position"])}
        by_grade = pd.Series([keyed.get((str(n), str(g))) for n, g in
                              zip(out["position_name"], out["grade"])], index=out.index)
        by_name = by_grade.where(by_grade.notna(), by_name)
    out["standardized_position"] = by_name.fillna(UNMAPPED).astype(str)
    out.loc[out["standardized_position"].str.startswith("UNMAPPED"), "standardized_position"] = UNMAPPED
    return out


def _fill_project_ids(ql: pd.DataFrame, rp: pd.DataFrame) -> tuple[pd.DataFrame, int]:
    """Quote lines often lack a Project ID; borrow it from rows with the same quote line."""
    known = pd.concat([ql[["quote_line", "project_id"]], rp[["quote_line", "project_id"]]]).dropna()
    known = known.drop_duplicates("quote_line").set_index("quote_line")["project_id"]
    missing = ql["project_id"].isna()
    out = ql.copy()
    out.loc[missing, "project_id"] = out.loc[missing, "quote_line"].map(known)
    filled = int(missing.sum() - out["project_id"].isna().sum())
    return out, filled


def missing_months(wide: pd.DataFrame) -> list[str]:
    """Fiscal month columns the cleaned source file does not have."""
    return [m for m in fiscal.FY_MONTHS if m not in wide.columns]


def _month_name(series: pd.Series) -> pd.Series:
    return pd.to_datetime(series).dt.strftime("%b")


def _blank_missing(out: pd.DataFrame, months: list[str], cols: list[str], flag: str) -> pd.DataFrame:
    """Empties cols on rows whose calendar month has no column in the source file."""
    mask = _month_name(out["month"]).isin(months) if months else pd.Series(False, index=out.index)
    for col in cols:
        if col in out:
            if pd.api.types.is_integer_dtype(out[col]):
                out[col] = out[col].astype("Int64")
            out[col] = out[col].mask(mask)
    out[flag] = mask.to_numpy()
    return out


def _period(df: pd.DataFrame, as_of) -> pd.DataFrame:
    out = fiscal.add_period_columns(df, "month")
    out["period_type"] = np.where(pd.to_datetime(out["month"]) < pd.Timestamp(as_of), "actual", "forecast")
    return out


def _round(df: pd.DataFrame, digits: int = 2) -> pd.DataFrame:
    numeric = df.select_dtypes("number").columns
    out = df.copy()
    out[numeric] = out[numeric].round(digits)
    return out


def _safe_pct(num: pd.Series, den: pd.Series) -> pd.Series:
    return (num / den.replace(0, np.nan) * 100).round(1)


# ---------------------------------------------------------------- renewals
CONTINUATION_KEY = ["project_id", "quote_line", "position_name", "resource", "grade"]


def _key(df: pd.DataFrame, cols: list[str]) -> pd.Series:
    part = df[cols].astype(object)
    return part.where(part.notna(), "").map(str).agg("|".join, axis=1)


def project_renewals(long: pd.DataFrame, as_of, window_months: int, renewal_rate: float) -> pd.DataFrame:
    """Rows for months after the plan runs out, for lines that end at fiscal-year end.

    Most plan lines stop in March because nobody has planned the next fiscal year
    yet, not because the work ends. For a line still running on the planning date
    whose last month is March, with no row for the same line in the next fiscal
    year, this adds one row per month up to
    the end of the window at (March MDs x renewal_rate). The result is clearly
    flagged as projected; the plan figures stay untouched.
    """
    horizon_end = pd.Timestamp(fiscal.add_months(as_of, window_months))
    active = long[long["mds"] > 0]
    if active.empty:
        return long.iloc[0:0].assign(projected=True)
    last = active.sort_values("month").groupby("row_id").tail(1)
    last_month = pd.to_datetime(last["month"])
    # Only lines still running on the planning date: a line that ended last year is
    # history, and quote lines are re-issued with a new number when a contract renews.
    last = last[(last_month.dt.month == 3) & (last_month >= pd.Timestamp(as_of))]

    key = _key(active, CONTINUATION_KEY)
    fy_start = pd.to_datetime(active["month"]).map(lambda d: d.year if d.month >= 4 else d.year - 1)
    has_fy = set(zip(key, fy_start))
    last_key = _key(last, CONTINUATION_KEY)
    next_fy = pd.to_datetime(last["month"]).dt.year  # March 2027 -> next FY starts 2027
    last = last[[(k, y) not in has_fy for k, y in zip(last_key, next_fy)]]

    rows = []
    for rec in last.to_dict("records"):
        month = pd.Timestamp(rec["month"])
        step = fiscal.add_months(month.date(), 1)
        while pd.Timestamp(step) < horizon_end:
            if pd.Timestamp(step) >= pd.Timestamp(as_of):
                rows.append({**rec, "month": pd.Timestamp(step), "mds": rec["mds"] * renewal_rate,
                             "fte": rec["fte"] * renewal_rate, "fy_month": step.strftime("%b")})
            step = fiscal.add_months(step, 1)
    out = pd.DataFrame(rows, columns=list(long.columns))
    return out.assign(projected=True)


# ---------------------------------------------------------------- tables
def headcount_monthly(supply: pd.DataFrame, demand: pd.DataFrame, supply_proj: pd.DataFrame,
                      demand_proj: pd.DataFrame, as_of, supply_missing: list[str] = (),
                      demand_missing: list[str] = ()) -> pd.DataFrame:
    """Plan figures plus 'projected' figures = plan + FY-end renewals (see above)."""
    keys = ["month", "standardized_position"]

    def agg(df: pd.DataFrame, side: str) -> pd.DataFrame:
        return df.groupby(keys).agg(**{f"{side}_fte": ("fte", "sum"), f"{side}_mds": ("mds", "sum"),
                                       f"{side}_heads": ("mds", lambda x: int((x > 0).sum()))})

    parts = [agg(supply, "supply"), agg(demand, "demand")]
    if len(supply_proj):
        parts.append(supply_proj.groupby(keys)["fte"].sum().rename("supply_renewal_fte").to_frame())
    if len(demand_proj):
        parts.append(demand_proj.groupby(keys)["fte"].sum().rename("demand_renewal_fte").to_frame())
    out = pd.concat(parts, axis=1).fillna(0).reset_index()
    for col in ("supply_renewal_fte", "demand_renewal_fte"):
        if col not in out:
            out[col] = 0.0
    for c in ("supply_heads", "demand_heads"):
        out[c] = out[c].astype(int)
    out["gap_fte"] = out["supply_fte"] - out["demand_fte"]
    out["supply_projected_fte"] = out["supply_fte"] + out["supply_renewal_fte"]
    out["demand_projected_fte"] = out["demand_fte"] + out["demand_renewal_fte"]
    out["gap_projected_fte"] = out["supply_projected_fte"] - out["demand_projected_fte"]
    gaps = ["gap_fte", "gap_projected_fte"]
    out = _blank_missing(out, list(supply_missing), ["supply_fte", "supply_mds", "supply_heads",
                         "supply_renewal_fte", "supply_projected_fte"] + gaps, "supply_data_missing")
    out = _blank_missing(out, list(demand_missing), ["demand_fte", "demand_mds", "demand_heads",
                         "demand_renewal_fte", "demand_projected_fte"] + gaps, "demand_data_missing")
    return _round(_period(out, as_of)).sort_values(keys).reset_index(drop=True)


def headcount_fiscal(monthly: pd.DataFrame) -> pd.DataFrame:
    """Average FTE per month in each period (not a sum, which would overstate headcount)."""
    frames = []
    for level, cols in (("fy", ["fy"]), ("half", ["fy", "half"]), ("quarter", ["fy", "quarter"])):
        total = monthly.groupby(cols + ["month"])[
            ["supply_fte", "demand_fte", "supply_projected_fte", "demand_projected_fte"]
        ].sum(min_count=1).reset_index()
        g = total.groupby(cols).agg(avg_supply_fte=("supply_fte", "mean"),
                                    avg_demand_fte=("demand_fte", "mean"),
                                    avg_supply_projected_fte=("supply_projected_fte", "mean"),
                                    avg_demand_projected_fte=("demand_projected_fte", "mean"),
                                    months=("month", "nunique"),
                                    months_with_supply_data=("supply_fte", "count"),
                                    months_with_demand_data=("demand_fte", "count")).reset_index()
        g["level"] = level
        g["period"] = g[cols].astype(str).agg(" ".join, axis=1)
        frames.append(g[["level", "period", "months", "months_with_supply_data",
                         "months_with_demand_data", "avg_supply_fte", "avg_demand_fte",
                         "avg_supply_projected_fte", "avg_demand_projected_fte"]])
    out = pd.concat(frames, ignore_index=True)
    out["avg_gap_fte"] = out["avg_supply_fte"] - out["avg_demand_fte"]
    out["avg_gap_projected_fte"] = out["avg_supply_projected_fte"] - out["avg_demand_projected_fte"]
    return _round(out)


def project_variance(ql: pd.DataFrame, rp: pd.DataFrame, as_of, rp_missing: list[str] = (),
                     ql_missing: list[str] = ()) -> tuple[pd.DataFrame, pd.DataFrame]:
    info_cols = ["project_id", "customer", "project_name", "project_type"]
    info = (pd.concat([ql[["quote_line"] + info_cols], rp[["quote_line"] + info_cols]])
            .dropna(subset=["quote_line"]).drop_duplicates("quote_line").set_index("quote_line"))
    sold = ql.groupby(["quote_line", "month"])["mds"].sum().rename("sold_mds")
    planned = (rp.dropna(subset=["quote_line"]).groupby(["quote_line", "month"])["mds"]
               .sum().rename("planned_mds"))
    out = pd.concat([sold, planned], axis=1).fillna(0).reset_index()
    names = _month_name(out["month"])
    out.loc[names.isin(list(rp_missing)), "planned_mds"] = np.nan   # no plan column, not zero plan
    out.loc[names.isin(list(ql_missing)), "sold_mds"] = np.nan
    out["comparable"] = out["planned_mds"].notna() & out["sold_mds"].notna()
    out["variance_mds"] = (out["planned_mds"] - out["sold_mds"]).round(2)
    out["variance_pct"] = _safe_pct(out["variance_mds"], out["sold_mds"])
    out = out.join(info, on="quote_line")
    out = _period(out, as_of)
    out = out[["quote_line"] + info_cols + ["month", "fy", "half", "quarter", "fy_quarter",
                                            "period_type", "sold_mds", "planned_mds",
                                            "variance_mds", "variance_pct", "comparable"]]

    # FY variance compares only months present in BOTH files.
    cmp = out[out["comparable"]]
    fy = out.groupby(["quote_line", "fy"]).agg(sold_mds=("sold_mds", "sum"),
                                               planned_mds=("planned_mds", "sum"),
                                               months_without_data=("comparable", lambda c: int((~c).sum())))
    fy = fy.join(cmp.groupby(["quote_line", "fy"]).agg(comparable_sold_mds=("sold_mds", "sum"),
                                                       variance_mds=("variance_mds", "sum")))
    fy = fy.reset_index()
    fy["variance_pct"] = _safe_pct(fy["variance_mds"], fy["comparable_sold_mds"])
    fy = fy.join(info, on="quote_line")
    return out.sort_values(["quote_line", "month"]).reset_index(drop=True), _round(fy)


def unlinked_plan(rp: pd.DataFrame, as_of) -> pd.DataFrame:
    rows = rp[rp["quote_line"].isna()]
    out = (rows.groupby(["month", "project_type"], dropna=False)
           .agg(planned_mds=("mds", "sum"), planned_fte=("fte", "sum"), lines=("row_id", "nunique"))
           .reset_index())
    out["project_type"] = out["project_type"].fillna("(blank)")
    return _round(_period(out, as_of))


def availability_by_role(matching: dict[str, pd.DataFrame]) -> pd.DataFrame:
    frames = [matching[s] for s in ("matching", "unmatched_resources") if s in matching]
    cols = ["PRP | Standardized Position", "PRP | Availability Status"]
    frames = [f[cols + (["Match Status"] if "Match Status" in f else [])]
              for f in frames if set(cols) <= set(f.columns)]
    if not frames:
        return pd.DataFrame(columns=["standardized_position", "availability_status",
                                     "resources", "matched", "unmatched"])
    df = pd.concat(frames, ignore_index=True).dropna(subset=cols)
    df["is_matched"] = df.get("Match Status", pd.Series("", index=df.index)).eq("MATCHED")
    out = (df.groupby(cols).agg(resources=("is_matched", "size"), matched=("is_matched", "sum"))
           .reset_index().rename(columns={cols[0]: "standardized_position",
                                          cols[1]: "availability_status"}))
    out["unmatched"] = out["resources"] - out["matched"]
    return out.sort_values(["standardized_position", "availability_status"]).reset_index(drop=True)


def role_coverage(supply: pd.DataFrame, demand: pd.DataFrame, as_of, window_months: int) -> pd.DataFrame:
    end = pd.Timestamp(fiscal.add_months(as_of, window_months))
    rows = []
    for name, df in (("resource_plan", supply), ("quoteline", demand)):
        for scope, part in (("all months", df),
                            ("forecast window", df[(df["month"] >= pd.Timestamp(as_of)) & (df["month"] < end)])):
            lines = part.drop_duplicates("row_id")
            mapped = int((lines["standardized_position"] != UNMAPPED).sum())
            rows.append({"dataset": name, "scope": scope, "lines": len(lines), "mapped": mapped,
                         "mapped_pct": round(mapped / len(lines) * 100, 1) if len(lines) else None})
    return pd.DataFrame(rows)


def finance(ql: pd.DataFrame, rp: pd.DataFrame, rates: pd.DataFrame, as_of):
    """Revenue = sold MDs x Daily Rate; cost = planned MDs x Daily Cost."""
    by_role = "Standard Role" in rates.columns

    def price(df: pd.DataFrame, value_col: str) -> pd.Series:
        if value_col not in rates.columns:
            return pd.Series(np.nan, index=df.index)
        grade_only = rates.drop_duplicates("Grade").set_index("Grade")[value_col]
        result = df["grade"].map(grade_only)
        if by_role:
            specific = rates.dropna(subset=["Standard Role"]).set_index(["Standard Role", "Grade"])[value_col]
            keys = list(zip(df["standardized_position"], df["grade"]))
            role_price = pd.Series([specific.get(k, np.nan) for k in keys], index=df.index)
            result = role_price.fillna(result)
        return result

    q = ql.assign(revenue=ql["mds"] * price(ql, "Daily Rate"))
    r = rp.assign(cost=rp["mds"] * price(rp, "Daily Cost"))
    rev = q.groupby("month")["revenue"].sum(min_count=1)
    cost = r.groupby("month")["cost"].sum(min_count=1)
    fte = r.groupby("month")["fte"].sum()
    monthly = pd.concat([rev, cost, fte.rename("planned_fte")], axis=1).reset_index()
    monthly["margin"] = monthly["revenue"] - monthly["cost"]
    monthly["margin_pct"] = _safe_pct(monthly["margin"], monthly["revenue"])
    monthly["margin_per_fte"] = monthly["margin"] / monthly["planned_fte"].replace(0, np.nan)
    monthly = _round(_period(monthly, as_of))

    proj_rev = q.groupby(["quote_line", "fiscal_year"])["revenue"].sum(min_count=1)
    proj_cost = r.dropna(subset=["quote_line"]).groupby(["quote_line", "fiscal_year"])["cost"].sum(min_count=1)
    by_project = pd.concat([proj_rev, proj_cost], axis=1).reset_index()
    by_project["margin"] = by_project["revenue"] - by_project["cost"]
    by_project["margin_pct"] = _safe_pct(by_project["margin"], by_project["revenue"])
    unpriced = {"quoteline_rows_without_rate": int(q["revenue"].isna().sum()),
                "resource_plan_rows_without_cost": int(r["cost"].isna().sum())}
    return monthly, _round(by_project), unpriced


# ---------------------------------------------------------------- stage entry point
def run(cfg: Config, inputs: dict, matching: dict[str, pd.DataFrame]) -> tuple[dict, dict, dict, list[str]]:
    """Returns (tables, finance_tables, kpis, warnings)."""
    warnings: list[str] = []
    lookup = _role_lookup(matching)
    rp = _assign_roles(inputs["resource_plan"]["long"], lookup, matching)
    ql = _assign_roles(inputs["quoteline"]["long"], lookup, matching)
    for df in (rp, ql):
        df["month"] = pd.to_datetime(df["month"])
    ql, filled = _fill_project_ids(ql, rp)
    if filled:
        warnings.append(f"{filled} quote-line month rows got their Project ID from the same quote line")

    as_of = cfg.as_of
    rp_missing = missing_months(inputs["resource_plan"]["wide"])
    ql_missing = missing_months(inputs["quoteline"]["wide"])
    rp_proj = project_renewals(rp, as_of, cfg.window_months, cfg.renewal_rate)
    ql_proj = project_renewals(ql, as_of, cfg.window_months, cfg.renewal_rate)
    monthly = headcount_monthly(rp, ql, rp_proj, ql_proj, as_of, rp_missing, ql_missing)
    variance, variance_fy = project_variance(ql, rp, as_of, rp_missing, ql_missing)
    coverage = role_coverage(rp, ql, as_of, cfg.window_months)
    tables = {
        "headcount_monthly": monthly,
        "headcount_fiscal": headcount_fiscal(monthly),
        "project_variance": variance,
        "project_variance_fy": variance_fy,
        "unlinked_plan": unlinked_plan(rp, as_of),
        "availability_by_role": availability_by_role(matching),
        "role_coverage": coverage,
    }
    for passthrough in ("availability_forecast", "forecast_6_12m_summary"):
        if passthrough in matching:
            tables[passthrough] = matching[passthrough]
        else:
            warnings.append(f"matching did not return '{passthrough}'; dashboard chart will be empty")

    window = coverage[(coverage["scope"] == "forecast window")]
    for _, row in window.iterrows():
        if row["mapped_pct"] is not None and row["mapped_pct"] < 90:
            warnings.append(f"only {row['mapped_pct']}% of {row['dataset']} lines in the forecast "
                            "window have a standardised position; add the names listed in "
                            "Positions For Review to the Position Name Mapping and upload it again")

    finance_tables: dict = {}
    if "rates" in inputs:
        f_monthly, f_project, unpriced = finance(ql, rp, inputs["rates"]["table"], as_of)
        finance_tables = {"finance_monthly": f_monthly, "finance_by_project": f_project}
        if any(unpriced.values()):
            warnings.append(f"rows without a rate: {unpriced}")
    else:
        warnings.append("no rates file uploaded; revenue, cost and P&L were skipped")

    kpis = _kpis(cfg, monthly, variance, matching)
    kpis["dataGaps"] = {"resourcePlanMissingMonths": rp_missing, "quoteLineMissingMonths": ql_missing}
    return tables, finance_tables, kpis, warnings


def _kpis(cfg: Config, monthly: pd.DataFrame, variance: pd.DataFrame, matching: dict) -> dict:
    start = pd.Timestamp(cfg.as_of)
    kpi: dict = {"asOf": cfg.as_of.isoformat(), "windowMonths": cfg.window_months}
    for months in (6, 12):
        end = pd.Timestamp(fiscal.add_months(cfg.as_of, months))
        part = monthly[(monthly["month"] >= start) & (monthly["month"] < end)]
        totals = part.groupby("month")[["supply_fte", "demand_fte", "supply_projected_fte",
                                        "demand_projected_fte"]].sum(min_count=1)
        gap = (totals["supply_fte"] - totals["demand_fte"]).dropna()

        def avg(col: str) -> float:
            value = totals[col].mean() if len(totals) else 0.0
            return round(float(value), 1) if pd.notna(value) else 0.0

        kpi[f"next{months}m"] = {
            "avgSupplyFte": avg("supply_fte"), "avgDemandFte": avg("demand_fte"),
            "avgSupplyProjectedFte": avg("supply_projected_fte"),
            "avgDemandProjectedFte": avg("demand_projected_fte"),
            "worstMonthGapFte": round(float(gap.min()), 1) if len(gap) else 0.0,
            "worstMonth": gap.idxmin().strftime("%Y-%m") if len(gap) else None,
            "monthsWithoutData": [m.strftime("%Y-%m") for m in totals.index
                                  if totals.loc[m, ["supply_fte", "demand_fte"]].isna().any()],
        }
    kpi["renewalRate"] = cfg.renewal_rate
    fwd = variance[variance["month"] >= start]
    kpi["linesOverPlanned"] = int((fwd.groupby("quote_line")["variance_mds"].sum() > 0).sum())
    kpi["linesUnderPlanned"] = int((fwd.groupby("quote_line")["variance_mds"].sum() < 0).sum())
    summary = matching.get("summary")
    if summary is not None and {"Item", "Value"} <= set(summary.columns):
        items = dict(zip(summary["Item"].astype(str), summary["Value"]))
        for label, key in (("MATCHED", "matched"), ("UNMATCHED RESOURCE", "unmatchedResources"),
                           ("UNMATCHED PROJECT", "unmatchedProjects")):
            if label in items:
                kpi[key] = _plain(items[label])
    review = matching.get("positions_for_review")
    if review is not None:
        kpi["positionsForReview"] = int(len(review))
    return kpi


def _plain(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return str(value)
