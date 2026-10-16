// src/analysis/formatPlanValue.ts
// Turns plan numbers into text for the table, and typed text back into plan numbers for the edit boxes.
// The plan itself always holds plain values: dollars (not millions) and percentages as fractions (0.85 = 85%).

import type { ValueFormat } from "./capacityPlanLayout";

const intFmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const dec1Fmt = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const millionsFmt = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function isMissing(value: number | null | undefined): value is null | undefined {
  return value === null || value === undefined || Number.isNaN(value);
}

// The text shown in a table cell. A missing value is shown as an empty cell.
export function formatPlanValue(value: number | null | undefined, format: ValueFormat): string {
  if (isMissing(value)) return "";
  switch (format) {
    case "int":
      return intFmt.format(value);
    case "dec1":
      return dec1Fmt.format(value);
    case "usdM":
      return millionsFmt.format(value / 1_000_000);
    case "pct0":
      return `${intFmt.format(value * 100)}%`;
    case "pct1":
      return `${dec1Fmt.format(value * 100)}%`;
  }
}

// The text put into an edit box: the same unit as the screen (millions, percent) but without symbols or grouping.
export function toInputText(value: number | null | undefined, format: ValueFormat): string {
  if (isMissing(value)) return "";
  switch (format) {
    case "usdM":
      return String(Number((value / 1_000_000).toFixed(6)));
    case "pct0":
    case "pct1":
      return String(Number((value * 100).toFixed(4)));
    default:
      return String(Number(value.toFixed(4)));
  }
}

// Reads what a person typed. Returns the plan value (dollars, or a fraction for percentages), or null if the text
// is not acceptable: empty, not a number, negative, a decimal where a whole number is needed, or above the limit.
export function parseInputText(text: string, format: ValueFormat, max?: number): number | null {
  const cleaned = text.replace(/[,\s%]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  switch (format) {
    case "int":
      if (!Number.isInteger(n)) return null;
      return max !== undefined && n > max ? null : n;
    case "dec1":
      return n;
    case "usdM":
      return Math.round(n * 1_000_000);
    case "pct0":
    case "pct1":
      return n > 100 ? null : n / 100;
  }
}
