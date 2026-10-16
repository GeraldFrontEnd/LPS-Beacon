// src/dashboard/planSeries.ts
// Turns the capacity plan into the monthly rows of numbers the charts need.

import { MONTH_COLUMNS, isActualColumn } from "../analysis/capacityPlanLayout";
import type { CapacityPlan } from "../api/types";

export const MONTH_LABELS = MONTH_COLUMNS.map((c) => c.label);

// A short note per month for the chart tooltips.
export const MONTH_NOTES = MONTH_COLUMNS.map((c) => (isActualColumn(c) ? "Actual" : "Forecast"));

// Index of the first forecast month. Charts shade everything from here on. Undefined if there is none.
export const FORECAST_FROM: number | undefined = (() => {
  const i = MONTH_COLUMNS.findIndex((c) => !isActualColumn(c));
  return i < 0 ? undefined : i;
})();

// One value per month for a row of the plan (null where the plan has no value).
export function monthSeries(plan: CapacityPlan, id: string): (number | null)[] {
  return MONTH_COLUMNS.map((c) => plan.values[id]?.[c.key] ?? null);
}
