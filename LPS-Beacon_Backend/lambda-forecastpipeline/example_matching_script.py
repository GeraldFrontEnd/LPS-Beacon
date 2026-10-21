"""EXAMPLE ONLY - shows the shape the pipeline expects from your matching script.

Replace this file with your own working script (rename it matching_script.py, or
set MATCHING_SCRIPT to its file name). Your script does the real work; this stub
only maps position names exactly and matches nothing, so tests can run.

Contract (see pipeline/matching.py for the full list of arguments):
    def run_matching(rp_df, ql_df, mapping_sheets, as_of, window_months, ...) -> dict
returning {sheet name: DataFrame} with the sheet names of matching_result_new.xlsx.
"""
import pandas as pd


def run_matching(rp_df, ql_df, mapping_sheets, as_of, window_months, grade_tolerance,
                 max_idle_months):
    mapping = mapping_sheets.get("Position Name Mapping", pd.DataFrame(columns=["Position Name", "Standard Role"]))
    lookup = dict(zip(mapping["Position Name"].astype(str), mapping["Standard Role"]))
    names = pd.Series(sorted(set(rp_df["Position Name"].dropna()) | set(ql_df["Position Name"].dropna())))
    position_mapping = pd.DataFrame({"Position Name": names,
                                     "Standardized Position": names.map(lookup).fillna("UNMAPPED - FOR REVIEW")})
    summary = pd.DataFrame({"Item": ["Planning date (as-of)", "Rolling window (months)", "MATCHED"],
                            "Value": [as_of.isoformat(), window_months, 0]})
    return {
        "Summary": summary,
        "Matching": pd.DataFrame(),
        "Position Mapping": position_mapping,
        "Positions For Review": position_mapping[position_mapping["Standardized Position"].str.startswith("UNMAPPED")],
    }
