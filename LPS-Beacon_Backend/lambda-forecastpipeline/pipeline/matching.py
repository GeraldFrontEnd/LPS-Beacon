"""Stage 3: run YOUR matching script on the cleaned tables.

Your script stays the source of truth for position standardisation, availability
and the T1-T4 matching. This adapter only feeds it and collects its output.

How your script is found
  MATCHING_SCRIPT (default matching_script.py) is a path inside the Lambda package.
  It is loaded by path, so a file name with spaces or dots also works, but a plain
  name such as matching_script.py is easier to keep track of.

What the adapter calls
  The first of these functions that exists: run_matching, run, main.
  Arguments are passed BY NAME, and only the names your function declares are sent
  (or all of them if it takes **kwargs). Available names:
      rp_df / prp_df            cleaned resource plan, original column names
      ql_df                     cleaned quote lines, original column names
      mapping_path              local path of the Position Name Mapping workbook
      mapping_sheets            {sheet name: DataFrame} of that workbook
      as_of / planning_date     datetime.date, 1st of the month
      window_months, grade_tolerance, max_idle_months, renewal_rate
      output_path               /tmp path where the script may write an .xlsx
      rp_path, ql_path          /tmp CSV copies of the CLEANED tables, for scripts that read files
      rp_source_path,           /tmp copies of the ORIGINAL uploads (same bytes the user sent,
      ql_source_path            original extension); None if the raw file is gone
      skill_threshold, rp_full_month_mds, ql_full_month_mds

What the function must return (any one of)
  * dict {sheet name: DataFrame}, sheet names as in matching_result_new.xlsx
  * a path to the .xlsx it wrote (output_path is the natural choice)
  * None, if it wrote output_path

Optional, recommended: standardize_positions(df) in the same script
  df has columns "Position Name", "Grade", "Skill" (one row per distinct combination
  across BOTH files). Return a list/Series of standardised positions in the same
  order, or a DataFrame with a "Standardized Position" column. The forecast stage
  then gives every quote line a role, not only the lines inside the matching window.

If your function uses other argument names, change _call() below; it is the only
place that knows about your script.

Lambda only allows writing under /tmp. A script that saves next to itself or to
the current folder fails there, so make it write to output_path.

Script messages: anything it prints is logged. Lines starting with "WARNING:" become run
warnings (shown on the review page); a SystemExit (sys.exit("ERROR: ...")) becomes a
MatchingError with that message instead of killing the Lambda runtime. A script may also
expose a list LAST_WARNINGS that is read after each call.
"""
from __future__ import annotations

import contextlib
import importlib.util
import inspect
import io
import logging
import os
import shutil
import sys
import tempfile
from pathlib import Path

import pandas as pd

from .config import Config

log = logging.getLogger(__name__)

ENTRY_POINTS = ("run_matching", "run", "main")
EXPECTED_SHEETS = ("Summary", "Matching", "Matched", "Unmatched Resources", "Unmatched Projects",
                   "Position Mapping", "Positions For Review")
_module_cache: dict[str, object] = {}


class MatchingError(RuntimeError):
    pass


def _load_module(path: str):
    if path in _module_cache:
        return _module_cache[path]
    full = Path(path)
    if not full.is_absolute():
        full = Path(os.environ.get("LAMBDA_TASK_ROOT", Path(__file__).resolve().parent.parent)) / path
    if not full.exists():
        raise MatchingError(f"matching script not found at {full} (set MATCHING_SCRIPT)")
    spec = importlib.util.spec_from_file_location("user_matching_script", full)
    module = importlib.util.module_from_spec(spec)
    sys.modules["user_matching_script"] = module
    spec.loader.exec_module(module)
    _module_cache[path] = module
    return module


def _call(func, available: dict):
    params = inspect.signature(func).parameters
    if any(p.kind is inspect.Parameter.VAR_KEYWORD for p in params.values()):
        return func(**available)
    missing = [n for n, p in params.items()
               if p.default is inspect.Parameter.empty
               and p.kind in (p.POSITIONAL_OR_KEYWORD, p.KEYWORD_ONLY) and n not in available]
    if missing:
        raise MatchingError(f"{func.__name__}() needs argument(s) {missing} that the adapter "
                            "does not provide; rename them or edit pipeline/matching.py _call()")
    return func(**{n: v for n, v in available.items() if n in params})


def _to_sheets(result, output_path: str) -> dict[str, pd.DataFrame]:
    if isinstance(result, dict) and all(isinstance(v, pd.DataFrame) for v in result.values()):
        return result
    if isinstance(result, (str, Path)) and Path(result).exists():
        return pd.read_excel(result, sheet_name=None)
    if result is None and Path(output_path).exists():
        return pd.read_excel(output_path, sheet_name=None)
    raise MatchingError("the matching script must return {sheet: DataFrame}, a path to an .xlsx, "
                        "or write output_path")


def _source_copy(store, quality: dict, work: Path, stem: str) -> str | None:
    """Copies the original upload (raw/...) into /tmp so the script reads exactly what the user sent."""
    key = (quality or {}).get("sourceKey")
    if not store or not key:
        return None
    try:
        data = store.read_bytes(key)
    except Exception:  # noqa: BLE001 - the cleaned copy is the fallback
        log.warning("original upload %s could not be read; the script gets the cleaned copy", key)
        return None
    suffix = Path(key).suffix.lower() or ".csv"
    path = work / f"{stem}_source{suffix}"
    path.write_bytes(data)
    return str(path)


def _invoke(module, func, available: dict) -> tuple[object, list[str]]:
    """Calls the script, capturing its prints. Returns (result, warnings)."""
    if hasattr(module, "LAST_WARNINGS"):
        module.LAST_WARNINGS = []
    printed = io.StringIO()
    try:
        with contextlib.redirect_stdout(printed):
            result = _call(func, available)
    except SystemExit as exc:  # sys.exit("ERROR: ...") inside the script
        raise MatchingError(str(exc.code if exc.code is not None else "matching script exited")
                            .removeprefix("ERROR: ")) from None
    finally:
        text = printed.getvalue()
        if text.strip():
            log.info("matching script output:\n%s", text[-20000:])
    warnings = [line.split(":", 1)[1].strip() for line in text.splitlines()
                if line.startswith("WARNING:")]
    warnings += [w for w in getattr(module, "LAST_WARNINGS", []) or [] if w not in warnings]
    return result, warnings


def run(cfg: Config, inputs: dict, store=None) -> tuple[dict[str, pd.DataFrame], list[str]]:
    module = _load_module(cfg.matching_script)
    func = next((getattr(module, n) for n in ENTRY_POINTS if callable(getattr(module, n, None))), None)
    if func is None:
        raise MatchingError(f"{cfg.matching_script} has none of {ENTRY_POINTS}")

    work = Path(tempfile.mkdtemp(prefix="matching-", dir="/tmp" if Path("/tmp").exists() else None))
    rp = inputs["resource_plan"]["wide"].drop(columns=["_row_id"])
    ql = inputs["quoteline"]["wide"].drop(columns=["_row_id"])
    rp_path, ql_path = work / "resource_plan.csv", work / "quoteline.csv"
    rp.to_csv(rp_path, index=False)
    ql.to_csv(ql_path, index=False)

    mapping_path, mapping_sheets = None, {}
    if "position_mapping" in inputs:
        mapping_path = work / "position_mapping.xlsx"
        mapping_path.write_bytes(inputs["position_mapping"]["xlsx"])
        mapping_sheets = pd.read_excel(mapping_path, sheet_name=None)

    output_path = str(work / "matching_result.xlsx")
    available = {
        "rp_df": rp, "prp_df": rp, "ql_df": ql,
        "rp_path": str(rp_path), "ql_path": str(ql_path),
        "rp_source_path": _source_copy(store, inputs["resource_plan"].get("quality"), work, "resource_plan"),
        "ql_source_path": _source_copy(store, inputs["quoteline"].get("quality"), work, "quoteline"),
        "rp_source_key": (inputs["resource_plan"].get("quality") or {}).get("sourceKey"),
        "ql_source_key": (inputs["quoteline"].get("quality") or {}).get("sourceKey"),
        "skill_threshold": cfg.skill_threshold, "rp_full_month_mds": cfg.rp_full_month_mds,
        "ql_full_month_mds": cfg.ql_full_month_mds,
        "mapping_path": str(mapping_path) if mapping_path else None, "mapping_sheets": mapping_sheets,
        "as_of": cfg.as_of, "planning_date": cfg.as_of, "window_months": cfg.window_months,
        "grade_tolerance": cfg.grade_tolerance, "max_idle_months": cfg.max_idle_months,
        "renewal_rate": cfg.renewal_rate, "output_path": output_path,
    }
    try:
        result, script_warnings = _invoke(module, func, available)
        sheets = _to_sheets(result, output_path)
    finally:
        # /tmp survives between warm invocations (512 MB), so clean up every run.
        shutil.rmtree(work, ignore_errors=True)

    lookup = _standardize_all(module, rp, ql)
    if lookup is not None:
        sheets["position_lookup_all"] = lookup

    warnings = [f"matching: {w}" for w in script_warnings]
    warnings += [f"matching output has no '{s}' sheet" for s in EXPECTED_SHEETS if s not in sheets]
    if "position_mapping" not in inputs:
        warnings.append("no Position Name Mapping uploaded; the script ran without it")
    # Table names in storage cannot contain spaces or symbols.
    return {_safe(name): df for name, df in sheets.items()}, warnings


def _standardize_all(module, rp: pd.DataFrame, ql: pd.DataFrame) -> pd.DataFrame | None:
    func = getattr(module, "standardize_positions", None)
    if not callable(func):
        return None
    cols = ["Position Name", "Grade", "Skill"]
    combos = (pd.concat([rp.reindex(columns=cols), ql.reindex(columns=cols)])
              .drop_duplicates().dropna(subset=["Position Name"]).reset_index(drop=True))
    result = func(combos.copy())
    if isinstance(result, pd.DataFrame):
        result = result["Standardized Position"]
    combos["Standardized Position"] = list(result)
    return combos.astype({"Position Name": "string", "Standardized Position": "string"})


def _safe(name: str) -> str:
    return "".join(ch if ch.isalnum() else "_" for ch in name).strip("_").lower()
