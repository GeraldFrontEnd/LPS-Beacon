"""Adapter between the pipeline and matching_python_script.py (your matching logic).

matching_python_script.py is used UNCHANGED: this file calls the same functions its
main() calls (load_taxonomy, read_table, standardise, line_table, run_match, assemble,
clean_output) with the pipeline's settings instead of command-line arguments, and
returns the sheets instead of writing Excel files.

Inputs come from pipeline/matching.py:
  rp_source_path / ql_source_path  the ORIGINAL uploads, so read_table() sees exactly the
                                   file the user sent (fallback: the cleaned CSV copies)
  mapping_path                     the Position Name Mapping workbook
  as_of, window_months, grade_tolerance, max_idle_months, skill_threshold
                                   = --as-of, --horizon, --grade-tol, --max-idle, --skill-thr

Sheets returned
  From your script:   Summary, Matching, Matched, Unmatched Resources, Unmatched Projects,
                      Clean Resource Plan, Clean Quoteline
  Added here, built only from your script's results (no new matching logic):
    Position Mapping        every position name -> standardized position, with row counts
    Positions For Review    names your rules left UNMAPPED (fill these in the mapping file)
    Position Lookup All     (Position Name, Grade) -> standardized position, used by the
                            forecast stage to give every month row a role
    Availability Forecast   per role and month in the window: resources becoming free
                            (confirmed end vs FY-end plan), pipeline demand starting,
                            matches, cumulative surplus / unfilled, coverage %
    Forecast 6-12m Summary  the same totalled for the next 6 and 12 months, plus ALL ROLES
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import matching_python_script as core  # noqa: E402  (your script, unchanged)

UNMAPPED = core.UNMAPPED
LAST_WARNINGS: list[str] = []


def run_matching(mapping_path, as_of, window_months, grade_tolerance, max_idle_months,
                 rp_path=None, ql_path=None, rp_source_path=None, ql_source_path=None,
                 skill_threshold=0.15, renewal_rate=0.8, rp_full_month_mds=18.0,
                 ql_full_month_mds=18.5, rp_source_key=None, ql_source_key=None):
    if not mapping_path:
        core.fail("no Position Name Mapping has been uploaded yet; the matching needs it to "
                  "standardise position names. Upload the mapping workbook and run again.")

    # EXTRACT (same calls as main())
    tax = core.load_taxonomy(mapping_path)
    prp_raw = core.read_table(Path(rp_source_path or rp_path), "resource plan")
    ql_raw = core.read_table(Path(ql_source_path or ql_path), "quote line")
    as_of = pd.Timestamp(as_of).replace(day=1)

    # TRANSFORM
    prp, ql = core.standardise(prp_raw, tax), core.standardise(ql_raw, tax)
    prp_d, prp_lines = core.line_table(prp)
    ql_d, ql_lines = core.line_table(ql)
    prp["Line ID"], ql["Line ID"] = prp_d["Line ID"].values, ql_d["Line ID"].values

    end_of_window = as_of + pd.DateOffset(months=window_months)
    s = prp_lines[prp_lines["Available From"] < end_of_window].copy()
    s["Availability Status"] = np.select(
        [s["Available From"] <= as_of, s["Available From"] < as_of + pd.DateOffset(months=6)],
        ["Available now", "Rolling off 0-6m"], "Rolling off 7-12m")
    d = ql_lines[(ql_lines["Start Date"] >= as_of) & (ql_lines["Start Date"] < end_of_window)].copy()
    if s.empty:
        core.warn(f"no resource becomes free between {as_of:%d-%m-%y} and {end_of_window:%d-%m-%y}")
    if d.empty:
        core.warn(f"no quote line starts between {as_of:%d-%m-%y} and {end_of_window:%d-%m-%y}")

    # MATCH
    sup, dem, pairs, sfree, dfree = core.run_match(s, d, grade_tolerance, max_idle_months, skill_threshold)
    res = core.assemble(sup, dem, pairs, sfree, dfree)

    # LOAD (same tables as main(), returned instead of written)
    status = res["Match Status"]

    def lean(frame):
        return frame.dropna(axis=1, how="all")

    unmapped_rows = f"{int((prp['Standardized Position'] == UNMAPPED).sum())} / " \
                    f"{int((ql['Standardized Position'] == UNMAPPED).sum())}"
    summary = pd.DataFrame({"Item": [
        "Planning date (as-of)", "Rolling window (months)", "Resources available in window",
        "Quote lines starting in window", "MATCHED", "UNMATCHED RESOURCE", "UNMATCHED PROJECT",
        "Grade tolerance (+/-)", "Max idle months", "Skill similarity threshold",
        "Position names not standardized (resource plan / quote line rows)",
        "Resource plan file", "Quote line file", "Mapping file"],
        "Value": [as_of.strftime("%d-%m-%y"), window_months, len(sup), len(dem),
                  int((status == "MATCHED").sum()), int((status == "UNMATCHED RESOURCE").sum()),
                  int((status == "UNMATCHED PROJECT").sum()), grade_tolerance, max_idle_months,
                  skill_threshold, unmapped_rows, _name(rp_source_key, rp_source_path or rp_path),
                  _name(ql_source_key, ql_source_path or ql_path), "Position Name Mapping"]})
    summary["Value"] = summary["Value"].astype(str)

    sheets = {
        "Summary": summary,
        "Matching": res,
        "Matched": lean(res[status == "MATCHED"]),
        "Unmatched Resources": lean(res[status == "UNMATCHED RESOURCE"]),
        "Unmatched Projects": lean(res[status == "UNMATCHED PROJECT"]),
        "Clean Resource Plan": core.clean_output(prp, prp_lines),
        "Clean Quoteline": core.clean_output(ql, ql_lines),
    }
    sheets.update(position_sheets(prp, ql))
    sheets.update(availability_sheets(sup, dem, pairs, as_of, window_months, renewal_rate,
                                      rp_full_month_mds, ql_full_month_mds))
    return sheets


def _name(key, path) -> str:
    return (key or str(path or "")).rsplit("/", 1)[-1]


# ---------------------------------------------------------------- position tables
def position_sheets(prp: pd.DataFrame, ql: pd.DataFrame) -> dict[str, pd.DataFrame]:
    both = pd.concat([prp.assign(_src="PRP"), ql.assign(_src="QL")], ignore_index=True)
    both = both[both["Position Name"].notna()]
    both["Position Name"] = both["Position Name"].astype(str)
    counts = both.pivot_table(index="Position Name", columns="_src", values="Fiscal Year",
                              aggfunc="size", fill_value=0).reindex(columns=["PRP", "QL"], fill_value=0)
    first = both.drop_duplicates("Position Name").set_index("Position Name")

    mapping = first[["Standardized Position", "Std Role Family", "Std Level", "Std Skill Family"]].copy()
    mapping["PRP rows"], mapping["QL rows"] = counts["PRP"], counts["QL"]
    mapping["Std Position Status"] = np.where(mapping["Standardized Position"] == UNMAPPED,
                                              "UNMAPPED - FOR REVIEW", "MAPPED")
    mapping = mapping.reset_index().sort_values(["Std Position Status", "Position Name"])

    unmapped = both[both["Standardized Position"] == UNMAPPED]
    review = pd.DataFrame(columns=["Review Flag", "Position Name", "PRP rows", "QL rows", "Grade(s)",
                                   "Example Project ID", "Example Customer",
                                   "Skill family (from Skill)", "Standard Role (please fill)"])
    if len(unmapped):
        g = unmapped.groupby("Position Name")
        review = pd.DataFrame({
            "Review Flag": "FOR REVIEW - position name unmapped",
            "PRP rows": counts["PRP"], "QL rows": counts["QL"],
            "Grade(s)": g["Grade"].agg(lambda x: ", ".join(str(int(v)) for v in sorted(x.dropna().unique()))),
            "Example Project ID": g["Project ID"].first() if "Project ID" in unmapped else None,
            "Example Customer": g["Customer"].first() if "Customer" in unmapped else None,
            "Skill family (from Skill)": g["Std Skill Family"].first(),
            "Standard Role (please fill)": "",
        }).loc[g.size().index].reset_index().rename(columns={"index": "Position Name"})
        review = review[["Review Flag", "Position Name"] + [c for c in review.columns
                                                              if c not in ("Review Flag", "Position Name")]]
        review = review.sort_values(["PRP rows", "QL rows"], ascending=False)

    lookup = both[["Position Name", "Grade", "Standardized Position"]].copy()
    lookup["Grade"] = pd.to_numeric(lookup["Grade"], errors="coerce").round().astype("Int64")
    lookup = lookup.drop_duplicates(["Position Name", "Grade"]).reset_index(drop=True)
    return {"Position Mapping": mapping, "Positions For Review": review.reset_index(drop=True),
            "Position Lookup All": lookup}


# ---------------------------------------------------------------- availability tables
def availability_sheets(sup, dem, pairs, as_of, window_months, renewal_rate,
                        rp_full_month_mds, ql_full_month_mds) -> dict[str, pd.DataFrame]:
    months = pd.date_range(as_of, periods=window_months, freq="MS")
    six = as_of + pd.DateOffset(months=6)

    s = sup.copy()
    s["Month"] = s["Available From"].clip(lower=as_of)          # "available now" counts in month 1
    s["Role"] = s["Standardized Position"]
    s["conf"] = (s["Availability Basis"] == "CONFIRMED_END").astype(int)
    s["fy"] = 1 - s["conf"]
    s["fte"] = s["Last MDs"].fillna(0) / rp_full_month_mds
    q = dem.copy()
    q["Month"], q["Role"] = q["Start Date"], q["Standardized Position"]
    q["fte"] = q["Start MDs"].fillna(0) / ql_full_month_mds
    m = pd.DataFrame([{"Month": dem.at[j, "Start Date"], "QL Role": dem.at[j, "Standardized Position"],
                       "PRP Role": sup.at[i, "Standardized Position"]} for i, j, _, _ in pairs],
                     columns=["Month", "QL Role", "PRP Role"])

    roles = sorted(set(s["Role"].dropna()) | set(q["Role"].dropna()))
    grid = pd.MultiIndex.from_product([roles, months], names=["Standardized Position", "Month"])

    def count(df, role_col, value, name):
        if df.empty:
            return pd.Series(0.0, index=grid, name=name)
        return (df.groupby([role_col, "Month"])[value].sum()
                .rename_axis(["Standardized Position", "Month"]).reindex(grid, fill_value=0).rename(name))

    m["one"] = 1
    t = pd.concat([
        count(s, "Role", "conf", "New Available - confirmed end"),
        count(s, "Role", "fy", "New Available - FY-end (plan)"),
        count(s, "Role", "fte", "New Available FTE"),
        count(q.assign(one=1), "Role", "one", "Pipeline Demand Starting"),
        count(q, "Role", "fte", "Pipeline Demand FTE"),
        count(m, "QL Role", "one", "Matched Starting"),
        count(m, "PRP Role", "one", "_matched_supply"),
    ], axis=1).reset_index()

    g = t.groupby("Standardized Position")
    new_plan = t["New Available - confirmed end"] + t["New Available - FY-end (plan)"]
    new_risk = t["New Available - confirmed end"] + t["New Available - FY-end (plan)"] * (1 - renewal_rate)
    t["Cumulative Available (plan)"] = new_plan.groupby(t["Standardized Position"]).cumsum()
    t["Cumulative Available (risk-adjusted)"] = new_risk.groupby(t["Standardized Position"]).cumsum()
    t["Cumulative Demand"] = g["Pipeline Demand Starting"].cumsum()
    t["Cumulative Matched"] = g["Matched Starting"].cumsum()
    t["Surplus Resources After Matching"] = t["Cumulative Available (plan)"] - g["_matched_supply"].cumsum()
    t["Unfilled Pipeline (cumulative)"] = t["Cumulative Demand"] - t["Cumulative Matched"]
    t["Coverage % (cum. matched / cum. demand)"] = (
        t["Cumulative Matched"] / t["Cumulative Demand"].replace(0, np.nan) * 100).round(1)
    t["Horizon"] = np.where(t["Month"] < six, "0-6 months", "7-12 months")
    for c in ("New Available FTE", "Pipeline Demand FTE", "Cumulative Available (risk-adjusted)"):
        t[c] = t[c].round(2)
    forecast = t[["Month", "Horizon", "Standardized Position", "New Available - confirmed end",
                  "New Available - FY-end (plan)", "New Available FTE", "Cumulative Available (plan)",
                  "Cumulative Available (risk-adjusted)", "Pipeline Demand Starting", "Pipeline Demand FTE",
                  "Matched Starting", "Cumulative Matched", "Surplus Resources After Matching",
                  "Unfilled Pipeline (cumulative)", "Coverage % (cum. matched / cum. demand)"]]
    int_cols = ["New Available - confirmed end", "New Available - FY-end (plan)", "Cumulative Available (plan)",
                "Pipeline Demand Starting", "Matched Starting", "Cumulative Matched",
                "Surplus Resources After Matching", "Unfilled Pipeline (cumulative)"]
    forecast = forecast.astype({c: int for c in int_cols})

    rows = []
    for label, end in (("Next 6 months", six), ("Next 12 months", as_of + pd.DateOffset(months=window_months))):
        part = t[t["Month"] < end]
        agg = part.groupby("Standardized Position").agg(
            new_conf=("New Available - confirmed end", "sum"), new_fy=("New Available - FY-end (plan)", "sum"),
            demand=("Pipeline Demand Starting", "sum"), matched=("Matched Starting", "sum"),
            matched_supply=("_matched_supply", "sum"))
        agg.loc["ALL ROLES"] = agg.sum()
        agg = agg.reindex(["ALL ROLES"] + [r for r in agg.index if r != "ALL ROLES"])
        agg["Cumulative Available (plan)"] = agg["new_conf"] + agg["new_fy"]
        agg["Cumulative Available (risk-adjusted)"] = (agg["new_conf"] + agg["new_fy"] * (1 - renewal_rate)).round(2)
        agg["Surplus Resources After Matching"] = agg["Cumulative Available (plan)"] - agg["matched_supply"]
        agg["Unfilled Pipeline (cumulative)"] = agg["demand"] - agg["matched"]
        agg.insert(0, "Window", label)
        rows.append(agg.drop(columns="matched_supply").reset_index())
    summary = pd.concat(rows, ignore_index=True)
    summary = summary.astype({c: int for c in ("new_conf", "new_fy", "demand", "matched",
                                                "Cumulative Available (plan)",
                                                "Surplus Resources After Matching",
                                                "Unfilled Pipeline (cumulative)")})
    return {"Availability Forecast": forecast, "Forecast 6-12m Summary": summary}
