"""Stage 2: clean one uploaded file and save it under clean/.

What it recognises (by its columns, not its file name):
  resource_plan     Project Resource Plan export (has "Project Owner", months May..Mar)
  quoteline         Quote Line export (has "Name" and months Apr..Mar)
  position_mapping  workbook with a sheet holding "Position Name" + "Standard Role"
  rates             optional finance table: "Grade" plus "Daily Rate" and/or "Daily Cost"
                    (optionally "Standard Role" for role-specific rates)
  sl_rp             Service Line x Resource Plan export (has "Demand Type", "ID", "Calendar Date",
                    "MD"): demand per project / quote and person per month. Used by the review flow
                    to find the resources a pipeline opportunity needs (pipeline/opportunities.py)
  sfdc_pipeline     YTD Pipeline export from SFDC (has "CRM ID", "Stage", "TCV (converted)"; the
                    header is a few rows down, under the report title)
  abcd              ABCD cost report (has "Project_ID", "SFDC_ID", "TCVBefore_Tax_USD_Currency_Contract"):
                    past projects, used to find a similar project for an opportunity

Resource plan and quote line exports that were edited by hand can lose the columns that tell
them apart ("Project Owner" in the resource plan, "Name" and "Apr" in the quote line). When a
file has the plan columns but not those, its file name decides: a name containing "quote" or
"QL" is a quote line, one containing "resource plan" or "RP" is a resource plan.

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

DATASETS = ("resource_plan", "quoteline", "position_mapping", "rates", "sl_rp", "sfdc_pipeline", "abcd")

PLAN_MINIMUM = {"Project ID", "Quote Line Number", "Resource", "Grade", "Position Name", "Fiscal Year"}
SL_RP_REQUIRED = {"Demand Type", "ID", "Calendar Date", "MD", "Grade", "Position Name"}
SFDC_REQUIRED = {"CRM ID", "Stage", "TCV (converted)"}
ABCD_REQUIRED = {"Project_ID", "Project_Name", "TCVBefore_Tax_USD_Currency_Contract"}
HEADER_SEARCH_ROWS = 30     # report exports put a title block above the real header

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
        named = [c for c in df.columns if c and not c.startswith("Unnamed:")]
        # A report with a title block above its header has almost no named columns in row 1; keep them
        # all so detect() can find the real header further down.
        if len(named) >= 3:
            df = df.loc[:, named]
        out[name] = df.dropna(how="all")
    return out


def _header_lower_down(df: pd.DataFrame, required: set[str]) -> pd.DataFrame | None:
    """A report with a title block: finds the row holding the real header and re-frames the sheet."""
    grid = pd.concat([pd.DataFrame([list(df.columns)], columns=df.columns), df.head(HEADER_SEARCH_ROWS)])
    for i, row in enumerate(grid.itertuples(index=False)):
        names = [_norm_header(v) if v is not None and str(v) != "nan" else "" for v in row]
        if required <= set(names):
            body = df.iloc[i:].copy()          # grid row i is df row i-1, so data starts at df row i
            body.columns = names
            body = body.loc[:, [c for c in body.columns if c and not c.startswith("Unnamed:")]]
            return body.dropna(how="all").reset_index(drop=True)
    return None


def _name_hint(source_name: str) -> str | None:
    """'resource_plan' / 'quoteline' from a file name, or None."""
    name = re.sub(r"[^a-z]+", " ", source_name.lower())
    if "quote" in name or re.search(r"\bql\b", name):
        return "quoteline"
    if "resource plan" in name or re.search(r"\brp\b", name):
        return "resource_plan"
    return None


def detect(sheets: dict[str, pd.DataFrame], source_name: str = "") -> tuple[str, dict[str, pd.DataFrame]]:
    """Works out which dataset a file holds. Returns (dataset, sheets to keep)."""
    for df in sheets.values():
        cols = set(df.columns)
        if RP_REQUIRED <= cols:
            return "resource_plan", {"main": df}
        if QL_REQUIRED <= cols and "Project Owner" not in cols and "Apr" in cols:
            return "quoteline", {"main": df}
    for df in sheets.values():
        cols = set(df.columns)
        if SL_RP_REQUIRED <= cols:
            return "sl_rp", {"main": df}
        if ABCD_REQUIRED <= cols:
            return "abcd", {"main": df}
        if SFDC_REQUIRED <= cols:
            return "sfdc_pipeline", {"main": df}
        found = _header_lower_down(df, SFDC_REQUIRED)
        if found is not None:
            return "sfdc_pipeline", {"main": found}
    mapping = {n: df for n, df in sheets.items() if {"Position Name", "Standard Role"} <= set(df.columns)}
    if mapping:
        return "position_mapping", sheets
    for df in sheets.values():
        cols = set(df.columns)
        if "Grade" in cols and ({"Daily Rate", "Daily Cost"} & cols):
            return "rates", {"main": df}
    hint = _name_hint(source_name)
    for df in sheets.values():
        if hint and PLAN_MINIMUM <= set(df.columns):
            return hint, {"main": df}
    def heading(df):
        named = [str(c) for c in df.columns if not str(c).startswith("Unnamed:")][:8]
        return ", ".join(named) if named else "no column headings in the first row"
    found = "; ".join(f"{n}: {heading(df)}" for n, df in sheets.items())
    raise CleanError("columns not recognised as resource plan, quote line, position mapping, rates, "
                     f"SL x RP, SFDC pipeline or ABCD ({found})")


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
    project_name = "Project Name" if dataset == "resource_plan" or "Name" not in wide.columns else "Name"
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


def _text(series: pd.Series) -> pd.Series:
    return series.astype("string").str.strip().replace({"": pd.NA, "nan": pd.NA, "None": pd.NA})


def _dates(series: pd.Series, dayfirst: bool = False) -> pd.Series:
    """Excel serials, real dates or text dates -> dates (NaT when unreadable)."""
    if pd.api.types.is_datetime64_any_dtype(series):
        return series.dt.normalize()
    numbers = pd.to_numeric(series, errors="coerce")
    serial = pd.to_datetime("1899-12-30") + pd.to_timedelta(numbers.where(numbers.between(1, 80000)), unit="D")
    parsed = pd.to_datetime(series.where(numbers.isna()).astype("string"), errors="coerce", dayfirst=dayfirst)
    return serial.fillna(parsed).dt.normalize()


SL_RP_KEEP = ["Demand Type", "ID", "Name", "Customer", "CRM ID", "Planned Start Date", "Planned End Date",
              "Resource", "IT Code", "Grade", "Skill", "Position Name", "Working City", "Calendar Date", "MD"]


def clean_sl_rp(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    """Keeps the columns the review flow needs. Pre Sales and Internal rows stay here; they are left
    out where the resources are read (pipeline/opportunities.py), so the file stays a faithful copy."""
    warnings: list[str] = []
    out = df.reindex(columns=SL_RP_KEEP).copy()
    for col in ("Demand Type", "ID", "Name", "Customer", "CRM ID", "Resource", "IT Code", "Skill",
                "Position Name", "Working City"):
        out[col] = _text(out[col])
    out["Grade"] = pd.to_numeric(out["Grade"], errors="coerce").astype("Int64")
    out["MD"] = pd.to_numeric(out["MD"], errors="coerce").astype("float64")
    for col in ("Calendar Date", "Planned Start Date", "Planned End Date"):
        out[col] = _dates(out[col])
    footer = out["Calendar Date"].isna() & out["ID"].isna()      # e.g. an "Applied filters" line at the end
    if footer.any():
        out = out.loc[~footer]
    no_month = int(out["Calendar Date"].isna().sum())
    if no_month:
        warnings.append(f"{no_month} rows without a Calendar Date dropped")
        out = out.dropna(subset=["Calendar Date"])
    out = out.reset_index(drop=True)
    out.insert(0, "_row", out.index + 2)                       # the row number in the uploaded sheet (approx.)
    return out, warnings


def clean_sfdc(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    """One row per opportunity, plus the first and last month with forecast revenue."""
    warnings: list[str] = []
    month_cols = [c for c in df.columns if re.match(r"^\d{2}/ ?\d{4}", str(c))]
    keep = ["CRM ID", "Opportunity Name (English)", "End Customer", "Billing Customer", "Stage",
            "Probability (%)", "TCV (converted)", "EBITDA%", "Expected Closed Date", "Major Solution Offering",
            "GTM Unit", "Region", "Type"]
    out = df.reindex(columns=keep).copy()
    for col in ("CRM ID", "Opportunity Name (English)", "End Customer", "Billing Customer", "Stage",
                "Major Solution Offering", "GTM Unit", "Region", "Type"):
        out[col] = _text(out[col])
    for col in ("Probability (%)", "TCV (converted)", "EBITDA%"):
        out[col] = pd.to_numeric(out[col], errors="coerce").astype("float64")
    out["Expected Closed Date"] = _dates(out["Expected Closed Date"], dayfirst=True)
    revenue = df[month_cols].apply(pd.to_numeric, errors="coerce").fillna(0) if month_cols else None
    months = [pd.Timestamp(int(re.match(r"^(\d{2})/ ?(\d{4})", c).group(2)),
                           int(re.match(r"^(\d{2})/ ?(\d{4})", c).group(1)), 1) for c in month_cols]
    first, last = [], []
    for i in range(len(out)):
        nonzero = [m for m, v in zip(months, revenue.iloc[i]) if v != 0] if revenue is not None else []
        first.append(min(nonzero) if nonzero else pd.NaT)
        last.append(max(nonzero) if nonzero else pd.NaT)
    out["Revenue From"], out["Revenue To"] = first, last
    out["Revenue From"] = pd.to_datetime(out["Revenue From"])
    out["Revenue To"] = pd.to_datetime(out["Revenue To"])
    missing = out["CRM ID"].isna()
    if missing.any():
        out = out.loc[~missing]
    if not month_cols:
        warnings.append("no monthly revenue columns (like '04/ 2026 (converted)'); start and end months unknown")
    return out.reset_index(drop=True), warnings


ABCD_KEEP = {"Project_ID": "Project_ID", "Project_Name": "Project_Name", "SFDC_ID": "SFDC_ID",
             "End_Customer": "End_Customer", "Customer": "Customer", "Delivery_Region": "Delivery_Region",
             "Service_Line": "Service_Line", "Solution_Offering": "Solution_Offering",
             "Project_Type": "Project_Type", "TCVBefore_Tax_USD_Currency_Contract": "TCV_USD",
             "Planned_Start": "Planned_Start", "Planned_End_Date": "Planned_End_Date",
             "Project_Duration_Months": "Duration_Months"}


def clean_abcd(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    out = df.reindex(columns=list(ABCD_KEEP)).rename(columns=ABCD_KEEP).copy()
    for col in ("Project_ID", "Project_Name", "SFDC_ID", "End_Customer", "Customer", "Delivery_Region",
                "Service_Line", "Solution_Offering", "Project_Type"):
        out[col] = _text(out[col])
    out["TCV_USD"] = pd.to_numeric(out["TCV_USD"], errors="coerce").astype("float64")
    out["Duration_Months"] = pd.to_numeric(out["Duration_Months"], errors="coerce").astype("float64")
    for col in ("Planned_Start", "Planned_End_Date"):
        out[col] = _dates(out[col])
    out = out.dropna(subset=["Project_ID"]).drop_duplicates(subset=["Project_ID"]).reset_index(drop=True)
    return out, []


# ---------------------------------------------------------------- stage entry points
def run_file(cfg: Config, store: Store, key: str, data: bytes, ext: str) -> dict:
    """Cleans one validated upload and saves it as the latest version of its dataset."""
    sheets = read_any(data, ext)
    dataset, sheets = detect(sheets, key.rsplit("/", 1)[-1])
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
    elif dataset in ("sl_rp", "sfdc_pipeline", "abcd"):
        cleaner = {"sl_rp": clean_sl_rp, "sfdc_pipeline": clean_sfdc, "abcd": clean_abcd}[dataset]
        table, warnings = cleaner(sheets["main"])
        tables = {"latest": table}
        quality.update(rowsIn=len(sheets["main"]), rowsOut=len(table), warnings=warnings)
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
