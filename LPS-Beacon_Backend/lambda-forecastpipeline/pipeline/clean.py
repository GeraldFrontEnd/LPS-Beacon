"""Stage 2: clean one uploaded file and save it under clean/.

What it recognises (by its columns, not its file name):
  resource_plan     Project Resource Plan export (has "Project Owner", months May..Mar)
  quoteline         Quote Line export (has "Name" and months Apr..Mar)
  position_mapping  workbook with a sheet holding "Position Name" + "Standard Role"
  rates             optional finance table: "Grade" plus "Daily Rate" and/or "Daily Cost"
                    (optionally "Standard Role" for role-specific rates)

For resource_plan and quoteline two tables are written:
  clean/<dataset>/latest_wide.json.gz  original columns, typed and trimmed.
                                      This is what your matching script receives,
                                      so its logic sees the columns it was built for.
  clean/<dataset>/latest_long.json.gz  one row per line per month (month, mds, fte),
                                      used by the forecast stage.
Every run also keeps a dated copy under clean/<dataset>/history/ and a quality report.

Rows are never de-duplicated: identical rows in the resource plan are separate
people (for example three "IT Security Officer" lines on one project).
"""
from __future__ import annotations

import datetime as dt
import hashlib
import io
import re

import pandas as pd

from . import fiscal
from .config import Config
from .s3io import Store

DATASETS = ("resource_plan", "quoteline", "position_mapping", "rates")

RP_REQUIRED = {"Project ID", "Quote Line Number", "Resource", "Grade", "Position Name",
               "Fiscal Year", "Project Owner"}
QL_REQUIRED = {"Quote Line Number", "Resource", "Grade", "Position Name", "Fiscal Year", "Name"}
TEXT_COLUMNS = ["Project ID", "Quote Line Number", "Resource", "Skill", "Position Name",
                "Working City", "Fiscal Year", "Status", "Customer", "End Customer",
                "Project Type", "Quote ID", "Project Name", "Name", "Project Status",
                "Project Owner", "Contract Number", "SFDC numbers", "Created By"]


class CleanError(ValueError):
    """The file was readable but is not a dataset the pipeline understands."""


# ---------------------------------------------------------------- reading
def _norm_header(name) -> str:
    return re.sub(r"\s+", " ", str(name)).strip()


def read_any(data: bytes, ext: str) -> dict[str, pd.DataFrame]:
    """Returns {sheet name: DataFrame}. A CSV is returned as a single sheet 'csv'."""
    if ext in (".xlsx", ".xlsm"):
        sheets = pd.read_excel(io.BytesIO(data), sheet_name=None, engine="openpyxl", dtype=object)
    else:
        sep = "\t" if ext == ".tsv" else None
        text = None
        for encoding in ("utf-8-sig", "cp1252"):
            try:
                text = data.decode(encoding)
                break
            except UnicodeDecodeError:
                continue
        if text is None:
            raise CleanError("cannot decode the text file")
        sheets = {"csv": pd.read_csv(io.StringIO(text), sep=sep, engine="python", dtype=object)}
    out = {}
    for name, df in sheets.items():
        df = df.copy()
        df.columns = [_norm_header(c) for c in df.columns]
        df = df.loc[:, [c for c in df.columns if c and not c.startswith("Unnamed:")]]
        out[name] = df.dropna(how="all")
    return out


def detect(sheets: dict[str, pd.DataFrame]) -> tuple[str, dict[str, pd.DataFrame]]:
    """Works out which dataset a file holds. Returns (dataset, sheets to keep)."""
    for df in sheets.values():
        cols = set(df.columns)
        if RP_REQUIRED <= cols:
            return "resource_plan", {"main": df}
        if QL_REQUIRED <= cols and "Project Owner" not in cols and "Apr" in cols:
            return "quoteline", {"main": df}
    mapping = {n: df for n, df in sheets.items() if {"Position Name", "Standard Role"} <= set(df.columns)}
    if mapping:
        return "position_mapping", sheets
    for df in sheets.values():
        cols = set(df.columns)
        if "Grade" in cols and ({"Daily Rate", "Daily Cost"} & cols):
            return "rates", {"main": df}
    found = "; ".join(f"{n}: {', '.join(list(df.columns)[:8])}" for n, df in sheets.items())
    raise CleanError("columns not recognised as resource plan, quote line, position mapping "
                     f"or rates ({found})")


# ---------------------------------------------------------------- cleaning
def _excel_serial_to_date(series: pd.Series) -> pd.Series:
    numbers = pd.to_numeric(series, errors="coerce")
    dates = pd.to_datetime("1899-12-30") + pd.to_timedelta(numbers, unit="D")
    text_dates = pd.to_datetime(series.where(numbers.isna()), errors="coerce")
    return dates.fillna(text_dates).dt.normalize()


def _row_ids(df: pd.DataFrame, prefix: str) -> pd.Series:
    """Stable id per row: a hash of the row content plus its occurrence number."""
    content = df.astype(object).where(df.notna(), "").map(str).agg("|".join, axis=1)
    occurrence = content.groupby(content).cumcount().astype(str)
    return [f"{prefix}-" + hashlib.sha1(f"{c}#{o}".encode()).hexdigest()[:12]
            for c, o in zip(content, occurrence)]


def clean_plan_table(df: pd.DataFrame, dataset: str) -> tuple[pd.DataFrame, list[str]]:
    """Types and trims a resource plan or quote line table. Keeps the original columns."""
    warnings: list[str] = []
    df = df.copy()
    for col in TEXT_COLUMNS:
        if col in df.columns:
            df[col] = df[col].astype("string").str.strip().replace({"": pd.NA, "nan": pd.NA})
    df["Grade"] = pd.to_numeric(df["Grade"], errors="coerce").astype("Int64")
    if df["Grade"].isna().any():
        warnings.append(f"{int(df['Grade'].isna().sum())} rows have no numeric Grade")
    if "Work Order" in df.columns:
        df["Work Order"] = pd.to_numeric(df["Work Order"], errors="coerce").astype("Int64")

    months_present = [m for m in fiscal.FY_MONTHS if m in df.columns]
    missing = [m for m in fiscal.FY_MONTHS if m not in df.columns]
    if missing:
        warnings.append("month columns missing from the source: " + ", ".join(missing)
                        + " (shown as 'no data' in the forecast, not as zero; fix the export "
                        "query to include them)")
    for m in months_present:
        df[m] = pd.to_numeric(df[m], errors="coerce").astype("float64")
        negative = int((df[m] < 0).sum())
        if negative:
            warnings.append(f"{negative} negative values in {m} set to empty")
            df.loc[df[m] < 0, m] = float("nan")

    if "Created On" in df.columns:
        df["Created On"] = _excel_serial_to_date(df["Created On"])
    if "Modified Date" in df.columns:
        df["Modified Date"] = pd.to_datetime(df["Modified Date"], format="%m/%d/%Y %H:%M:%S",
                                             errors="coerce")

    bad_fy = df["Fiscal Year"].map(fiscal.fy_start_year).isna()
    if bad_fy.any():
        warnings.append(f"{int(bad_fy.sum())} rows dropped: Fiscal Year not like FY26")
        df = df.loc[~bad_fy]
    if "Status" in df.columns:
        inactive = df["Status"].fillna("").str.lower().ne("active")
        if inactive.any():
            warnings.append(f"{int(inactive.sum())} rows dropped: Status is not Active")
            df = df.loc[~inactive]

    df = df.reset_index(drop=True)
    df.insert(0, "_row_id", _row_ids(df, "RP" if dataset == "resource_plan" else "QL"))
    return df, warnings


def to_long(wide: pd.DataFrame, dataset: str, full_month_mds: float) -> pd.DataFrame:
    """One row per line per fiscal month that has a value."""
    months = [m for m in fiscal.FY_MONTHS if m in wide.columns]
    project_name = "Project Name" if dataset == "resource_plan" else "Name"
    keep = {
        "_row_id": "row_id", "Project ID": "project_id", "Quote Line Number": "quote_line",
        "Customer": "customer", project_name: "project_name", "Project Type": "project_type",
        "Resource": "resource", "Position Name": "position_name", "Grade": "grade",
        "Skill": "skill", "Fiscal Year": "fiscal_year", "Working City": "working_city",
    }
    base = wide[[c for c in keep if c in wide.columns] + months].rename(columns=keep)
    long = base.melt(id_vars=[keep[c] for c in keep if c in wide.columns],
                     value_vars=months, var_name="fy_month", value_name="mds")
    long = long.dropna(subset=["mds"])
    long["month"] = pd.to_datetime([fiscal.month_start(fy, m)
                                    for fy, m in zip(long["fiscal_year"], long["fy_month"])])
    long["fte"] = long["mds"] / full_month_mds
    long["source"] = "RP" if dataset == "resource_plan" else "QL"
    return long.sort_values(["row_id", "month"]).reset_index(drop=True)


def clean_rates(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    df = df.copy()
    df["Grade"] = pd.to_numeric(df["Grade"], errors="coerce").astype("Int64")
    for col in ("Daily Rate", "Daily Cost"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    warnings = []
    if df["Grade"].isna().any():
        warnings.append(f"{int(df['Grade'].isna().sum())} rate rows without a Grade dropped")
    return df.dropna(subset=["Grade"]).reset_index(drop=True), warnings


# ---------------------------------------------------------------- stage entry points
def run_file(cfg: Config, store: Store, key: str, data: bytes, ext: str) -> dict:
    """Cleans one validated upload and saves it as the latest version of its dataset."""
    sheets = read_any(data, ext)
    dataset, sheets = detect(sheets)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    prefix = f"clean/{dataset}/"
    quality: dict = {"dataset": dataset, "sourceKey": key, "cleanedAt": stamp, "warnings": []}

    if dataset in ("resource_plan", "quoteline"):
        raw = sheets["main"]
        wide, warnings = clean_plan_table(raw, dataset)
        mds = cfg.rp_full_month_mds if dataset == "resource_plan" else cfg.ql_full_month_mds
        long = to_long(wide, dataset, mds)
        missing_months = [m for m in fiscal.FY_MONTHS if m not in raw.columns]
        quality.update(rowsIn=len(raw), rowsOut=len(wide), monthRows=len(long), warnings=warnings,
                       missingMonths=missing_months,
                       fiscalYears=sorted(wide["Fiscal Year"].dropna().unique().tolist()),
                       nullCounts={c: int(v) for c, v in wide.isna().sum().items() if v})
        tables = {"latest_wide": wide, "latest_long": long}
    elif dataset == "position_mapping":
        tables = {f"sheet_{re.sub(r'[^A-Za-z0-9]+', '_', n).strip('_').lower()}": df.astype("string")
                  for n, df in sheets.items()}
        # Your matching script may want the workbook itself, so keep the original bytes too.
        store.write_bytes(prefix + "latest.xlsx", data,
                          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        quality.update(sheets=list(sheets), rowsOut={n: len(df) for n, df in sheets.items()})
    else:  # rates
        rates, warnings = clean_rates(sheets["main"])
        tables = {"latest": rates}
        quality.update(rowsOut=len(rates), warnings=warnings)

    for name, df in tables.items():
        store.write_table(f"{prefix}{name}.json.gz", df)
        store.write_table(f"{prefix}history/{stamp}/{name}.json.gz", df)
    store.write_json(f"{prefix}latest.quality.json", quality)
    store.write_json(f"{prefix}history/{stamp}/quality.json", quality)
    return quality


def load_latest(store: Store) -> dict:
    """Loads the latest clean version of every dataset for a full pipeline run."""
    out: dict = {}
    for dataset in ("resource_plan", "quoteline"):
        prefix = f"clean/{dataset}/"
        if not store.exists(prefix + "latest_wide.json.gz"):
            raise CleanError(f"no cleaned {dataset.replace('_', ' ')} yet; upload that file first")
        out[dataset] = {"wide": store.read_table(prefix + "latest_wide.json.gz"),
                        "long": store.read_table(prefix + "latest_long.json.gz"),
                        "quality": store.read_json(prefix + "latest.quality.json")}
    if store.exists("clean/position_mapping/latest.quality.json"):
        out["position_mapping"] = {
            "sheets": store.read_tables("clean/position_mapping/"),
            "xlsx": store.read_bytes("clean/position_mapping/latest.xlsx"),
            "quality": store.read_json("clean/position_mapping/latest.quality.json"),
        }
    if store.exists("clean/rates/latest.json.gz"):
        out["rates"] = {"table": store.read_table("clean/rates/latest.json.gz")}
    return out
