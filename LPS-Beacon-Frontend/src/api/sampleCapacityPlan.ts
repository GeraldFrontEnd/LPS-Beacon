// src/api/sampleCapacityPlan.ts
// SYNTHETIC demo data for the capacity plan. Every number here is made up (invented headcount, rates and revenue)
// and is NOT taken from any real plan. It is only used when VITE_USE_SAMPLE_PLAN=true or VITE_USE_MOCK=true, so the
// dashboard and the Analysis tab can be previewed before the backend generates a real plan. Same shape as the real thing.
//
// It also plays the part of the backend when someone edits a cell: the edits are passed in, and every formula row
// (ending headcount, revenue, cost, margin, quarter and year totals, ...) is worked out again from them.

import { BANDS, MONTH_COLUMNS, PLAN_COLUMNS, PLAN_SECTIONS, isActualColumn, rowId } from "../analysis/capacityPlanLayout";
import type { CapacityPlan } from "./types";

// Band 9 down to band 3, in the same order as BANDS.
const START_HC = [2, 90, 250, 80, 50, 120, 120];
const JOIN_BASE = [0.3, 1.2, 1.5, 1.8, 2.2, 3, 3]; // average joiners per month
const LEAVE_BASE = [0.2, 1.5, 3, 1.2, 1.2, 1.2, 1.2]; // average leavers per month
const DAY_RATE = [1000, 650, 500, 380, 300, 240, 190];
const UR_ACTUAL = [0.7, 0.84, 0.9, 0.88, 0.89, 0.9, 0.91];
const UR_FORECAST = [0.7, 0.8, 0.85, 0.85, 0.86, 0.87, 0.87];
const WORKING_DAYS = [21, 20, 22, 22, 21, 22, 21, 22, 20, 21, 22, 19, 22, 20, 23, 21, 22, 21, 22, 21, 22, 20, 22, 21];

// How the quarter and year columns are worked out from the months.
const AVERAGED = new Set(["current-hc", "ending-hc", "billable-hc", "non-billable-hc"]); // headcount: average
const SUMMED = new Set(["joiners", "leavers", "revenue-per-fte", "revenue", "resource-cost", "gross-margin", "working-days"]);

// The key under which an edited cell is remembered: "<row id>|<column key>", for example "joiners:b7|Oct'26".
export function sampleEditKey(rid: string, columnKey: string): string {
  return `${rid}|${columnKey}`;
}

// A small repeatable pseudo-random generator, so the sample looks the same on every load.
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function build(edits: Record<string, number>, revenueDefault: number): CapacityPlan {
  const rand = seeded(42);
  const values: CapacityPlan["values"] = {};
  const set = (id: string, key: string, v: number) => {
    (values[id] ??= {})[key] = v;
  };
  const edited = (rid: string, key: string) => edits[sampleEditKey(rid, key)];

  const previousEnd = [...START_HC];
  const costs: number[] = [];

  MONTH_COLUMNS.forEach((col, m) => {
    const actual = isActualColumn(col);
    const days = edited("working-days", col.key) ?? WORKING_DAYS[m];
    const total = { cur: 0, join: 0, leave: 0, end: 0, rev: 0, cost: 0, bill: 0 };

    BANDS.forEach((band, i) => {
      // Always draw the same three random numbers, so one edit never changes the look of any other cell.
      const rJoin = rand();
      const rLeave = rand();
      const rUr = rand();

      const cur = m === 0 ? edited(rowId("current-hc", band.id), col.key) ?? START_HC[i] : previousEnd[i];
      const join = edited(rowId("joiners", band.id), col.key) ?? Math.round(JOIN_BASE[i] * (0.4 + rJoin * 1.2));
      const leave = Math.min(cur, edited(rowId("leavers", band.id), col.key) ?? Math.round(LEAVE_BASE[i] * (0.3 + rLeave * 1.4)));
      const end = cur + join - leave;
      const ur = edited(rowId("billable-ur", band.id), col.key) ?? (actual ? Math.min(1, UR_ACTUAL[i] + (rUr - 0.5) * 0.06) : UR_FORECAST[i]);
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

  // "Revenue ($)" is a figure entered by finance, flat unless someone edits a month. Gross margin follows from it.
  MONTH_COLUMNS.forEach((col, m) => {
    const revenue = edited("revenue", col.key) ?? revenueDefault;
    set("revenue", col.key, revenue);
    set("gross-margin", col.key, Math.round(revenue - costs[m]));
    set("gross-margin-pct", col.key, revenue ? (revenue - costs[m]) / revenue : 0);
  });

  // Quarter and year columns, worked out from the months of that quarter or year.
  PLAN_COLUMNS.filter((c) => c.kind !== "month").forEach((ac) => {
    const months = MONTH_COLUMNS.filter((c) => c.fiscalYear === ac.fiscalYear && (ac.kind === "fy" || c.quarter === ac.quarter));
    const sum = (id: string) => months.reduce((s, c) => s + (values[id]?.[c.key] ?? 0), 0);
    const avg = (id: string) => sum(id) / months.length;

    for (const section of PLAN_SECTIONS) {
      const ids = [section.id, ...(section.bands ? BANDS.map((b) => rowId(section.id, b.id)) : [])];
      for (const rid of ids) {
        const suffix = rid.slice(section.id.length); // "" for a total row, ":b9" for a band row
        let v: number;
        if (AVERAGED.has(section.id)) v = avg(rid);
        else if (SUMMED.has(section.id)) v = sum(rid);
        else if (section.id === "gross-margin-pct") v = sum("revenue") ? sum("gross-margin") / sum("revenue") : 0;
        else if (section.id === "billable-ur") v = avg(`ending-hc${suffix}`) ? avg(`billable-hc${suffix}`) / avg(`ending-hc${suffix}`) : 0;
        else {
          const flow = section.id === "joiners-pct" ? "joiners" : "leavers";
          v = avg(`current-hc${suffix}`) ? sum(`${flow}${suffix}`) / avg(`current-hc${suffix}`) : 0;
        }
        set(rid, ac.key, v);
      }
    }
  });

  return { values };
}

// Builds the sample plan. "edits" are the cells people have changed (see sampleEditKey); everything else is recalculated.
export function buildSampleCapacityPlan(edits: Record<string, number> = {}): CapacityPlan {
  // The default revenue is set from the plan as generated without edits, so editing joiners never moves it.
  const baseline = build({}, 0);
  const baselineCosts = MONTH_COLUMNS.map((c) => baseline.values["resource-cost"]?.[c.key] ?? 0);
  const averageCost = baselineCosts.reduce((a, b) => a + b, 0) / baselineCosts.length;
  const revenueDefault = Math.round((averageCost * 1.12) / 100000) * 100000;
  return build(edits, revenueDefault);
}
