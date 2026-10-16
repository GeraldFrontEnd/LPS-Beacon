// src/analysis/capacityPlanLayout.ts
// The SHAPE of the capacity plan: which columns (months, quarters, FY) and which rows (metrics and bands) it has.
// It mirrors Capacity_Plan_template.xlsx. It holds no numbers. The numbers come from the backend later
// (see getCapacityPlan in src/api/client.ts) and are looked up by the ids defined here.

// How a number is shown on screen.
export type ValueFormat = "int" | "dec1" | "usd" | "pct0" | "pct1";

// One column of the plan. "key" is the id the backend will use for this column, for example "Apr'26".
export interface PlanColumn {
  key: string;
  label: string;
  // The text shown above the column in the first header row. Neighbouring columns with the same group are merged.
  group: string;
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

const ACTUAL = "Actual";
const OPEN_HIRING = "Actual + Open Hiring Requests";
const QL_RP = "Actual + Open Hiring Requests + QL RP";
const ASSUMED = "Actual + Open Hiring Requests + QL RP + Assumed (Opp Pipeline)";
const FORMULA = "Formula";

function cols(labels: string[], group: string): PlanColumn[] {
  return labels.map((label) => ({ key: label, label, group }));
}

export const PLAN_COLUMNS: PlanColumn[] = [
  ...cols(["Apr'26", "May'26", "Jun'26", "Jul'26", "Aug'26"], ACTUAL),
  ...cols(["Sep'26", "Oct'26", "Nov'26"], OPEN_HIRING),
  ...cols(["Dec'26"], QL_RP),
  ...cols(["Jan'27", "Feb'27", "Mar'27"], ASSUMED),
  ...cols(["Q1'26", "Q2'26", "Q3'26", "Q4'26", "FY'26"], FORMULA),
  // The template only labels Apr'27 to Jun'27. Jul'27 to Mar'28 are assumed to belong to the same group.
  ...cols(
    ["Apr'27", "May'27", "Jun'27", "Jul'27", "Aug'27", "Sep'27", "Oct'27", "Nov'27", "Dec'27", "Jan'28", "Feb'28", "Mar'28"],
    ASSUMED
  ),
];

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
  { id: "revenue-per-fte", label: "Revenue per FTE ($)", format: "usd", bands: true },
  { id: "revenue", label: "Revenue ($)", format: "usd", bands: false },
  { id: "resource-cost", label: "Resource Cost ($)", format: "usd", bands: true },
  { id: "gross-margin", label: "Gross Margin ($)", format: "usd", bands: false },
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
