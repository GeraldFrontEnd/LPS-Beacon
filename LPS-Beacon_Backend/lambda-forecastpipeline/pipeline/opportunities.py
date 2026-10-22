"""Review step 2: the resources each pipeline opportunity needs (the "opportunity forecast").

This is NOT the availability forecast in forecast.py (who becomes free, from the resource
plan and quote lines). This step answers: if we win this SFDC opportunity, which roles,
bands and months does it need?

For every opportunity in the SFDC pipeline file whose stage is in FORECAST_STAGES:
  1. CRM match      its CRM ID appears in SL x RP. The SL x RP rows with that CRM ID are its
                    resource plan. Only "Project" and "Quote ..." demand types count; "Pre Sales"
                    (the bid team) and "Internal" rows are ignored.
  2. Similar project  no CRM match: the ABCD project most like it (TCV, duration, solution
                    offering, name) that has project rows in SL x RP. Its resources are copied,
                    with their months moved to start when the opportunity's revenue starts.
                    This is a recommendation only; the review page makes the user accept it
                    opportunity by opportunity.
  3. Manual         neither: the opportunity is listed with no resources.

Telling resources apart in SL x RP
  Project rows  one person = ID + IT Code (one row per person per month)
  Quote rows    the resource is a generic placeholder, so one role = ID + Position Name
                (without a trailing FY26/FY27) + Grade
FTE per month = MD / RP_FULL_MONTH_MDS (18), averaged over the months with man-days.

Duplicates are flagged, never removed: a resource identical to an earlier one in the same
opportunity (role, band, months, FTE), and a quote row whose quote line number is already in
the uploaded quote line file (that demand is already matched as a current project).
"""
from __future__ import annotations

import math
import re

import pandas as pd

STOPWORDS = {"the", "and", "for", "with", "year", "renewal", "project", "services", "service", "of", "to"}


def _ym(value) -> str | None:
    if value is None or (isinstance(value, float) and math.isnan(value)) or pd.isna(value):
        return None
    return pd.Timestamp(value).strftime("%Y-%m")


def _num(value, default=0.0) -> float:
    try:
        v = float(value)
        return default if math.isnan(v) else v
    except (TypeError, ValueError):
        return default


def _text(value) -> str:
    return "" if value is None or (not isinstance(value, str) and pd.isna(value)) else str(value)


def _clean_position(value) -> str:
    text = re.sub(r"\s+", " ", _text(value)).strip()
    return re.sub(r"\s*\bFY\d{2}\b$", "", text, flags=re.IGNORECASE)


def _months_between(a: pd.Timestamp, b: pd.Timestamp) -> int:
    return (b.year - a.year) * 12 + (b.month - a.month)


def _tokens(text: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9]+", text.lower()) if len(t) >= 3 and t not in STOPWORDS}


def _resources(oid: str, rows: pd.DataFrame, full_month_mds: float, shift: int = 0) -> list[dict]:
    """Groups SL x RP rows into resources (see the module notes)."""
    rows = rows[rows["MD"].fillna(0) > 0].copy()
    if rows.empty:
        return []
    if shift:
        rows["Calendar Date"] = rows["Calendar Date"] + pd.DateOffset(months=shift)
    rows["_pos"] = rows["Position Name"].map(_clean_position)
    rows["_who"] = rows["IT Code"].fillna(rows["Resource"].fillna("") + "|" + rows["_pos"])
    out = []
    projects = rows[rows["Demand Type"] == "Project"]
    quotes = rows[rows["Demand Type"] != "Project"]
    groups = list(projects.groupby(["ID", "_who"], dropna=False)) + \
        list(quotes.groupby(["ID", "_pos", "Grade"], dropna=False))
    for key, g in groups:
        grade = g["Grade"].dropna()
        out.append({
            "id": f"{oid}-r{len(out) + 1}",
            "sourceId": (_text(key[0]) if g["Demand Type"].iloc[0] != "Project"
                         else f"{_text(key[0])} / {_text(g['IT Code'].iloc[0])}".rstrip(" /")),
            "position": g["_pos"].mode().iloc[0] if g["_pos"].notna().any() else "",
            "grade": int(grade.mode().iloc[0]) if len(grade) else 0,
            "start": g["Calendar Date"].min().strftime("%Y-%m"),
            "end": g["Calendar Date"].max().strftime("%Y-%m"),
            "fte": round(float((g["MD"] / full_month_mds).mean()), 2) or 0.01,
            "manDays": round(float(g["MD"].sum()), 2),
            "demandType": g["Demand Type"].iloc[0],
        })
    out.sort(key=lambda r: (r["start"], r["position"]))
    for i, r in enumerate(out):
        r["id"] = f"{oid}-r{i + 1}"
    return out


def _flag_duplicates(resources: list[dict], quote_lines: set[str]) -> None:
    first: dict[tuple, str] = {}
    for r in resources:
        key = (r["position"].lower(), r["grade"], r["start"], r["end"], r["fte"])
        if key in first:
            r["duplicateOf"] = first[key]
        else:
            first[key] = r["id"]
        if r["demandType"] != "Project" and r["sourceId"] in quote_lines:
            r["alreadyInQuoteLines"] = r["sourceId"]


# How much each criterion counts towards the similarity score. Shown on the review page, so keep them in sync.
WEIGHTS = {"tcv": 0.35, "offering": 0.25, "duration": 0.2, "name": 0.2}


def _similar(opp: pd.Series, candidates: pd.DataFrame,
             threshold: float) -> tuple[pd.Series, float, list[str], dict] | None:
    """The ABCD project most like the opportunity: (row, score, reasons, per-criterion scores), or None."""
    if candidates.empty:
        return None
    tcv = _num(opp.get("TCV (converted)"))
    start, end = opp.get("Revenue From"), opp.get("Revenue To")
    duration = _months_between(start, end) + 1 if pd.notna(start) and pd.notna(end) else None
    offering = _text(opp.get("Major Solution Offering")).strip().lower()
    words = _tokens(_text(opp.get("Opportunity Name (English)")))

    tcv_c = candidates["TCV_USD"].fillna(0).to_numpy(float)
    tcv_score = [min(tcv, c) / max(tcv, c) if tcv > 0 and c > 0 else 0.0 for c in tcv_c]
    dur_c = candidates["_duration"].to_numpy(float)
    dur_score = [min(duration, d) / max(duration, d) if duration and d and d > 0 else 0.0 for d in dur_c]
    off_score = [1.0 if offering and offering in (s1, s2) else 0.0
                 for s1, s2 in zip(candidates["_offering"], candidates["_service_line"])]
    name_score = [len(words & t) / len(words | t) if words and t else 0.0 for t in candidates["_tokens"]]
    scores = [WEIGHTS["tcv"] * a + WEIGHTS["duration"] * b + WEIGHTS["offering"] * c + WEIGHTS["name"] * d
              for a, b, c, d in zip(tcv_score, dur_score, off_score, name_score)]
    best = max(range(len(scores)), key=scores.__getitem__)
    if scores[best] < threshold:
        return None
    row = candidates.iloc[best]
    reasons = [f"TCV {round(tcv_score[best] * 100)}% alike"]
    if dur_score[best]:
        reasons.append(f"duration {round(dur_score[best] * 100)}% alike")
    if off_score[best]:
        reasons.append(f"same offering ({opp.get('Major Solution Offering')})")
    if name_score[best]:
        reasons.append("similar name")
    parts = {"tcv": round(tcv_score[best], 2), "duration": round(dur_score[best], 2),
             "offering": bool(off_score[best]), "name": round(name_score[best], 2),
             "opportunityMonths": duration}
    return row, round(scores[best], 2), reasons, parts


def run(cfg, inputs: dict) -> tuple[list[dict], list[str]]:
    """Returns (opportunities in the review page's shape, notes)."""
    notes: list[str] = []
    sfdc = inputs.get("sfdc_pipeline", {}).get("table")
    sl = inputs.get("sl_rp", {}).get("table")
    if sfdc is None:
        return [], ["no SFDC pipeline file uploaded yet, so there are no opportunities to forecast"]
    if sl is None:
        notes.append("no SL x RP file uploaded yet, so no opportunity has resources; all need manual input")
        sl = pd.DataFrame(columns=["Demand Type", "ID", "CRM ID", "Calendar Date", "MD", "Grade", "IT Code",
                                   "Resource", "Position Name"])
    stages = tuple(cfg.forecast_stages)
    opps = sfdc[sfdc["Stage"].fillna("").map(lambda s: s.split(" ")[0] in stages)]
    delivery = sl[sl["Demand Type"].fillna("").map(lambda t: t == "Project" or t.startswith("Quote"))]
    ql = inputs.get("quoteline", {}).get("wide")
    quote_lines = set(ql["Quote Line Number"].dropna().astype(str)) if ql is not None else set()

    # Past projects that can be copied: in ABCD and with project rows in SL x RP.
    abcd = inputs.get("abcd", {}).get("table")
    project_rows = delivery[delivery["Demand Type"] == "Project"]
    if abcd is not None and not project_rows.empty:
        spans = project_rows.groupby("ID")["Calendar Date"].agg(["min", "max"])
        cand = abcd[abcd["Project_ID"].isin(spans.index)].copy()
        cand["_duration"] = cand["Duration_Months"].fillna(
            cand["Project_ID"].map(lambda p: _months_between(spans.at[p, "min"], spans.at[p, "max"]) + 1))
        cand["_offering"] = cand["Solution_Offering"].fillna("").str.strip().str.lower()
        cand["_service_line"] = cand["Service_Line"].fillna("").str.strip().str.lower()
        cand["_tokens"] = cand["Project_Name"].fillna("").map(_tokens)
        cand = cand.reset_index(drop=True)
    else:
        cand = pd.DataFrame()
        if abcd is None:
            notes.append("no ABCD file uploaded yet, so opportunities without a CRM match can't be compared "
                         "with past projects")

    out = []
    for _, o in opps.iterrows():
        crm = _text(o["CRM ID"])
        oid = "O-" + re.sub(r"[^A-Za-z0-9-]", "-", crm)
        start, end = _ym(o.get("Revenue From")), _ym(o.get("Revenue To"))
        item = {
            "id": oid, "crmId": crm, "name": _text(o.get("Opportunity Name (English)")) or crm,
            "customer": _text(o.get("End Customer")), "stage": _text(o.get("Stage")),
            "probability": _num(o.get("Probability (%)")), "tcvUsd": round(_num(o.get("TCV (converted)"))),
            "expectedClose": _ym(o.get("Expected Closed Date")), "start": start, "end": end,
            "offering": _text(o.get("Major Solution Offering")), "source": "manual", "basis": None,
            "resources": [],
        }
        own = delivery[delivery["CRM ID"].astype("string") == crm]
        resources = _resources(oid, own, cfg.rp_full_month_mds) if not own.empty else []
        if resources:
            item["source"] = "crm"
        else:
            found = _similar(o, cand, cfg.similarity_threshold) if not cand.empty else None
            if found is not None:
                row, score, reasons, parts = found
                rows = project_rows[project_rows["ID"] == row["Project_ID"]]
                anchor = o.get("Revenue From")
                if pd.isna(anchor) and pd.notna(o.get("Expected Closed Date")):
                    anchor = pd.Timestamp(o["Expected Closed Date"]).replace(day=1) + pd.DateOffset(months=1)
                shift = _months_between(rows["Calendar Date"].min(), pd.Timestamp(anchor)) if pd.notna(anchor) else 0
                resources = _resources(oid, rows, cfg.rp_full_month_mds, shift)
                if resources:
                    item["source"] = "similar"
                    item["basis"] = {
                        "projectId": row["Project_ID"], "projectName": _text(row["Project_Name"]),
                        "tcvUsd": round(_num(row["TCV_USD"])), "start": _ym(row["Planned_Start"]),
                        "end": _ym(row["Planned_End_Date"]), "offering": _text(row["Solution_Offering"]),
                        "shiftedMonths": shift, "score": score, "reasons": reasons,
                        # For the side-by-side comparison on the review page.
                        "durationMonths": None if pd.isna(row["_duration"]) else int(row["_duration"]),
                        "opportunityMonths": parts["opportunityMonths"],
                        "threshold": cfg.similarity_threshold,
                        "weights": WEIGHTS,
                        "match": {"tcv": parts["tcv"], "duration": parts["duration"],
                                  "offering": parts["offering"], "name": parts["name"]},
                    }
        _flag_duplicates(resources, quote_lines)
        item["resources"] = resources
        out.append(item)

    order = {"crm": 0, "similar": 1, "manual": 2}
    out.sort(key=lambda x: (order[x["source"]], x["start"] or "9999", x["name"]))
    counts = {s: sum(1 for x in out if x["source"] == s) for s in order}
    notes.append(f"{len(out)} opportunities in stages {', '.join(stages)}: {counts['crm']} from a CRM match, "
                 f"{counts['similar']} from a similar past project, {counts['manual']} need manual input")
    return out, notes
