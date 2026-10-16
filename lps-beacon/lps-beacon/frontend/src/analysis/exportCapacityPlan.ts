// src/analysis/exportCapacityPlan.ts
// Turns the capacity plan into a CSV file the user can open in Excel. It always contains every column
// (all months, quarters and years) and every row, whatever is expanded or collapsed on screen.

import { BANDS, PLAN_COLUMNS, PLAN_SECTIONS, rowId } from "./capacityPlanLayout";
import type { ValueFormat } from "./capacityPlanLayout";
import type { CapacityPlan } from "../api/types";

// Same units as the screen: dollars in millions, percentages as numbers out of 100. Full precision, no symbols.
function csvNumber(value: number | null | undefined, format: ValueFormat): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  switch (format) {
    case "usdM":
      return String(value / 1_000_000);
    case "pct0":
    case "pct1":
      return String(value * 100);
    default:
      return String(value);
  }
}

function csvText(text: string): string {
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function capacityPlanToCsv(plan: CapacityPlan): string {
  const lines: string[] = [["Metric", ...PLAN_COLUMNS.map((c) => c.label)].map(csvText).join(",")];

  for (const section of PLAN_SECTIONS) {
    const rows = [
      { id: rowId(section.id), label: section.label, format: section.format },
      ...(section.bands
        ? BANDS.map((b) => ({
            id: rowId(section.id, b.id),
            label: `${section.label} - ${b.label}`,
            format: section.bandFormat ?? section.format,
          }))
        : []),
    ];
    for (const row of rows) {
      lines.push([csvText(row.label), ...PLAN_COLUMNS.map((c) => csvNumber(plan.values[row.id]?.[c.key], row.format))].join(","));
    }
  }
  return lines.join("\r\n");
}

// Saves the plan as "capacity-plan-YYYY-MM-DD.csv" through the browser's normal download.
export function downloadCapacityPlan(plan: CapacityPlan): void {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const fileName = `capacity-plan-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.csv`;

  // The leading BOM makes Excel read the file as UTF-8.
  const blob = new Blob(["\uFEFF" + capacityPlanToCsv(plan)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
