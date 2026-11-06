"""Demo data for LPS-Beacon (6 Nov 2026): a small ATFM solutioning company, every name and number invented.

    python tools/make_demo_data.py "<output folder>"

10 agencies with 1 to 3 projects each (18 projects), 122 people on projects (13 of them on more than one project)
plus 5 on the bench (127 staff). Fiscal year FY26 (Apr 2026 - Mar 2027); April to October 2026 are actual months.
Designed flags (fiscal year to date): every rule shows at least once. Red: average billable MD below 15.3 or above 18
a month, or revenue per FTE more than 20% below the company average; amber (Watch): revenue per FTE 5-20% below; an
agency is red when any of its projects is red.
    red    Urban Mobility Board         over-utilised (people clock about 20 billable MD a month)
    red    National Skills Council      under-utilised (about 13)
    red    Coastal Defence Agency       one over-utilised project (the agency's own average is in range)
    red    Heritage & Culture Board     revenue per FTE about 35% below the average (ADR about $380 a day)
    amber  Civic Records Agency         revenue per FTE about 10% below (ADR about $530)
    amber  Community Services Council   revenue per FTE about 11% below (ADR about $520)
    green  the other four
Joiners and leavers (Workday, one file a month, Apr-Oct 2026): six leavers, one a month from April to September, each
replaced on the same project and position from the next month; two new hires join the bench in September and October.
Headcount: 125 in April (UR report) + 8 joiners - 6 leavers = 127 at the end of October (staff list).

Plus two won quotes not started yet (from January 2027, no project yet) that the matching review redeploys
people onto; the two projects ending December 2026 roll off in time for them.

Writes the files the pipeline reads, each in the layout of the real export it stands in for:
    Demo_SL_X_RP.xlsx                     SL x RP (PM's plan, As planned)       sheet "Export"
    Demo_Project_Resource_Plan.xlsx       project resource plan (matching)      has "Project Owner"
    Demo_Quote_Line.xlsx                  quote line export (As sold)           has "Name", Project ID, ORD numbers
    Demo_Position_Name_Mapping.xlsx       position name -> standard role
    Demo_ABCD_to_BP_Oct26.xlsx            ABCD revenue and cost by month        sheet "ABCD-USD(map act)"
    Demo_BU_UR_Apr26_Oct26.xlsx           BU UR report                          sheet "Export", header on row 2
    Demo_MSPO_SG_Staff_List.xlsx          staff list                            header on row 2
    Demo_MSPO_Clocking_Apr26_Oct26.xlsx   clocking by person, project, month    sheet "Timesheet"
    management_target_FY26.json           management target cells for plan/management_target.json (S3)
    DEMO_DATA_README.txt
"""
from __future__ import annotations

import datetime as dt
import json
import random
import sys
from pathlib import Path

import numpy as np
import pandas as pd

SEED = 20261106
ACTUAL = [f"2026-{m:02d}" for m in range(4, 11)]                          # Apr..Oct 2026
PLAN = [f"{y}-{m:02d}" for y, ms in ((2026, range(4, 13)), (2027, range(1, 13)), (2028, range(1, 4))) for m in ms]
FY_MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"]
HOLIDAYS = ["2026-04-03", "2026-05-01", "2026-05-27", "2026-06-01", "2026-08-10", "2026-11-09", "2026-12-25"]
FULL = 18.0

# agency, short, projects: (project id, name, people, profile, ADR USD/day, end month)
#   profile: green 15.8-17.6 days a head a month, over ~20, under ~13
AGENCIES = [
    ("Harbourfront Port Authority", "HPA", [
        ("PROJ-00020101", "[ATFM] HPA Infrastructure Operations FY26", 14, "green", 610, "2028-03"),
        ("PROJ-00020102", "[ATFM] HPA Cloud Landing Zone Support", 6, "green", 640, "2028-03")]),
    ("Civic Records Agency", "CRA", [
        ("PROJ-00020201", "[ATFM] CRA Records Platform Support", 10, "green", 530, "2028-03")]),
    ("Urban Mobility Board", "UMB", [
        ("PROJ-00020301", "[ATFM] UMB Traffic Systems Operations", 12, "over", 600, "2028-03"),
        ("PROJ-00020302", "[ATFM] UMB Network Refresh", 5, "over", 620, "2026-12")]),
    ("National Skills Council", "NSC", [
        ("PROJ-00020401", "[ATFM] NSC Learning Portal Support", 7, "under", 600, "2028-03"),
        ("PROJ-00020402", "[ATFM] NSC Service Desk", 4, "under", 560, "2026-12")]),
    ("Public Health Data Office", "PHDO", [
        ("PROJ-00020501", "[ATFM] PHDO Data Centre Operations", 10, "green", 605, "2028-03"),
        ("PROJ-00020502", "[ATFM] PHDO Backup and DR", 4, "green", 615, "2028-03"),
        ("PROJ-00020503", "[ATFM] PHDO SOC Monitoring", 3, "green", 650, "2028-03")]),
    ("Coastal Defence Agency", "CDA", [
        ("PROJ-00020601", "[ATFM] CDA Infrastructure Operations FY26", 14, "green", 600, "2028-03"),
        ("PROJ-00020602", "[ATFM] CDA Security Uplift", 6, "over", 630, "2027-06")]),
    ("Heritage & Culture Board", "HCB", [
        ("PROJ-00020701", "[ATFM] HCB Museum Systems Support", 8, "green", 380, "2028-03")]),
    ("Water Resources Authority", "WRA", [
        ("PROJ-00020801", "[ATFM] WRA SCADA Infrastructure Support", 9, "green", 620, "2028-03"),
        ("PROJ-00020802", "[ATFM] WRA M365 Migration", 4, "green", 600, "2027-06")]),
    ("Digital Identity Office", "DIO", [
        ("PROJ-00020901", "[ATFM] DIO Identity Platform Operations", 9, "green", 640, "2028-03")]),
    ("Community Services Council", "CSC", [
        ("PROJ-00021001", "[ATFM] CSC Case Management Application Support", 6, "green", 525, "2028-03"),
        ("PROJ-00021002", "[ATFM] CSC End-User Computing Helpdesk", 5, "green", 515, "2028-03")]),
]
# People on more than one project (same profile on each): project ids and their shares of the person's time.
SHARED = (
    [(("PROJ-00020101", "PROJ-00020102"), (0.6, 0.4))] * 3
    + [(("PROJ-00020501", "PROJ-00020502"), (0.5, 0.5))] * 3
    + [(("PROJ-00020501", "PROJ-00020503"), (0.6, 0.4))] * 2
    + [(("PROJ-00020501", "PROJ-00020502", "PROJ-00020503"), (0.4, 0.3, 0.3))]
    + [(("PROJ-00020801", "PROJ-00020802"), (0.5, 0.5))] * 2
    + [(("PROJ-00021001", "PROJ-00021002"), (0.5, 0.5))]
    + [(("PROJ-00020301", "PROJ-00020302"), (0.5, 0.5))]
)
BENCH = 5
# New work won but not started (quote lines with no project yet), from January 2027: what the matching review redeploys
# people onto. The people of the two projects ending December 2026 roll off just in time.
NEW_DEMAND = [
    ("Digital Identity Office", "DIO", "[ATFM] DIO Identity Platform Phase 2", "20260915-SF8121",
     [("Project Manager", 7), ("Cloud Engineer L2", 5), ("Cloud Engineer L2", 6), ("Site Reliability Engineer", 6)]),
    ("Community Services Council", "CSC", "[ATFM] CSC Service Desk Expansion", "20260928-SF8174",
     [("Service Desk Lead", 5), ("Service Desk Agent", 3), ("Service Desk Agent", 3), ("Mobile/Desktop Engineer", 4)]),
]
NEW_START = ["2027-01", "2027-02", "2027-03"]
# Leavers: (project, month they leave); each is replaced on the same project and position from the next month.
LEAVERS = [("PROJ-00020101", "2026-04"), ("PROJ-00020501", "2026-05"), ("PROJ-00020801", "2026-06"),
           ("PROJ-00020901", "2026-07"), ("PROJ-00020601", "2026-08"), ("PROJ-00020301", "2026-09")]
BENCH_JOINERS = ["2026-09", "2026-10"]          # new hires not on a project yet
# Roles by kind of project; the first is the lead. (role, band range)
ROLES = {
    "infra": [("Service Delivery Manager", (7, 8)), ("Server Engineer L2", (5, 6)), ("Server Engineer L1", (3, 4)),
              ("Network Engineer L2", (5, 6)), ("Network Engineer L1", (3, 4)), ("DCOps", (3, 4)),
              ("Backup/Storage Engineer L2", (5, 6)), ("Server Engineer L3", (7, 7)), ("Service Desk Agent", (3, 3))],
    "cloud": [("Cloud Architect", (8, 8)), ("Cloud Engineer L2", (5, 6)), ("Cloud Engineer L1", (4, 4)),
              ("Site Reliability Engineer", (6, 7)), ("Cloud DBA L2", (6, 6))],
    "app": [("Application PM", (7, 8)), ("Application Support Engineer L2", (5, 6)),
            ("Application Support Engineer L1", (3, 4)), ("Business Analyst", (6, 6)), ("Tester/QA", (4, 5)),
            ("DBA L2", (6, 6))],
    "desk": [("Service Desk Lead", (5, 6)), ("Service Desk Agent", (3, 3)), ("Mobile/Desktop Engineer", (3, 4)),
             ("M365 Engineer", (5, 6))],
    "security": [("IT Security Mgr", (8, 8)), ("Security Engineer", (6, 7)), ("Tools Engineer L2 (Observability)", (5, 6)),
                 ("IT Security Officer", (5, 6))],
    "network": [("Project Manager", (7, 7)), ("Network Engineer L3", (7, 7)), ("Network Engineer L2", (5, 6)),
                ("Network Engineer L1", (3, 4))],
}
KIND = {"PROJ-00020102": "cloud", "PROJ-00020201": "app", "PROJ-00020302": "network", "PROJ-00020401": "app",
        "PROJ-00020402": "desk", "PROJ-00020502": "infra", "PROJ-00020503": "security", "PROJ-00020602": "security",
        "PROJ-00020701": "app", "PROJ-00020802": "desk", "PROJ-00020901": "cloud", "PROJ-00021001": "app",
        "PROJ-00021002": "desk"}
FIRST = ["Wei Ling", "Ahmad", "Priya", "Jun Hao", "Siti", "Marcus", "Hui Min", "Ravi", "Nur Aisyah", "Daniel", "Mei Xin",
         "Kumar", "Farah", "Kelvin", "Shu Fen", "Arjun", "Hafiz", "Grace", "Zhi Wei", "Deepa", "Irfan", "Jasmine",
         "Bryan", "Li Ting", "Vikram", "Nadia", "Ethan", "Yi Xuan", "Suresh", "Amira"]
LAST = ["Tan", "Lim", "Ng", "Wong", "Goh", "Chua", "Lee", "Teo", "Ong", "Koh", "Rahman", "Kumar", "Nair", "Ismail",
        "Pillai", "Low", "Chan", "Yeo", "Sim", "Hassan", "Raj", "Ho", "Toh", "Ang", "Seah"]


def working_days(month: str) -> int:
    y, m = map(int, month.split("-"))
    end = dt.date(y + (m == 12), m % 12 + 1, 1)
    return int(np.busday_count(dt.date(y, m, 1), end, holidays=HOLIDAYS))


def build(rng: random.Random):
    projects = {}
    for agency, short, plist in AGENCIES:
        for pid, name, size, profile, adr, end in plist:
            projects[pid] = dict(id=pid, name=name, agency=agency, short=short, size=size, profile=profile, adr=adr,
                                 end=end, kind=KIND.get(pid, "infra"), slots=[])
    names_used, people = set(), []

    def new_person(profile: str, kind: str, lead: bool = False) -> dict:
        while True:
            name = f"{rng.choice(FIRST)} {rng.choice(LAST)}"
            if name not in names_used:
                names_used.add(name)
                break
        role, bands = ROLES[kind][0] if lead else rng.choice(ROLES[kind][1:])
        n = len(people) + 1
        r = rng.random()
        person = dict(name=name, code=f"demo{n:03d}", role=role, band=rng.randint(*bands), profile=profile,
                      employment="Secondment" if r < 0.19 else "Supplemental-Other" if r < 0.22 else "Regular Employee",
                      joined=dt.date(rng.randint(2016, 2025), rng.randint(1, 12), rng.randint(1, 28)), alloc={},
                      first=None, last=None)          # first / last active month (None: before / after the data)
        people.append(person)
        return person

    for pids, shares in SHARED:
        first = projects[pids[0]]
        p = new_person(first["profile"], first["kind"])
        for pid, share in zip(pids, shares):
            p["alloc"][pid] = share
            projects[pid]["slots"].append(p)
    for pr in projects.values():
        while len(pr["slots"]) < pr["size"]:
            p = new_person(pr["profile"], pr["kind"], lead=not any(x["alloc"].get(pr["id"]) == 1.0 for x in pr["slots"]))
            p["alloc"][pr["id"]] = 1.0
            pr["slots"].append(p)
    # Leavers and their replacements: a dedicated person leaves at the end of the month; a new hire takes the same
    # position and share from the next month.
    taken = set()
    for pid, month in LEAVERS:
        pr = projects[pid]
        leaver = next(x for x in pr["slots"] if x["alloc"] == {pid: 1.0} and x["code"] not in taken and x["first"] is None
                      and x["role"] != ROLES[pr["kind"]][0][0])
        taken.add(leaver["code"])
        leaver["last"] = month
        nxt = (pd.Period(month) + 1).strftime("%Y-%m")
        joiner = new_person(pr["profile"], pr["kind"])
        joiner.update(role=leaver["role"], band=leaver["band"], alloc={pid: 1.0}, first=nxt,
                      joined=first_workday(nxt))
        pr["slots"].append(joiner)
    bench = [new_person("bench", rng.choice(["infra", "cloud", "app"])) for _ in range(BENCH)]
    for p, month in zip(bench[-len(BENCH_JOINERS):], BENCH_JOINERS):
        p.update(first=month, joined=first_workday(month))
    return projects, [p for p in people if p["profile"] != "bench"], bench


def first_workday(month: str) -> dt.date:
    d = dt.date.fromisoformat(month + "-01")
    while d.weekday() >= 5 or d.isoformat() in HOLIDAYS:
        d += dt.timedelta(days=1)
    return d


def last_workday(month: str) -> dt.date:
    d = pd.Period(month).end_time.date()
    while d.weekday() >= 5 or d.isoformat() in HOLIDAYS:
        d -= dt.timedelta(days=1)
    return d


def active(p: dict, month: str) -> bool:
    return (p["first"] is None or month >= p["first"]) and (p["last"] is None or month <= p["last"])


def days_a_month(profile: str, month: str, rng: random.Random) -> float:
    wd = working_days(month)
    if profile == "over":
        d = rng.gauss(20.6, 0.5)
    elif profile == "under":
        d = rng.gauss(13.0, 0.7)
    else:
        d = min(max(rng.gauss(16.9, 0.45), 15.9), 17.7)
    return round(min(d, wd - 0.5) * 2) / 2


def main(out_dir: str) -> None:
    rng = random.Random(SEED)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    projects, everyone, bench = build(rng)
    leavers = [p for p in everyone if p["last"] is not None]
    people = [p for p in everyone if p["last"] is None]      # on projects at the end of October
    staff = people + bench

    # Clocked billable days per person, project and month (actual months), and the plan (all months).
    clock, plan_rows = [], []
    for p in people + leavers:
        for m in ACTUAL:
            if not active(p, m):
                continue
            total = days_a_month(p["profile"], m, rng)
            live = {pid: s for pid, s in p["alloc"].items() if m <= projects[pid]["end"]}
            for pid, share in live.items():
                clock.append(dict(month=m, code=p["code"], name=p["name"], pid=pid, days=round(total * share * 2) / 2))
        for pid, share in p["alloc"].items():
            for m in PLAN:
                if m <= projects[pid]["end"] and active(p, m):
                    plan_rows.append(dict(month=m, code=p["code"], pid=pid, md=round(FULL * share * 2) / 2))
    clock = pd.DataFrame(clock)
    plan = pd.DataFrame(plan_rows)
    by_person = {p["code"]: p for p in staff + leavers}

    # ---- SL x RP: the PM's plan, one row per person, project and month (Demand Type "Project")
    sl = []
    for r in plan.itertuples(index=False):
        p, pr = by_person[r.code], projects[r.pid]
        sl.append({"Demand Type": "Project", "ID": r.pid, "Work Order": None, "Name": pr["name"], "Customer": pr["agency"],
                   "Project Type": "Time Based", "Service Line": "ATFM", "Solution Offering": "ATFM",
                   "Delivery Region": "Singapore", "Owner": next(x["name"] for x in pr["slots"] if x["alloc"].get(pr["id"]) == 1.0 and x["role"] == ROLES[pr["kind"]][0][0]) if any(x["role"] == ROLES[pr["kind"]][0][0] for x in pr["slots"]) else pr["slots"][0]["name"],
                   "Planned Start Date": dt.date(2025, 4, 1), "Planned End Date": pd.Period(pr["end"]).end_time.date(),
                   "Resource": p["name"], "IT Code": p["code"], "Active Billable": "Yes", "Billable Status": "Billable",
                   "Staff Status": "Active", "Grade": p["band"], "Skill": None, "Position Name": p["role"],
                   "Working City": "SG - Singapore", "Calendar Date": dt.date.fromisoformat(r.month + "-01"),
                   "MD": r.md, "Project Demand FTE": round(r.md / FULL, 3), "CRM ID": None})
    pd.DataFrame(sl).to_excel(out / "Demo_SL_X_RP.xlsx", sheet_name="Export", index=False)

    # ---- quote lines (As sold): one line per project and role, sold man-days per month, per fiscal year
    def fy_of(month: str) -> str:
        y, m = map(int, month.split("-"))
        return f"FY{(y if m >= 4 else y - 1) % 100:02d}"

    plan["fy"] = plan["month"].map(fy_of)
    plan["fm"] = plan["month"].map(lambda m: FY_MONTHS[(int(m[5:]) - 4) % 12])
    plan["role"] = plan["code"].map(lambda c: by_person[c]["role"])
    plan["band"] = plan["code"].map(lambda c: by_person[c]["band"])
    ql_rows, ql_no, orders = [], 3800, {}
    for pid, pr in projects.items():
        orders[pid] = f"ORD-{3000 + len(orders):05d}-{rng.choice('ABCDEFGHJK')}{rng.randint(1, 9)}{rng.choice('MNPQRSTV')}{rng.randint(1, 9)}"
        sold_factor = rng.choice([1.0, 1.0, 1.0, 1.05, 1.1, 0.95])
        part = plan[plan["pid"] == pid]
        # This year's sold lines only: next year's lines would look like new work to the matching review.
        for (role, fy), g in part[part["fy"] == "FY26"].groupby(["role", "fy"]):
            ql_no += 1
            row = {"Project ID": pid, "Quote Line Number": f"QL-{ql_no:010d}", "Resource": "TBA",
                   "Grade": int(g["band"].median()), "Skill": None, "Position Name": role,
                   "Working City": "SG - Singapore", "Fiscal Year": fy}
            md = g.groupby("fm")["md"].sum()
            for fm in FY_MONTHS:
                row[fm] = round(float(md.get(fm, 0.0)) * sold_factor, 1) or None
            row.update({"Status": "Active", "Created On": dt.date(2025, 3, 15), "Name": pr["name"],
                        "Customer": pr["agency"], "End Customer": pr["agency"], "Project Type": "Time Based",
                        "Quote ID": f"QUO-{ql_no:05d}-{pr['short']}", "Contract Number": orders[pid]})
            ql_rows.append(row)
    new_lines = []
    for agency, short, name, crm, roles in NEW_DEMAND:
        for role, band in roles:
            ql_no += 1
            row = {"Project ID": None, "Quote Line Number": f"QL-{ql_no:010d}", "Resource": "TBA", "Grade": band,
                   "Skill": None, "Position Name": role, "Working City": "SG - Singapore", "Fiscal Year": "FY26"}
            for fm in FY_MONTHS:
                row[fm] = FULL if fm in ("Jan", "Feb", "Mar") else None
            row.update({"Status": "Active", "Created On": dt.date(2026, 10, 20), "Name": name, "Customer": agency,
                        "End Customer": agency, "Project Type": "Time Based", "Quote ID": f"QUO-{ql_no:05d}-{short}",
                        "Contract Number": None})
            ql_rows.append(row)
            new_lines.append((row, crm))
    pd.DataFrame(ql_rows).to_excel(out / "Demo_Quote_Line.xlsx", sheet_name="Quote Line", index=False)
    # The won quotes are demand in SL x RP too (Demand Type "Quote Won", ID = the quote line number).
    for row, crm in new_lines:
        for m in NEW_START:
            sl.append({"Demand Type": "Quote Won", "ID": row["Quote Line Number"], "Work Order": None, "Name": row["Name"],
                       "Customer": row["Customer"], "Project Type": "Time Based", "Service Line": "ATFM",
                       "Solution Offering": "ATFM", "Delivery Region": "Singapore", "Owner": None,
                       "Planned Start Date": dt.date(2027, 1, 1), "Planned End Date": dt.date(2028, 12, 31),
                       "Resource": None, "IT Code": None, "Active Billable": None, "Billable Status": None,
                       "Staff Status": None, "Grade": row["Grade"], "Skill": None, "Position Name": row["Position Name"],
                       "Working City": "SG - Singapore", "Calendar Date": dt.date.fromisoformat(m + "-01"), "MD": FULL,
                       "Project Demand FTE": 0, "CRM ID": crm})
    pd.DataFrame(sl).to_excel(out / "Demo_SL_X_RP.xlsx", sheet_name="Export", index=False)

    # ---- project resource plan (matching): one row per person, project and fiscal year
    rp_rows = []
    for (code, pid, fy), g in plan.groupby(["code", "pid", "fy"]):
        p, pr = by_person[code], projects[pid]
        line = next(r for r in ql_rows if r["Project ID"] == pid and r["Position Name"] == p["role"])
        row = {"Project ID": pid, "Work Order": None, "Resource": p["name"], "Grade": p["band"], "Skill": None,
               "Position Name": p["role"], "Working City": "SG - Singapore", "Fiscal Year": fy}
        md = g.set_index("fm")["md"]
        for fm in FY_MONTHS:
            row[fm] = float(md[fm]) if fm in md.index else None
        row.update({"Status": "Active", "Created On": dt.date(2025, 3, 20), "Quote Line Number": line["Quote Line Number"],
                    "Project Status": "Active", "Customer": pr["agency"], "Project Type": "Time Based",
                    "End Customer": pr["agency"], "Quote ID": line["Quote ID"], "Project Name": pr["name"],
                    "Project Owner": pr["slots"][0]["name"], "Modified Date": dt.datetime(2026, 10, 30, 9, 0),
                    "SFDC numbers": None, "Contract Number": orders[pid]})
        rp_rows.append(row)
    pd.DataFrame(rp_rows).to_excel(out / "Demo_Project_Resource_Plan.xlsx", sheet_name="Resource Plan", index=False)

    # ---- position mapping: the demo uses standard role names as position names
    roles = sorted({r for kind in ROLES.values() for r, _ in kind})
    with pd.ExcelWriter(out / "Demo_Position_Name_Mapping.xlsx") as xw:
        pd.DataFrame({"Position Name": roles, "Standard Role": roles}).to_excel(xw, sheet_name="Position Name Mapping", index=False)
        pd.DataFrame({"Standard Role": roles}).to_excel(xw, sheet_name="Standard Role", index=False)

    # ---- MSPO clocking (by person, project and month)
    ck = clock.copy()
    ck["Timesheet Month"] = pd.to_datetime(ck["month"] + "-01")
    ck = ck.assign(Resource=ck["name"], **{"IT Code": ck["code"], "Project ID": ck["pid"],
                   "Project Name": ck["pid"].map(lambda x: projects[x]["name"]),
                   "Customer": ck["pid"].map(lambda x: projects[x]["agency"]), "Billable": "Yes",
                   "Hours": ck["days"] * 8, "Man-days": ck["days"]})
    ck[["Timesheet Month", "Resource", "IT Code", "Project ID", "Project Name", "Customer", "Billable", "Hours",
        "Man-days"]].to_excel(out / "Demo_MSPO_Clocking_Apr26_Oct26.xlsx", sheet_name="Timesheet", index=False)

    # ---- ABCD: revenue = ADR x clocked days (actual months), ADR x planned days (forecast); cost at 74-78 %
    cols_rev, cols_cost = [], []
    for m in PLAN:
        tag = m.replace("-", "")
        cols_rev.append(("Actual_Revenue-" if m in ACTUAL else "Revenue-") + tag)
        cols_cost.append(("Actual_Cost-" if m in ACTUAL else "Cost-") + (tag if m in ACTUAL else m))
    abcd = []
    cday = clock.groupby(["pid", "month"])["days"].sum()
    pday = plan.groupby(["pid", "month"])["md"].sum()
    for pid, pr in projects.items():
        row = {"LPS_GTM_Unit": "Public Sector", "Project_ID": pid, "Work_Order": orders[pid], "Project_Type": "Time Based",
               "SFDC_ID": f"2025{rng.randint(1, 12):02d}{rng.randint(1, 28):02d}-SF{rng.randint(1000, 9999)}",
               "Service_Line": "ATFM", "Solution_Offering": "ATFM", "Delivery_Region": "Singapore",
               "End_Customer": pr["agency"], "Customer": pr["agency"], "Project_Name": pr["name"],
               "Contract_Number": orders[pid], "Planned_Start": dt.date(2025, 4, 1),
               "Planned_End_Date": pd.Period(pr["end"]).end_time.date()}
        cost_share = rng.uniform(0.74, 0.78)
        total = 0.0
        for m, rc, cc in zip(PLAN, cols_rev, cols_cost):
            if m > pr["end"]:
                rev = 0.0
            elif m in ACTUAL:
                rev = pr["adr"] * float(cday.get((pid, m), 0.0)) * rng.uniform(0.97, 1.03)
            else:
                rev = pr["adr"] * float(pday.get((pid, m), 0.0)) * 0.94       # forecast at the usual UR
            row[rc], row[cc] = round(rev, 2), round(rev * cost_share, 2)
            total += rev
        row["TCVBefore_Tax_USD_Currency_Contract"] = round(total, 2)
        row["Project_Duration_Months"] = len([m for m in PLAN if m <= pr["end"]]) + 12
        abcd.append(row)
    pd.DataFrame(abcd).to_excel(out / "Demo_ABCD_to_BP_Oct26.xlsx", sheet_name="ABCD-USD(map act)", index=False)

    # ---- BU UR report: one row per person and actual month; header on row 2 (row 1 holds subtotals)
    billable = clock.groupby(["code", "month"])["days"].sum()
    ur = []
    for p in staff + leavers:
        for m in ACTUAL:
            if not active(p, m):
                continue
            wd = working_days(m)
            b = float(billable.get((p["code"], m), 0.0))
            leave = min(round(rng.choice([0, 0, 0.5, 1, 1, 1.5, 2, 3]), 1), max(wd - b, 0))
            admin = max(round(wd - b - leave, 1), 0) if p["profile"] != "bench" else 0.0
            bench_days = max(wd - leave, 0) if p["profile"] == "bench" else 0.0
            tier = "Tier S_B" if p["employment"] == "Secondment" else "Tier B"
            ur.append({"BU UR Tgt": 0.85, "Tier & Grade": f"{tier} - {p['band']}", "Grade Group": f"Band {p['band']}",
                       "Grade": p["band"], "Report Month": dt.datetime.fromisoformat(m + "-15"), "Staff Name": p["name"],
                       "IT Code": p["code"], "Tier": tier, "Billable": b, "Internal": 0, "Presales": 0,
                       "Admin": admin, "Bench": bench_days, "Training": 0, "Missing Manday": 0, "Leave": leave,
                       "Billable Adj": 0, "Productive Adj": 0, "Submitted Manday": wd,
                       "Standard Working days (Current month)": wd, "Billable UR": round(b / wd, 4),
                       "Productive UR": round(b / wd, 4), "Stretch UR": round(b / wd, 4),
                       "Non-Billable UR": round(1 - b / wd, 4), "Staff Region": "Singapore", "Working City": "Singapore",
                       "Cost Center": "SG14000012", "TSG + ODC": "SEA Delivery", "Team (Finance View)": "ATFM",
                       "Team": "ATFM Delivery"})
    ur = pd.DataFrame(ur)
    with pd.ExcelWriter(out / "Demo_BU_UR_Apr26_Oct26.xlsx") as xw:
        top = pd.DataFrame([[None] * len(ur.columns)], columns=ur.columns)
        top.iloc[0, list(ur.columns).index("Billable")] = ur["Billable"].sum()
        top.iloc[0, list(ur.columns).index("Standard Working days (Current month)")] = ur["Standard Working days (Current month)"].sum()
        top.to_excel(xw, sheet_name="Export", index=False, header=False, startrow=0)
        ur.to_excel(xw, sheet_name="Export", index=False, startrow=1)

    # ---- staff list (header on row 2)
    st = pd.DataFrame([{"Name": p["name"], "IT Code": p["code"], "Grade": str(p["band"]), "Join Date": p["joined"],
                        "Last Employment Date": None, "Cost Center Code": "SG14000012", "Working City": "SG - Singapore",
                        "Employee Type": p["employment"], "Target Working Hours Per Week": 40,
                        "Job Title (User) (User)": p["role"], "Title (User) (User)": p["role"],
                        "Billable Status": "Tier S_B" if p["employment"] == "Secondment" else "Tier B",
                        "CCC Billable Status​": "Billable", "Created On": dt.datetime(2025, 1, 6, 9, 0)}
                       for p in staff])
    with pd.ExcelWriter(out / "Demo_MSPO_SG_Staff_List.xlsx") as xw:
        st.to_excel(xw, sheet_name="MSPO SG Staff List", index=False, startrow=1)

    # ---- management target FY26 (USD; costs negative), typed in as the MT column; per period like Finance's sheet
    q = {"Q1": dict(revenue=3.60, cos=-2.70, perm=-1.96, sec=-0.40, transfer=2.12, third=-0.30, opex=-0.15),
         "Q2": dict(revenue=3.75, cos=-2.81, perm=-1.98, sec=-0.40, transfer=2.14, third=-0.31, opex=-0.15),
         "Q3": dict(revenue=3.85, cos=-2.89, perm=-2.00, sec=-0.41, transfer=2.17, third=-0.31, opex=-0.16),
         "Q4": dict(revenue=3.80, cos=-2.85, perm=-2.01, sec=-0.41, transfer=2.18, third=-0.30, opex=-0.16)}
    q["FY"] = {k: round(sum(v[k] for v in q.values()), 2) for k in q["Q1"]}
    hc_sec, hc_perm = 24, 103
    cells, at = {}, dt.datetime(2026, 11, 6, 8, 0, tzinfo=dt.timezone.utc).isoformat()

    def put(period, row, value):
        cells[f"FY26|{period}|mt|{row}"] = {"value": round(value, 6), "by": "demo-seed", "byName": None, "at": at}

    for period, v in q.items():
        M = 1e6
        gross = (v["perm"] + v["sec"]) * M
        gp = (v["revenue"] + v["cos"]) * M
        pcon = gp + v["opex"] * M
        hc = hc_sec + hc_perm
        for row, val in (("revenue", v["revenue"] * M), ("cos", v["cos"] * M), ("perm-staff-cost", v["perm"] * M),
                         ("secondment-staff-cost", v["sec"] * M), ("gross-staff-cost", gross),
                         ("staff-cost-transfer", v["transfer"] * M), ("net-staff-cost", gross + v["transfer"] * M),
                         ("third-party-cost", v["third"] * M), ("gp", gp), ("gp-pct", gp / (v["revenue"] * M)),
                         ("hc-secondment", hc_sec), ("hc-permanent", hc_perm), ("hc-total", hc),
                         ("avg-staff-cost", gross / hc), ("avg-perm-cost", v["perm"] * M / hc_perm),
                         ("avg-sec-cost", v["sec"] * M / hc_sec), ("revenue-per-hc", v["revenue"] * M / hc),
                         ("gp-per-hc", gp / hc), ("revenue-per-staff-cost", v["revenue"] * M / abs(gross)),
                         ("adr", 600.0), ("opex", v["opex"] * M), ("pcon", pcon), ("pcon-pct", pcon / (v["revenue"] * M))):
            put(period, row, val)
    (out / "management_target_FY26.json").write_text(json.dumps({"cells": cells}, indent=1))

    # ---- Workday new hire / leaver reports, one a month (no Grade column, like the real report: the system finds the
    # band by name on the UR report or staff list)
    for m in ACTUAL:
        rows = [{"Employee ID": f"E{1000 + int(p['code'][4:])}", "Worker": p["name"], "Original Hire Date": p["joined"],
                 "Termination Date": last_workday(m)} for p in leavers if p["last"] == m]
        rows += [{"Employee ID": f"E{1000 + int(p['code'][4:])}", "Worker": p["name"], "Original Hire Date": p["joined"],
                  "Termination Date": None} for p in people + bench if p["first"] == m]
        end = pd.Period(m).end_time.date()
        top = pd.DataFrame([["Termination Date is greater than or equal to", dt.date.fromisoformat(m + "-01"), None, None],
                            ["Effective as of Date", end, None, None],
                            ["Employee ID", "Worker", "Original Hire Date", "Termination Date"]])
        body = pd.DataFrame(rows, columns=["Employee ID", "Worker", "Original Hire Date", "Termination Date"])
        with pd.ExcelWriter(out / f"Demo_SG_Delivery_New_Hire_Leaver_{end.isoformat()}.xlsx") as xw:
            top.to_excel(xw, sheet_name="Sheet1", index=False, header=False)
            body.to_excel(xw, sheet_name="Sheet1", index=False, header=False, startrow=3)

    # ---- summary
    shared = [p for p in people if len(p["alloc"]) > 1]
    lines = [f"Demo data (seed {SEED}), written {dt.date.today()}. Every name and number is invented.",
             f"Staff at the end of October: {len(staff)} ({len(people)} on projects, {len(shared)} of them on more than one "
             f"project; {len(bench)} on the bench); {len(leavers)} leavers and "
             f"{sum(1 for p in staff if p['first'])} joiners during Apr-Oct 2026",
             f"Agencies: {len(AGENCIES)}; projects: {len(projects)}", ""]
    for agency, short, plist in AGENCIES:
        lines.append(f"{agency} ({short})")
        for pid, name, size, profile, adr, end in plist:
            lines.append(f"    {pid}  {name}  people {size}  profile {profile}  ADR ${adr}  ends {end}")
    (out / "DEMO_DATA_README.txt").write_text("\n".join(lines) + "\n\n" + __doc__)
    print("\n".join(lines[:3]))


if __name__ == "__main__":
    main(sys.argv[1])
