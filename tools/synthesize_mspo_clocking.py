"""Synthetic MSPO clocking (timesheet) export for LPS-Beacon: hours clocked per person, per project, per month.

Only for the sandbox mock-up (4 Nov 2026). Every row it writes is invented. The real MSPO export has not been
received; when it arrives, its layout replaces this one (pipeline/clean.py clean_mspo_clocking reads the columns below).

    python tools/synthesize_mspo_clocking.py "<SL_X_RP file>" "<BU UR report file>" "<output folder>"

Reads
  SL_X_RP_SEA_BI_PII_Cleaned_v2.xlsx       who is planned on which project each month (SL x RP "Project" rows, MD)
  Apr_26_to_Oct_26_BU_UR_Synthetic.xlsx    each person's billable and non-billable days per month (UR report)

Writes
  MSPO_Clocking_Apr26_Oct26_Synthetic.xlsx  one row per person, project and month:
      Timesheet Month, Resource, IT Code, Project ID, Project Name, Customer, Billable (Yes / No), Hours, Man-days
      (8 hours = 1 man-day). Non-billable time (internal, presales, admin, training) is one "INTERNAL" row per person
      and month; leave is not clocked.

How it stays consistent with the other files
  A person's billable hours in a month add up to their UR report billable days x 8, so the UR report and the clocking
  agree. The days are spread over the projects the person is planned on that month in SL x RP, in proportion to the
  plan with some noise (people do not clock exactly to plan). Someone with billable days but no plan that month clocks
  to the project they were planned on nearest in time; someone never planned in SL x RP clocks to one project picked
  for them (weighted by project size, the same project every month), which shows up as unplanned work. Names and IT codes are the samples' "Generic Resource N" /
  "genericcodeN", so they join to the UR report and SL x RP as real ones would.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

SEED = 20261104
HOURS_PER_DAY = 8
MONTHS = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]


def main(sl_path: str, ur_path: str, out_dir: str) -> Path:
    rng = np.random.default_rng(SEED)
    sl = pd.read_excel(sl_path, usecols=["Demand Type", "ID", "Name", "Customer", "Resource", "IT Code",
                                         "Calendar Date", "MD"])
    sl = sl[sl["Demand Type"].eq("Project") & sl["ID"].notna() & sl["IT Code"].notna()].copy()
    sl["Month"] = pd.to_datetime(sl["Calendar Date"]).dt.strftime("%Y-%m")
    sl["MD"] = pd.to_numeric(sl["MD"], errors="coerce").fillna(0.0)
    sl = sl[sl["MD"] > 0]
    projects = sl.drop_duplicates("ID").set_index("ID")[["Name", "Customer"]]
    plan = sl.groupby(["IT Code", "Month", "ID"], as_index=False)["MD"].sum()
    plan_by = {k: g for k, g in plan.groupby(["IT Code", "Month"])}
    months_of = plan.groupby("IT Code")["Month"].apply(lambda s: sorted(set(s))).to_dict()
    size = plan.groupby("ID")["MD"].sum()
    sticky: dict[str, str] = {}   # people never planned: the one project they clock to

    # The UR report: header on the second row (subtotals on the first), like the real export.
    ur = pd.read_excel(ur_path, header=1)
    ur["Month"] = pd.to_datetime(ur["Report Month"]).dt.strftime("%Y-%m")
    ur = ur[ur["Month"].isin(MONTHS) & ur["IT Code"].notna()]
    non_billable = [c for c in ("Internal", "Presales", "Admin", "Training") if c in ur.columns]

    rows = []
    for r in ur.itertuples(index=False):
        code, month, name = str(r[ur.columns.get_loc("IT Code")]), r.Month, r[ur.columns.get_loc("Staff Name")]
        billable = float(r.Billable or 0)
        if billable > 0:
            mine = plan_by.get((code, month))
            if mine is None:          # no plan this month: the project planned nearest in time
                near = months_of.get(code)
                if near:
                    nearest = min(near, key=lambda m: abs(pd.Period(m, "M").ordinal - pd.Period(month, "M").ordinal))
                    mine = plan_by[(code, nearest)]
            if mine is None:          # never planned: one project for them, weighted by size, kept every month
                if code not in sticky:
                    sticky[code] = str(rng.choice(size.index.to_numpy(), p=(size / size.sum()).to_numpy()))
                mine = pd.DataFrame({"ID": [sticky[code]], "MD": [1.0]})
            share = mine["MD"].to_numpy() / mine["MD"].sum()
            if len(share) > 1:        # people do not clock exactly to plan
                share = rng.dirichlet(np.maximum(share * 25, 0.5))
            hours = np.round(share * billable * HOURS_PER_DAY * 2) / 2      # to the half hour
            hours[-1] = round(billable * HOURS_PER_DAY - hours[:-1].sum(), 1)  # the total matches the UR report
            for pid, h in zip(mine["ID"], hours):
                if h <= 0:
                    continue
                p = projects.loc[pid]
                rows.append({"Timesheet Month": pd.Timestamp(month + "-01"), "Resource": name, "IT Code": code,
                             "Project ID": pid, "Project Name": p["Name"], "Customer": p["Customer"],
                             "Billable": "Yes", "Hours": float(h), "Man-days": round(h / HOURS_PER_DAY, 3)})
        other = float(sum((getattr(r, c) or 0) for c in non_billable))
        if other > 0:
            rows.append({"Timesheet Month": pd.Timestamp(month + "-01"), "Resource": name, "IT Code": code,
                         "Project ID": "INTERNAL", "Project Name": "Internal, presales, admin and training",
                         "Customer": None, "Billable": "No", "Hours": other * HOURS_PER_DAY, "Man-days": other})

    out = pd.DataFrame(rows).sort_values(["Timesheet Month", "Resource", "Billable", "Project ID"],
                                         ascending=[True, True, False, True])
    target = Path(out_dir) / "MSPO_Clocking_Apr26_Oct26_Synthetic.xlsx"
    with pd.ExcelWriter(target, engine="openpyxl") as xw:
        out.to_excel(xw, sheet_name="Timesheet", index=False)
    billable = out[out["Billable"] == "Yes"]
    print(f"{target}: {len(out)} rows, {billable['IT Code'].nunique()} people, {billable['Project ID'].nunique()} "
          f"projects, billable days by month:")
    print(f"{len(sticky)} people never planned in SL x RP clock to one project each")
    print(billable.groupby(billable["Timesheet Month"].dt.strftime("%Y-%m"))["Man-days"].sum().round(1).to_string())
    return target


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
