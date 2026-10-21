"""Review step 1: cross-validation. The same record in two files with different values.

Which records are compared (both sides must have been uploaded at some point):
  quote line role   Quote Line Number + Position Name, in the quote line file and in the
                    SL x RP quote rows (SL x RP "ID" holds the quote line number)
  project role      Project ID + Position Name, in the resource plan and in the SL x RP
                    project rows
A conflict is a key that has exactly one Grade in each file, and the two differ. A key with
several grades in one file is several people (for example a band 6 and a band 7 engineer),
not a conflict.

The user picks the correct value per conflict. apply() then writes that value into every
file's rows for the key, so the value not chosen is left out of forecasting and matching.
The uploaded files themselves are never changed.
"""
from __future__ import annotations

import hashlib
import re

import pandas as pd

FIELD = "Grade"


def norm_position(value) -> str:
    """Position names as compared: lower case, single spaces, without a trailing 'FY26' style suffix."""
    if value is None or (not isinstance(value, str) and pd.isna(value)):
        return ""
    text = re.sub(r"\s+", " ", str(value)).strip()
    text = re.sub(r"\s*\bFY\d{2}\b$", "", text, flags=re.IGNORECASE)
    return text.lower()


def _conflict_id(kind: str, key: tuple) -> str:
    return "C-" + hashlib.sha1(("|".join([kind, *map(str, key)])).encode()).hexdigest()[:10]


def _file_name(quality: dict | None, fallback: str) -> str:
    key = (quality or {}).get("sourceKey") or ""
    return key.rsplit("/", 1)[-1] or fallback


def _grades(df: pd.DataFrame, key_cols: list[str]) -> pd.DataFrame:
    """key -> the set of grades and how many rows carry the key."""
    g = df.dropna(subset=[FIELD]).groupby(key_cols)
    return pd.DataFrame({"grades": g[FIELD].agg(lambda s: frozenset(int(v) for v in s)),
                         "rows": g.size()})


def _compare(kind: str, entity: str, left: pd.DataFrame, right: pd.DataFrame,
             left_file: str, right_file: str, left_where, right_where) -> list[dict]:
    key_cols = ["_key_id", "_key_pos"]
    a, b = _grades(left, key_cols), _grades(right, key_cols)
    both = a.join(b, how="inner", lsuffix="_a", rsuffix="_b")
    out = []
    for (key_id, key_pos), row in both.iterrows():
        ga, gb = row["grades_a"], row["grades_b"]
        if len(ga) != 1 or len(gb) != 1 or ga == gb:
            continue
        va, vb = next(iter(ga)), next(iter(gb))
        label = left.loc[(left["_key_id"] == key_id) & (left["_key_pos"] == key_pos), "_label"].iloc[0]
        out.append({
            "id": _conflict_id(kind, (key_id, key_pos)), "kind": kind, "entity": entity,
            "key": key_id, "position": key_pos, "label": label, "field": FIELD,
            "options": [
                {"id": "a", "file": left_file, "value": f"Band {va}", "raw": va,
                 "location": left_where(key_id, int(row["rows_a"]))},
                {"id": "b", "file": right_file, "value": f"Band {vb}", "raw": vb,
                 "location": right_where(key_id, int(row["rows_b"]))},
            ],
        })
    return out


def find(inputs: dict) -> list[dict]:
    """All conflicts between the latest cleaned files. inputs as from review.load_inputs()."""
    sl = inputs.get("sl_rp", {}).get("table")
    if sl is None or sl.empty:
        return []
    sl = sl.assign(_key_id=sl["ID"], _key_pos=sl["Position Name"].map(norm_position),
                   _label=sl["Position Name"])
    sl_file = _file_name(inputs["sl_rp"].get("quality"), "SL x RP")

    def sl_where(key_id, n):
        rows = sl.loc[sl["_key_id"] == key_id, "_row"]
        return f"{n} monthly rows for {key_id}, from row {int(rows.min())}" if len(rows) else key_id

    conflicts: list[dict] = []
    ql = inputs.get("quoteline", {}).get("wide")
    if ql is not None and not ql.empty:
        q = ql.assign(_key_id=ql["Quote Line Number"], _key_pos=ql["Position Name"].map(norm_position),
                      _label=ql["Position Name"])
        quotes = sl[sl["Demand Type"].fillna("").str.startswith("Quote")]
        conflicts += _compare("quoteline", "Quote line role", q, quotes,
                              _file_name(inputs["quoteline"].get("quality"), "Quote line"), sl_file,
                              lambda k, n: f"{n} row(s) for {k}", sl_where)
    rp = inputs.get("resource_plan", {}).get("wide")
    if rp is not None and not rp.empty:
        r = rp.assign(_key_id=rp["Project ID"], _key_pos=rp["Position Name"].map(norm_position),
                      _label=rp["Position Name"])
        projects = sl[sl["Demand Type"] == "Project"]
        conflicts += _compare("resource_plan", "Project role", r, projects,
                              _file_name(inputs["resource_plan"].get("quality"), "Resource plan"), sl_file,
                              lambda k, n: f"{n} row(s) for {k}", sl_where)
    return sorted(conflicts, key=lambda c: (c["entity"], c["key"], c["position"]))


def apply(inputs: dict, conflicts: list[dict], choices: dict[str, str]) -> list[str]:
    """Writes each chosen value into every file's rows for that key. Returns notes for the run log."""
    notes = []
    for c in conflicts:
        chosen = next((o for o in c["options"] if o["id"] == choices.get(c["id"])), None)
        if chosen is None:
            continue
        value = int(chosen["raw"])
        targets = [("sl_rp", "table", "ID")]
        targets.append(("quoteline", "wide", "Quote Line Number") if c["kind"] == "quoteline"
                       else ("resource_plan", "wide", "Project ID"))
        for dataset, part, id_col in targets:
            df = inputs.get(dataset, {}).get(part)
            if df is None:
                continue
            mask = (df[id_col] == c["key"]) & (df["Position Name"].map(norm_position) == c["position"])
            df.loc[mask, FIELD] = value
            long = inputs.get(dataset, {}).get("long")
            if long is not None and "_row_id" in df.columns and "grade" in long.columns:
                long.loc[long["row_id"].isin(df.loc[mask, "_row_id"]), "grade"] = value
        notes.append(f"{c['key']} {c['label']}: Band {value} ({chosen['file']})")
    return notes
