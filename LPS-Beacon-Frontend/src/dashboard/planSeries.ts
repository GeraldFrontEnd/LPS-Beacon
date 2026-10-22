// src/dashboard/planSeries.ts
// Turns the capacity plan into the monthly rows of numbers the charts need.

import { CURRENT_MONTH_INDEX, MONTH_COLUMNS, actualMonthKeys, isActualColumn } from "../analysis/capacityPlanLayout";
import type { CapacityPlan } from "../api/types";

export const MONTH_LABELS = MONTH_COLUMNS.map((c) => c.label);

// Index of the current month in MONTH_COLUMNS, or null when today is outside the plan.
export const CURRENT_MONTH: number | null =
  CURRENT_MONTH_INDEX >= 0 && CURRENT_MONTH_INDEX < MONTH_COLUMNS.length ? CURRENT_MONTH_INDEX : null;

// A short note per month for the chart tooltips. Actual months are the ones the plan has actual figures for.
export function monthNotes(plan: CapacityPlan | null): string[] {
  const actual = actualMonthKeys(plan);
  return MONTH_COLUMNS.map((c, i) =>
    isActualColumn(c, actual) ? "Actual" : i === CURRENT_MONTH ? "Current month (forecast)" : "Forecast"
  );
}

// One flag per month: true when the plan has actual figures for it.
export function actualMask(plan: CapacityPlan | null): boolean[] {
  const actual = actualMonthKeys(plan);
  return MONTH_COLUMNS.map((c) => isActualColumn(c, actual));
}

// Index of the first forecast month. Charts shade everything from here on. Undefined if there is none.
export function forecastFrom(plan: CapacityPlan | null): number | undefined {
  const actual = actualMonthKeys(plan);
  const i = MONTH_COLUMNS.findIndex((c) => !isActualColumn(c, actual));
  return i < 0 ? undefined : i;
}

// One value per month for a row of the plan (null where the plan has no value).
export function monthSeries(plan: CapacityPlan, id: string): (number | null)[] {
  return MONTH_COLUMNS.map((c) => plan.values[id]?.[c.key] ?? null);
}
