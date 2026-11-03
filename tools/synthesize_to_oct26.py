"""Synthetic test data for LPS-Beacon: fills every month we have no real file for, up to October 2026.

Only for the sandbox. Every row it writes is invented, built from the patterns in the PII-cleaned samples.
Months after October 2026 are left to the system's forecast.

    python tools/synthesize_to_oct26.py "<Cleaned Files folder>" "<output folder>"

Reads (from the Cleaned Files folder)
  SG_Delivery_New_Hire_Leaver_2026-03-31_PII_Cleaned.xlsx   Workday new hire / leaver report (March sample)
  Apr_26_to_Aug_26_BU_UR_Sample_Cleaned.xlsx                BU UR report, Apr-Aug 2026
  ABCD_to_BP_Jul26_PII_Cleaned_v2.xlsx                      ABCD report, actuals to Jul 2026

Writes (to the output folder)
  SG_Delivery_New_Hire_Leaver_2026-MM-DD_Synthetic.xlsx      one Workday file per month, Apr-Oct 2026, laid out
                                                            like the March sample plus a synthetic Grade column
                                                            (the UR report's grade where known, else drawn from the
                                                            joiners' grade mix)
  Apr_26_to_Oct_26_BU_UR_Synthetic.xlsx                     the UR report with Sep and Oct 2026 added
  ABCD_to_BP_Oct26_Synthetic.xlsx                           the ABCD report with Aug-Oct 2026 as actuals
  SYNTHETIC_DATA_README.txt                                 what was invented and how

How the months stay consistent with each other
  Apr-Jul leavers   staff whose last month on the real UR report is that month
  May-Aug joiners   staff whose first month on the real UR report is that month
  Apr joiners       invented: 25 staff on the April UR report, picked at random and given an April hire date
  Aug-Oct leavers   invented: picked from that month's staff; they are left off the next month's UR rows
  Sep-Oct joiners   invented new staff (new Generic Resource numbers), with first-month UR prorated
Worker names and Employee IDs reuse the UR report's "Generic Resource N" / "genericcodeN" numbering, so a
leaver or joiner can be found on the UR report by name, as real names would be.
"""
from __future__ import annotations

import calendar
import datetime as dt
import random
import sys
from copy import copy
from pathlib import Path

import numpy as np
import openpyxl
import pandas as pd

SEED = 20261103
WORKDAY_SAMPLE = "SG_Delivery_New_Hire_Leaver_2026-03-31_PII_Cleaned.xlsx"
UR_SAMPLE = "Apr_26_to_Aug_26_BU_UR_Sample_Cleaned.xlsx"
ABCD_SAMPLE = "ABCD_to_BP_Jul26_PII_Cleaned_v2.xlsx"

MONTHS = [dt.date(2026, m, 1) for m in range(4, 11)]          # Apr..Oct 2026
NEW_UR_MONTHS = {dt.date(2026, 9, 1): 22, dt.date(2026, 10, 1): 22}   # standard working days (SG)
APRIL_JOINERS = 25
AUG_LEAVERS, SEP_LEAVERS, OCT_LEAVERS = 17, 15, 12
SEP_JOINERS, OCT_JOINERS = 27, 22
JOINER_GRADES = {3: 0.22, 4: 0.22, 5: 0.08, 6: 0.12, 7: 0.28, 8: 0.08}   # from the real May-Aug joiners
ABCD_ACTUAL_MONTHS = ["202608", "202609", "202610"]
ABCD_NOISE = 0.06


def month_end(d: dt.date) -> dt.date:
    return d.replace(day=calendar.monthrange(d.year, d.month)[1])


def rand_day(rng: random.Random, d: dt.date, weekday_only: bool = True) -> dt.date:
    days = [d.replace(day=i) for i in range(1, month_end(d).day + 1)]
    if weekday_only:
        days = [x for x in days if x.weekday() < 5]
    return rng.choice(days)


def number(name: str) -> int:
    return int(str(name).rsplit(" ", 1)[-1])


# ---------------------------------------------------------------- UR report
def load_ur(folder: Path) -> tuple[pd.DataFrame, list]:
    raw = pd.read_excel(folder / UR_SAMPLE, header=1)
    raw["Report Month"] = pd.to_datetime(raw["Report Month"])
    raw["_m"] = raw["Report Month"].dt.date.map(lambda d: d.replace(day=1))
    return raw, list(pd.read_excel(folder / UR_SAMPLE, header=1, nrows=0).columns)


def extend_ur(ur: pd.DataFrame, rng: random.Random, nprng: np.random.Generator):
    """Adds Sep and Oct 2026. Returns the extended report and who joined / left in each month."""
    leavers: dict[dt.date, list[dict]] = {m: [] for m in MONTHS}
    joiners: dict[dt.date, list[dict]] = {m: [] for m in MONTHS}

    first = ur.groupby("Staff Name")["_m"].min()
    last = ur.groupby("Staff Name")["_m"].max()
    grade = ur.dropna(subset=["Grade"]).groupby("Staff Name")["Grade"].last()
    real_last = max(ur["_m"])
    for name, m in last.items():
        if m < real_last:
            leavers[m].append({"name": name, "grade": grade.get(name)})
    for name, m in first.items():
        if m > min(ur["_m"]):
            joiners[m].append({"name": name, "grade": grade.get(name)})
    april = sorted(first[first == min(ur["_m"])].index, key=number)
    for name in rng.sample(april, APRIL_JOINERS):
        joiners[MONTHS[0]].append({"name": name, "grade": grade.get(name)})

    template = ur[ur["_m"] == real_last].copy()          # one row per person in Aug
    mean_ur = (ur.groupby("Staff Name")["Billable"].sum() /
               ur.groupby("Staff Name")["Standard Working days (Current month)"].sum()).clip(0, 1)
    active = list(template["Staff Name"])
    next_no = max(number(n) for n in ur["Staff Name"]) + 1
    rows = []
    plan = [(dt.date(2026, 8, 1), AUG_LEAVERS, 0, None),
            (dt.date(2026, 9, 1), SEP_LEAVERS, SEP_JOINERS, 22),
            (dt.date(2026, 10, 1), OCT_LEAVERS, OCT_JOINERS, 22)]
    by_name = template.set_index("Staff Name")
    new_people: dict[str, dict] = {}
    for month, n_leave, n_join, days in plan:
        if days is not None:                               # Sep / Oct: write UR rows
            for name in active:
                base = by_name.loc[name] if name in by_name.index else new_people[name]["row"]
                row = base.copy() if hasattr(base, "copy") else dict(base)
                row = pd.Series(row)
                row["Staff Name"] = name
                row["Report Month"] = pd.Timestamp(month.replace(day=15))
                worked = days
                if name in new_people and new_people[name]["month"] == month:
                    worked = max(1, int((month_end(month) - new_people[name]["hired"]).days * 5 / 7))
                target = mean_ur.get(name, new_people.get(name, {}).get("ur", 0.85))
                if pd.isna(target):
                    target = 0.85
                leave = float(np.clip(nprng.normal(1.0, 1.0), 0, 4))
                billable = float(np.clip(nprng.normal(target, 0.04), 0, 1)) * worked
                leave = min(leave, max(worked - billable, 0))
                billable = round(billable * 2) / 2
                row["Billable"], row["Leave"] = billable, round(leave * 2) / 2
                for col in ("Internal", "Presales", "Admin", "Training", "Missing Manday", "Billable Adj",
                            "Productive Adj"):
                    row[col] = 0
                row["Bench"] = max(round(worked - leave - billable, 1), 0)
                row["Submitted Manday"] = billable + row["Bench"] + row["Leave"]
                row["Standard Working days (Current month)"] = days
                row["Billable UR"] = billable / days
                row["Productive UR"] = 0
                row["Stretch UR"] = billable / days
                row["Non-Billable UR"] = 1 - billable / days
                row["_m"] = month
                rows.append(row)
        # who leaves this month (they are not on next month's report)
        for name in rng.sample(active, n_leave):
            active.remove(name)
            g = by_name.loc[name, "Grade"] if name in by_name.index else new_people[name]["grade"]
            leavers[month].append({"name": name, "grade": g})
        # who joins next month
        nxt = dt.date(month.year + (month.month == 12), month.month % 12 + 1, 1)
        if nxt in MONTHS:
            n_new = SEP_JOINERS if nxt.month == 9 else OCT_JOINERS
            for _ in range(n_new):
                name = f"Generic Resource {next_no}"
                g = rng.choices(list(JOINER_GRADES), weights=list(JOINER_GRADES.values()))[0]
                proto = template[template["Grade"] == g]
                proto = (proto if len(proto) else template).sample(1, random_state=next_no).iloc[0].copy()
                proto["Staff Name"], proto["IT Code"], proto["Grade"] = name, f"genericcode{next_no}", g
                hired = rand_day(rng, nxt)
                new_people[name] = {"row": proto, "grade": g, "month": nxt, "hired": hired,
                                    "ur": 0.75 if g >= 7 else 0.9}
                joiners[nxt].append({"name": name, "grade": g, "hired": hired})
                active.append(name)
                next_no += 1
    extended = pd.concat([ur, pd.DataFrame(rows)], ignore_index=True)
    return extended, joiners, leavers


def write_ur(ur: pd.DataFrame, columns: list, folder: Path, out: Path) -> Path:
    """Copies the real workbook (formats, the subtotal row) and adds the new rows under the old ones."""
    wb = openpyxl.load_workbook(folder / UR_SAMPLE)
    ws = wb["Export"]
    start = ws.max_row + 1
    style_row = list(ws.iter_rows(min_row=3, max_row=3))[0]
    new = ur[ur["Report Month"].dt.date >= dt.date(2026, 9, 1)]
    for i, (_, r) in enumerate(new.iterrows()):
        for j, col in enumerate(columns, start=1):
            if j <= 3:                       # the three XLOOKUP / CONCAT columns: keep the formula pattern
                src = style_row[j - 1].value
                value = (src.replace("3", str(start + i)) if isinstance(src, str) and j == 2 else
                         src.replace("B3", f"B{start + i}") if isinstance(src, str) and j == 1 else src)
            else:
                value = r[col]
                if isinstance(value, float) and np.isnan(value):
                    value = None
                if isinstance(value, pd.Timestamp):
                    value = value.to_pydatetime()
            cell = ws.cell(row=start + i, column=j, value=value)
            cell._style = copy(style_row[j - 1]._style)
    last = start + len(new) - 1
    ws["I1"] = f"=SUBTOTAL(9,I3:I{last})"
    ws["T1"] = f"=SUBTOTAL(9,T3:T{last})"
    path = out / "Apr_26_to_Oct_26_BU_UR_Synthetic.xlsx"
    wb.save(path)
    return path


# ---------------------------------------------------------------- Workday new hire / leaver
def write_workday(month: dt.date, leavers: list[dict], joiners: list[dict], folder: Path, out: Path,
                  rng: random.Random) -> Path:
    wb = openpyxl.load_workbook(folder / WORKDAY_SAMPLE)
    ws = wb.active
    styles = {c: copy(ws.cell(row=4, column=c)._style) for c in range(1, 5)}
    styles[5] = copy(ws.cell(row=4, column=1)._style)
    ws.delete_rows(4, ws.max_row)
    # SYNTHETIC: the real Workday report has no grade (the system looks it up by name on the UR report / staff list).
    # The masked samples are cleaned separately, so their "Generic Resource" names don't line up across files; the
    # synthetic files carry a Grade column instead, which the pipeline uses when present.
    ws.cell(row=3, column=5, value="Grade")._style = copy(ws.cell(row=3, column=4)._style)
    ws["B1"] = dt.datetime.combine(month, dt.time())
    ws["B2"] = dt.datetime.combine(month_end(month), dt.time())
    def grade_of(p: dict) -> int:
        g = p.get("grade")
        if g is not None and not (isinstance(g, float) and np.isnan(g)):
            return int(g)
        return rng.choices(list(JOINER_GRADES), weights=list(JOINER_GRADES.values()))[0]

    rows = []
    for p in sorted(leavers, key=lambda p: number(p["name"])):
        hired = dt.date(rng.randint(2018, 2025), rng.randint(1, 12), 1)
        hired = rand_day(rng, hired)
        rows.append((p["name"], hired, rand_day(rng, month, weekday_only=False), grade_of(p)))
    for p in sorted(joiners, key=lambda p: number(p["name"])):
        rows.append((p["name"], p.get("hired") or rand_day(rng, month), None, grade_of(p)))
    rows.sort(key=lambda r: (r[2] is None, r[2] or r[1]))     # leavers by date first, then joiners
    for i, (name, hired, left, grade) in enumerate(rows, start=4):
        values = [f"Generic ID {number(name)}", name, dt.datetime.combine(hired, dt.time()),
                  dt.datetime.combine(left, dt.time()) if left else None, grade]
        for c, v in enumerate(values, start=1):
            cell = ws.cell(row=i, column=c, value=v)
            cell._style = styles[c]
    path = out / f"SG_Delivery_New_Hire_Leaver_{month_end(month).isoformat()}_Synthetic.xlsx"
    wb.save(path)
    return path


# ---------------------------------------------------------------- ABCD
def write_abcd(folder: Path, out: Path, nprng: np.random.Generator) -> tuple[Path, dict]:
    """Aug-Oct 2026 become actuals: the forecast columns are renamed the way Apr-Jul are
    (Actual_Revenue-YYYYMM, Actual_Cost-YYYYMM) and their values moved by up to +/- 6 %."""
    df = pd.read_excel(folder / ABCD_SAMPLE)
    totals = {}
    for ym in ABCD_ACTUAL_MONTHS:
        rev, cost = f"Revenue-{ym}", f"Cost-{ym[:4]}-{ym[4:]}"
        noise = nprng.normal(1.0, ABCD_NOISE / 2, len(df)).clip(1 - ABCD_NOISE, 1 + ABCD_NOISE)
        df[rev] = pd.to_numeric(df[rev], errors="coerce").fillna(0) * noise
        noise = nprng.normal(1.0, ABCD_NOISE / 2, len(df)).clip(1 - ABCD_NOISE, 1 + ABCD_NOISE)
        df[cost] = pd.to_numeric(df[cost], errors="coerce").fillna(0) * noise
        df = df.rename(columns={rev: f"Actual_Revenue-{ym}", cost: f"Actual_Cost-{ym}"})
        sg = df["Delivery_Region"].eq("Singapore")
        totals[ym] = (round(df.loc[sg, f"Actual_Revenue-{ym}"].sum()), round(df.loc[sg, f"Actual_Cost-{ym}"].sum()))
    path = out / "ABCD_to_BP_Oct26_Synthetic.xlsx"
    with pd.ExcelWriter(path, engine="openpyxl") as xw:
        df.to_excel(xw, sheet_name="ABCD-USD(map act)", index=False)
    return path, totals


def main(folder: str, out_dir: str) -> None:
    folder, out = Path(folder), Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    rng, nprng = random.Random(SEED), np.random.default_rng(SEED)

    ur, columns = load_ur(folder)
    extended, joiners, leavers = extend_ur(ur, rng, nprng)
    written = [write_ur(extended, columns, folder, out)]
    for m in MONTHS:
        written.append(write_workday(m, leavers[m], joiners[m], folder, out, rng))
    abcd_path, abcd_totals = write_abcd(folder, out, nprng)
    written.append(abcd_path)

    heads = extended.groupby(extended["Report Month"].dt.strftime("%Y-%m"))["IT Code"].nunique()
    ur_pct = extended.groupby(extended["Report Month"].dt.strftime("%Y-%m")).apply(
        lambda d: d["Billable"].sum() / d["Standard Working days (Current month)"].sum())
    lines = ["SYNTHETIC SANDBOX DATA - NOT REAL. Generated by tools/synthesize_to_oct26.py "
             f"(seed {SEED}) on {dt.date.today().isoformat()}.", "",
             "Workday new hire / leaver files (one per month, the March 2026 sample layout plus a SYNTHETIC Grade column):"]
    for m in MONTHS:
        lines.append(f"  {m:%b %Y}: {len(joiners[m])} joiners, {len(leavers[m])} leavers")
    lines += ["", "UR report: real Apr-Aug 2026 rows kept; Sep and Oct 2026 invented (22 working days each).",
              "  staff on the report and Billable UR per month:"]
    for m in heads.index:
        lines.append(f"  {m}: {heads[m]} staff, Billable UR {ur_pct[m]:.1%}" +
                     ("  (synthetic)" if m >= "2026-09" else ""))
    lines += ["", "ABCD: Aug-Oct 2026 forecast columns turned into actuals (Actual_Revenue-YYYYMM / "
              "Actual_Cost-YYYYMM), each project's value moved by up to +/-6%.", "  Singapore totals (USD):"]
    for ym, (r, c) in abcd_totals.items():
        lines.append(f"  {ym}: revenue {r:,.0f}, cost {c:,.0f}")
    lines += ["", "Not synthesized: the staff list (22 Sep snapshot), SL x RP, quote line and resource plan "
              "already cover Oct 2026 and later; HC by HR (Aug only) is not read by the system."]
    (out / "SYNTHETIC_DATA_README.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    for p in written:
        print("wrote", p.name)


if __name__ == "__main__":
    main(*sys.argv[1:3])
