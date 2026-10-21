"""The review flow after an upload: three pauses where a person decides, then the usual run.

    upload -> validate -> clean (each file)
           -> 1 conflicts     (crossval.py)        pause: pick the correct value per conflict
           -> 2 opportunities (opportunities.py)   pause: accept / edit / reject per opportunity
           -> 3 matching      (your matching script, with the accepted pipeline demand added)
                                                   pause: accept / swap / reject per demand line
           -> hiring gap, availability forecast, publish (as before)

What the review page reads (results/uploads/<batchId>/, next to status.json):
    review/conflicts.json      {"conflicts": [...]}
    review/forecast.json       {"opportunities": [...], "notes": [...]}
    review/matching.json       {"lines": [...], "people": {...}, "assignment": {...}, "notes": [...]}
status.json run.state is "awaiting_review" with run.step = conflicts | forecast | matching while
the pipeline waits. The page sends the decisions to the API Lambda, which starts this Lambda with
{"mode": "review", "batchId": ..., "step": ..., "decisions": {...}}.

Working files of one review: curated/review/<batchId>/ (conflicts, decisions, matching tables).
This module holds the logic; lambda_function.py moves between the steps.
"""
from __future__ import annotations

import hashlib
import math

import numpy as np
import pandas as pd

from . import clean, fiscal

STEPS = ("conflicts", "forecast", "matching")
STATUS_ORDER = {"Available now": 0, "Rolling off 0-6m": 1, "Rolling off 7-12m": 2}
PIPELINE_PREFIX = "OPP-"          # quote line number given to demand that comes from an opportunity


def review_key(batch_id: str, step: str) -> str:
    return f"results/uploads/{batch_id}/review/{step}.json"


def work_prefix(batch_id: str) -> str:
    return f"curated/review/{batch_id}/"


# ---------------------------------------------------------------- inputs
def load_inputs(store) -> dict:
    """The latest clean version of every dataset, including the ones only the review flow uses."""
    inputs = clean.load_latest(store)
    for dataset in ("sl_rp", "sfdc_pipeline", "abcd"):
        key = f"clean/{dataset}/latest.json.gz"
        if store.exists(key):
            inputs[dataset] = {"table": store.read_table(key),
                               "quality": store.read_json_or(f"clean/{dataset}/latest.quality.json", {})}
    return inputs


# ---------------------------------------------------------------- step 2 -> 3: pipeline demand
def _edited(resource: dict, edit: dict | None) -> dict:
    out = dict(resource)
    for field in ("position", "grade", "start", "end", "fte"):
        if edit and edit.get(field) not in (None, ""):
            out[field] = edit[field]
    out["grade"] = int(out["grade"])
    out["fte"] = float(out["fte"])
    return out


def accepted_resources(opportunities: list[dict], decisions: dict) -> list[tuple[dict, dict]]:
    """(opportunity, edited resource) for every kept resource of every accepted opportunity."""
    if decisions.get("rejectedAll"):
        return []
    chosen = decisions.get("opportunities") or {}
    edits = decisions.get("edits") or {}
    removed = set(decisions.get("removed") or [])
    out = []
    for opp in opportunities:
        if chosen.get(opp["id"]) != "accepted":
            continue
        for r in opp["resources"]:
            if r["id"] not in removed:
                out.append((opp, _edited(r, edits.get(r["id"]))))
    return out


def pipeline_quote_rows(accepted: list[tuple[dict, dict]], ql_wide: pd.DataFrame, full_month_mds: float) -> pd.DataFrame:
    """Accepted pipeline resources as extra quote line rows, so your matching script treats them
    like any other demand: one row per resource per fiscal year, man-days in the month columns."""
    months = [m for m in fiscal.FY_MONTHS if m in ql_wide.columns]
    rows = []
    for opp, r in accepted:
        start, end = pd.Timestamp(r["start"] + "-01"), pd.Timestamp(r["end"] + "-01")
        by_fy: dict[str, dict] = {}
        for month in pd.date_range(start, end, freq="MS"):
            fy = fiscal.fy_label(month.date())
            name = month.strftime("%b")
            if name in months:
                by_fy.setdefault(fy, {})[name] = round(r["fte"] * full_month_mds, 2)
        for fy, values in by_fy.items():
            row = {c: pd.NA for c in ql_wide.columns}
            row.update({"Project ID": f"{PIPELINE_PREFIX}{opp['crmId']}",
                        "Quote Line Number": f"{PIPELINE_PREFIX}{r['id']}",
                        "Resource": "Generic Resource", "Grade": r["grade"], "Position Name": r["position"],
                        "Working City": "SG - Singapore", "Fiscal Year": fy, "Status": "Active",
                        "Customer": opp.get("customer") or pd.NA})
            for col in ("Name", "Project Name"):
                if col in ql_wide.columns:
                    row[col] = opp["name"]
            row.update(values)
            rows.append(row)
    extra = pd.DataFrame(rows, columns=ql_wide.columns)
    if "_row_id" in extra.columns:
        extra["_row_id"] = [f"QL-{PIPELINE_PREFIX}{i}" for i in range(len(extra))]
    return extra


# ---------------------------------------------------------------- step 3: matching list
PRP_ID_COLS = ["PRP | Project ID", "PRP | Quote Line Number", "PRP | Position Name", "PRP | Grade",
               "PRP | Resource", "PRP | Available From"]
QL_ID_COLS = ["QL | Project ID", "QL | Quote Line Number", "QL | Position Name", "QL | Grade", "QL | Start Date"]


def _ids(df: pd.DataFrame, cols: list[str], prefix: str) -> pd.Series:
    """Stable id per row from the given columns plus the occurrence number."""
    text = df.reindex(columns=cols).astype("string").fillna("").agg("|".join, axis=1)
    occurrence = text.groupby(text).cumcount().astype(str)
    return pd.Series([prefix + hashlib.sha1(f"{t}#{o}".encode()).hexdigest()[:12]
                      for t, o in zip(text, occurrence)], index=df.index)


def _ym(value) -> str | None:
    return None if value is None or pd.isna(value) else pd.Timestamp(value).strftime("%Y-%m")


def _txt(value) -> str:
    return "" if value is None or (not isinstance(value, str) and pd.isna(value)) else str(value)


def _grade(value) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def matching_review(match: pd.DataFrame, grade_tolerance: int, max_idle_months: int,
                    opportunities: list[dict]) -> dict:
    """The matching list for the review page: every demand line with its ranked candidates.

    Your script picks one person per line (or none). The other candidates are the people with the
    same standardised position, a band within GRADE_TOLERANCE, who are free on or before the
    line's start (at most MAX_IDLE_MONTHS before it), ranked by availability, then band gap.
    """
    if match is None or match.empty or "Match Status" not in match.columns:
        return {"lines": [], "people": {}, "assignment": {}}
    match = match.copy()
    has_person = match["Match Status"].isin(["MATCHED", "UNMATCHED RESOURCE"])
    has_line = match["Match Status"].isin(["MATCHED", "UNMATCHED PROJECT"])
    match.loc[has_person, "_person"] = _ids(match[has_person], PRP_ID_COLS, "P-")
    match.loc[has_line, "_line"] = _ids(match[has_line], QL_ID_COLS, "L-")

    people_rows = match[has_person]
    people = {}
    for _, r in people_rows.iterrows():
        people[r["_person"]] = {
            "id": r["_person"],
            "label": f"{_txt(r['PRP | Resource']) or 'Resource'} ({_txt(r['PRP | Position Name'])})",
            "position": _txt(r["PRP | Standardized Position"]), "grade": _grade(r["PRP | Grade"]),
            "availableFrom": _ym(r["PRP | Available From"]) or "", "status": _txt(r["PRP | Availability Status"]),
            "currentProject": _txt(r["PRP | Project Name"]),
        }
    pool = pd.DataFrame(list(people.values()))
    opp_of = {r["id"]: o for o in opportunities for r in o["resources"]}

    lines, assignment = [], {}
    for _, r in match[has_line].iterrows():
        role = _txt(r["QL | Standardized Position"])
        grade = _grade(r["QL | Grade"])
        start = _ym(r["QL | Start Date"])
        candidates = []
        if not pool.empty and role and not role.startswith("UNMAPPED") and start:
            ok = pool[(pool["position"] == role) & ((pool["grade"] - grade).abs() <= grade_tolerance)
                      & (pool["availableFrom"] <= start)]
            earliest = (pd.Timestamp(start + "-01") - pd.DateOffset(months=max_idle_months)).strftime("%Y-%m")
            ok = ok[ok["availableFrom"] >= earliest]
            ok = ok.assign(_s=ok["status"].map(STATUS_ORDER).fillna(9), _g=(ok["grade"] - grade).abs())
            candidates = ok.sort_values(["_s", "availableFrom", "_g"])["id"].head(8).tolist()
        chosen = r["_person"] if r["Match Status"] == "MATCHED" else None
        if chosen:
            candidates = [chosen] + [c for c in candidates if c != chosen][:7]
        quote_line = _txt(r["QL | Quote Line Number"])
        pipeline = quote_line.startswith(PIPELINE_PREFIX)
        opp = opp_of.get(quote_line[len(PIPELINE_PREFIX):]) if pipeline else None
        lines.append({
            "id": r["_line"], "source": "pipeline" if pipeline else "current",
            "title": opp["name"] if opp else _txt(r["QL | Project Name"]),
            "reference": opp["crmId"] if opp else quote_line,
            "position": role if role and not role.startswith("UNMAPPED") else _txt(r["QL | Position Name"]),
            "grade": grade, "start": start, "candidates": candidates,
        })
        assignment[r["_line"]] = chosen
    lines.sort(key=lambda x: (x["source"] != "current", x["start"] or "9999"))
    named = {pid for line in lines for pid in line["candidates"]}          # only people the page can show
    return {"lines": lines, "people": {k: v for k, v in people.items() if k in named}, "assignment": assignment}


def apply_matching(match: pd.DataFrame, decisions: dict) -> pd.DataFrame:
    """Your script's matching table rebuilt with the user's choices: swapped people, lines left
    unfilled (rejected or "no match") and people freed by that."""
    if match is None or match.empty or "Match Status" not in match.columns:
        return match
    match = match.copy()
    has_person = match["Match Status"].isin(["MATCHED", "UNMATCHED RESOURCE"])
    has_line = match["Match Status"].isin(["MATCHED", "UNMATCHED PROJECT"])
    match.loc[has_person, "_person"] = _ids(match[has_person], PRP_ID_COLS, "P-")
    match.loc[has_line, "_line"] = _ids(match[has_line], QL_ID_COLS, "L-")
    prp_cols = [c for c in match.columns if c.startswith("PRP | ")]
    ql_cols = [c for c in match.columns if c.startswith("QL | ")]
    person_rows = match[has_person].drop_duplicates("_person").set_index("_person")[prp_cols]
    line_rows = match[has_line].drop_duplicates("_line").set_index("_line")[ql_cols]

    chosen = decisions.get("assignment") or {}
    verdict = decisions.get("decisions") or {}
    rows, used = [], set()
    for line_id, ql in line_rows.iterrows():
        person = chosen.get(line_id) if verdict.get(line_id) == "accepted" else None
        if person and person in person_rows.index and person not in used:
            used.add(person)
            rows.append({"Match Status": "MATCHED", **person_rows.loc[person].to_dict(), **ql.to_dict()})
        else:
            rows.append({"Match Status": "UNMATCHED PROJECT", **ql.to_dict()})
    for person, prp in person_rows.iterrows():
        if person not in used:
            rows.append({"Match Status": "UNMATCHED RESOURCE", **prp.to_dict()})
    order = {"MATCHED": 0, "UNMATCHED RESOURCE": 1, "UNMATCHED PROJECT": 2}
    out = pd.DataFrame(rows, columns=["Match Status"] + prp_cols + ql_cols)
    return out.sort_values("Match Status", key=lambda s: s.map(order), kind="stable").reset_index(drop=True)


def reviewed_tables(tables: dict[str, pd.DataFrame], decisions: dict) -> dict[str, pd.DataFrame]:
    """The matching sheets after the review: matching / matched / unmatched_* rebuilt, summary counts updated."""
    out = dict(tables)
    if "matching" not in tables or "Match Status" not in tables["matching"].columns:
        return out
    res = apply_matching(tables["matching"], decisions)
    status = res["Match Status"]
    lean = lambda f: f.dropna(axis=1, how="all")  # noqa: E731
    out.update(matching=res, matched=lean(res[status == "MATCHED"]),
               unmatched_resources=lean(res[status == "UNMATCHED RESOURCE"]),
               unmatched_projects=lean(res[status == "UNMATCHED PROJECT"]))
    if "summary" in tables:
        summary = tables["summary"].copy()
        for item in ("MATCHED", "UNMATCHED RESOURCE", "UNMATCHED PROJECT"):
            summary.loc[summary["Item"] == item, "Value"] = str(int((status == item).sum()))
        out["summary"] = summary
    return out


def hiring_gap(matching: pd.DataFrame, full_month_mds: float) -> pd.DataFrame:
    """Unfilled demand lines -> people to hire per start month, band and role.

    FTE is added up per month, band and role first, then rounded up, so several part-time needs
    in the same band become whole people before rounding."""
    empty = matching is None or "Match Status" not in getattr(matching, "columns", [])
    gap = pd.DataFrame() if empty else matching[matching["Match Status"] == "UNMATCHED PROJECT"].copy()
    if gap.empty:
        return pd.DataFrame(columns=["month", "band", "role", "lines", "fte", "heads", "from_pipeline"])
    gap["month"] = pd.to_datetime(gap["QL | Start Date"]).dt.strftime("%Y-%m")
    gap["band"] = gap["QL | Grade"].map(_grade)
    gap["role"] = gap["QL | Standardized Position"].fillna("UNMAPPED - FOR REVIEW")
    gap["fte"] = pd.to_numeric(gap["QL | Start MDs"], errors="coerce").fillna(0) / full_month_mds
    gap["from_pipeline"] = gap["QL | Quote Line Number"].astype("string").str.startswith(PIPELINE_PREFIX)
    out = (gap.groupby(["month", "band", "role"], as_index=False)
           .agg(lines=("fte", "size"), fte=("fte", "sum"), from_pipeline=("from_pipeline", "sum")))
    out["fte"] = out["fte"].round(2)
    # Round to one decimal before rounding up, so 1.03 FTE (18.5 man-days on an 18-day basis) is one person.
    out["heads"] = out["fte"].map(lambda f: int(math.ceil(round(f, 1) - 1e-9)) if f > 0 else 0)
    out["from_pipeline"] = out["from_pipeline"].astype(int)
    return out.sort_values(["month", "band", "role"]).reset_index(drop=True)


def plain(value):
    """JSON-safe copies of numpy / pandas values."""
    if isinstance(value, dict):
        return {k: plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [plain(v) for v in value]
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return None if math.isnan(value) else float(value)
    if value is pd.NA or value is pd.NaT:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    if isinstance(value, pd.Timestamp):
        return value.strftime("%Y-%m-%d")
    return value
