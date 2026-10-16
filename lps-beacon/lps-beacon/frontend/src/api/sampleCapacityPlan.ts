// src/api/sampleCapacityPlan.ts
// SYNTHETIC demo data for the capacity plan. Every number here is made up (invented headcount, rates and revenue)
// and is NOT taken from any real plan. It is only used when VITE_USE_SAMPLE_PLAN=true or VITE_USE_MOCK=true, so the dashboard and the
// Analysis tab can be previewed before the backend generates a real plan. Same shape as the real thing.

import { BANDS, MONTH_COLUMNS, isActualColumn, rowId } from "../analysis/capacityPlanLayout";
import type { CapacityPlan } from "./types";

// Band 9 down to band 3, in the same order as BANDS.
const START_HC = [2, 90, 250, 80, 50, 120, 120];
const JOIN_BASE = [0.3, 1.2, 1.5, 1.8, 2.2, 3, 3]; // average joiners per month
const LEAVE_BASE = [0.2, 1.5, 3, 1.2, 1.2, 1.2, 1.2]; // average leavers per month
const DAY_RATE = [1000, 650, 500, 380, 300, 240, 190];
const UR_ACTUAL = [0.7, 0.84, 0.9, 0.88, 0.89, 0.9, 0.91];
const UR_FORECAST = [0.7, 0.8, 0.85, 0.85, 0.86, 0.87, 0.87];
const WORKING_DAYS = [21, 20, 22, 22, 21, 22, 21, 22, 20, 21, 22, 19, 22, 20, 23, 21, 22, 21, 22, 21, 22, 20, 22, 21];

// A small repeatable pseudo-random generator, so the sample looks the same on every load.
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export function buildSampleCapacityPlan(): CapacityPlan {
  const rand = seeded(42);
  const values: CapacityPlan["values"] = {};
  const set = (id: string, key: string, v: number) => {
    (values[id] ??= {})[key] = v;
  };

  const previousEnd = [...START_HC];
  const costs: number[] = [];

  MONTH_COLUMNS.forEach((col, m) => {
    const actual = isActualColumn(col);
    const days = WORKING_DAYS[m];
    const total = { cur: 0, join: 0, leave: 0, end: 0, rev: 0, cost: 0, bill: 0 };

    BANDS.forEach((band, i) => {
      const cur = previousEnd[i];
      const join = Math.round(JOIN_BASE[i] * (0.4 + rand() * 1.2));
      const leave = Math.min(cur, Math.round(LEAVE_BASE[i] * (0.3 + rand() * 1.4)));
      const end = cur + join - leave;
      const ur = actual ? Math.min(1, UR_ACTUAL[i] + (rand() - 0.5) * 0.06) : UR_FORECAST[i];
      const billable = end * ur;
      const capacityRevenue = billable * DAY_RATE[i] * days; // same idea as the template's "Revenue per FTE ($)" rows
      const cost = end * DAY_RATE[i] * days;

      set(rowId("current-hc", band.id), col.key, cur);
      set(rowId("joiners", band.id), col.key, join);
      set(rowId("leavers", band.id), col.key, leave);
      set(rowId("ending-hc", band.id), col.key, end);
      set(rowId("revenue-per-fte", band.id), col.key, Math.round(capacityRevenue));
      set(rowId("resource-cost", band.id), col.key, Math.round(cost));
      set(rowId("billable-ur", band.id), col.key, ur);
      set(rowId("billable-hc", band.id), col.key, billable);
      set(rowId("non-billable-hc", band.id), col.key, end - billable);
      set(rowId("joiners-pct", band.id), col.key, cur ? join / cur : 0);
      set(rowId("leavers-pct", band.id), col.key, cur ? leave / cur : 0);

      previousEnd[i] = end;
      total.cur += cur;
      total.join += join;
      total.leave += leave;
      total.end += end;
      total.rev += capacityRevenue;
      total.cost += cost;
      total.bill += billable;
    });

    set("current-hc", col.key, total.cur);
    set("joiners", col.key, total.join);
    set("leavers", col.key, total.leave);
    set("ending-hc", col.key, total.end);
    set("revenue-per-fte", col.key, Math.round(total.rev));
    set("resource-cost", col.key, Math.round(total.cost));
    set("billable-ur", col.key, total.end ? total.bill / total.end : 0);
    set("billable-hc", col.key, total.bill);
    set("non-billable-hc", col.key, total.end - total.bill);
    set("working-days", col.key, days);
    set("joiners-pct", col.key, total.cur ? total.join / total.cur : 0);
    set("leavers-pct", col.key, total.cur ? total.leave / total.cur : 0);
    costs.push(total.cost);
  });

  // "Revenue ($)" is a flat figure entered by finance, so it is the same every month. Gross margin follows from it.
  const averageCost = costs.reduce((a, b) => a + b, 0) / costs.length;
  const revenue = Math.round((averageCost * 1.12) / 100000) * 100000;
  MONTH_COLUMNS.forEach((col, m) => {
    set("revenue", col.key, revenue);
    set("gross-margin", col.key, Math.round(revenue - costs[m]));
    set("gross-margin-pct", col.key, (revenue - costs[m]) / revenue);
  });

  const bandRates: CapacityPlan["bandRates"] = {};
  BANDS.forEach((band, i) => {
    bandRates[band.id] = { fy26: DAY_RATE[i], fy27: Math.round(DAY_RATE[i] * 1.03) };
  });

  return { values, bandRates };
}
