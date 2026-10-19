// src/analysis/capacityPlanLayout.ts
// The SHAPE of the capacity plan: which columns (months, quarters, financial years) and which rows (metrics and bands)
// it has, and which cells a person may edit. It mirrors Capacity_Plan_template.xlsx and holds no numbers.
// The numbers come from the backend (see getCapacityPlan in src/api/client.ts) and are looked up by the ids defined here.

// How a number is shown on screen. "usdM" means dollars shown in millions (1,000,000 is shown as 1.00).
export type ValueFormat = "int" | "dec1" | "usdM" | "pct0" | "pct1";

// One column of the plan. "key" is the id the backend uses for this column, for example "Apr'26" or "Q1'26".
export interface PlanColumn {
  key: string;
  label: string;
  // A month, a quarter (Q1'26) or a whole financial year (FY'26). Quarters and the year are totals of the months.
  kind: "month" | "quarter" | "fy";
  // The financial year the column belongs to. FY'26 runs from Apr'26 to Mar'27.
  fiscalYear: string;
  // 1 to 4. For a month it is the quarter the month is in; for a quarter column it is the quarter itself.
  quarter?: number;
}

// One metric (for example "Joiners"). If "bands" is true it also has one row per band underneath it.
export interface PlanSection {
  id: string;
  label: string;
  format: ValueFormat; // format of the metric's own (total) row
  bands: boolean;
  bandFormat?: ValueFormat; // format of the band rows; defaults to "format"
}

// ---- Columns ----

// The financial year starts in April.
const MONTH_NAMES = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];

// The calendar year the plan's first financial year (FY'26) starts in.
const FIRST_YEAR = 2026;

// The 12 months of one financial year, followed by its four quarters and the year total.
function fiscalYearColumns(startYear: number): PlanColumn[] {
  const yy = (year: number) => String(year).slice(2);
  const fiscalYear = `FY'${yy(startYear)}`;

  const months = MONTH_NAMES.map((name, i): PlanColumn => {
    const label = `${name}'${yy(startYear + (i >= 9 ? 1 : 0))}`; // Jan to Mar fall in the next calendar year
    return { key: label, label, kind: "month", fiscalYear, quarter: Math.floor(i / 3) + 1 };
  });
  const quarters = [1, 2, 3, 4].map((q): PlanColumn => {
    const label = `Q${q}'${yy(startYear)}`;
    return { key: label, label, kind: "quarter", fiscalYear, quarter: q };
  });
  const year: PlanColumn = { key: fiscalYear, label: fiscalYear, kind: "fy", fiscalYear };

  return [...months, ...quarters, year];
}

// FY'26 (Apr'26 to Mar'27) and FY'27 (Apr'27 to Mar'28). The template has no quarter or year columns for FY'27.
export const PLAN_COLUMNS: PlanColumn[] = [...fiscalYearColumns(FIRST_YEAR), ...fiscalYearColumns(FIRST_YEAR + 1)];

export const FISCAL_YEARS: string[] = [...new Set(PLAN_COLUMNS.map((c) => c.fiscalYear))];

// Only the months, in order. This is the time axis of the dashboard charts.
export const MONTH_COLUMNS: PlanColumn[] = PLAN_COLUMNS.filter((c) => c.kind === "month");

// Where a date falls among MONTH_COLUMNS: -1 if before the plan starts, MONTH_COLUMNS.length if after it ends.
function monthIndexFor(date: Date): number {
  const i = (date.getFullYear() - FIRST_YEAR) * 12 + date.getMonth() - 3; // months since April of the first year
  return Math.max(-1, Math.min(MONTH_COLUMNS.length, i));
}

// The month we are in now, read from the computer's clock when the page loads, so it moves on by itself every month.
export const CURRENT_MONTH_INDEX = monthIndexFor(new Date());

// True for months that are over (before the current month). The current month and every later month are forecasts.
export function isActualColumn(column: PlanColumn): boolean {
  const i = MONTH_COLUMNS.indexOf(column);
  return i >= 0 && i < CURRENT_MONTH_INDEX;
}

// ---- Rows ----

// The bands, highest first, as in the template. The id is used inside row ids, the label is shown on screen.
export const BANDS = [
  { id: "b9", label: "Band 9" },
  { id: "b8", label: "Band 8" },
  { id: "b7", label: "Band 7" },
  { id: "b6", label: "Band 6" },
  { id: "b5", label: "Band 5" },
  { id: "b4", label: "Band 4" },
  { id: "b3", label: "Band 3" },
] as const;

export const PLAN_SECTIONS: PlanSection[] = [
  { id: "current-hc", label: "Current HC", format: "int", bands: true },
  { id: "joiners", label: "Joiners", format: "int", bands: true },
  { id: "leavers", label: "Leavers", format: "int", bands: true },
  { id: "ending-hc", label: "Ending HC", format: "int", bands: true },
  { id: "revenue-per-fte", label: "Revenue per FTE ($ in M)", format: "usdM", bands: true },
  { id: "revenue", label: "Revenue ($ in M)", format: "usdM", bands: false },
  { id: "resource-cost", label: "Resource Cost ($ in M)", format: "usdM", bands: true },
  { id: "gross-margin", label: "Gross Margin ($ in M)", format: "usdM", bands: false },
  { id: "gross-margin-pct", label: "Gross Margin %", format: "pct1", bands: false },
  { id: "billable-ur", label: "Billable UR %", format: "pct1", bands: true, bandFormat: "pct0" },
  { id: "billable-hc", label: "Billable HC", format: "dec1", bands: true },
  { id: "non-billable-hc", label: "Non-Billable HC", format: "dec1", bands: true },
  { id: "working-days", label: "Standard Working days (Current month)", format: "int", bands: false },
  { id: "joiners-pct", label: "Joiners %", format: "pct1", bands: true },
  { id: "leavers-pct", label: "Leavers %", format: "pct1", bands: true },
];

// The id the backend uses for a row's values: the section id, or "<section id>:<band id>" for a band row.
export function rowId(sectionId: string, bandId?: string): string {
  return bandId ? `${sectionId}:${bandId}` : sectionId;
}

// ---- Editing ----

const FIRST_MONTH_KEY = MONTH_COLUMNS[0].key;

// Which cells hold an INPUT (typed in by a person or read from a report) and not a formula.
// This follows Capacity_Plan_template.xlsx, where these are the only cells that are plain numbers:
//  - Joiners, Leavers and Billable UR % for each band, in every month
//  - Current HC for each band, in the first month only (the starting headcount; later months are formulas)
//  - Revenue ($) and Standard Working days, in every month
// The total rows of Joiners, Leavers and Billable UR % are not editable: they are sums or ratios of the band rows.
// (In the template the Billable UR % total row is a typed number, but nothing depends on it, so editing it would
// quietly disagree with the bands.)
export function isEditableCell(sectionId: string, bandId: string | undefined, column: PlanColumn): boolean {
  if (column.kind !== "month") return false; // quarters and years are always formulas
  if (!bandId) return sectionId === "revenue" || sectionId === "working-days";
  if (sectionId === "joiners" || sectionId === "leavers" || sectionId === "billable-ur") return true;
  return sectionId === "current-hc" && column.key === FIRST_MONTH_KEY;
}

// The largest value a person may type into an editable row, where there is a natural limit.
export function maxFor(sectionId: string): number | undefined {
  return sectionId === "working-days" ? 31 : undefined;
}
