// src/dashboard/period.ts
// The Dashboard's time filter: the latest month with actual figures, or one fiscal quarter (Q1 = Apr-Jun).
// Gives the plan's column keys and "YYYY-MM" months the period covers, and its label for the header.

import type { CapacityPlan } from "../api/types";

export interface Period {
  id: string; // "latest" or a quarter column key like "Q3'26"
  label: string; // "Oct'26" or "Q3'26 (Oct–Dec 2026)"
  keys: string[]; // plan column keys, in order
  months: string[]; // the same months as "YYYY-MM"
  endKey: string; // the last month's column key (point-in-time figures such as headcount)
  totalKey: string; // the column holding the period's total (the month itself, or the quarter column)
}

const QUARTER_OF: Record<number, number> = { 4: 1, 5: 1, 6: 1, 7: 2, 8: 2, 9: 2, 10: 3, 11: 3, 12: 3, 1: 4, 2: 4, 3: 4 };
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function quarterKey(fiscalYear: string, month: string): string {
  return `Q${QUARTER_OF[Number(month.slice(5, 7))]}'${fiscalYear.slice(2)}`;
}

// The choices: the latest actual month, then every quarter of the fiscal year it falls in.
export function periodChoices(plan: CapacityPlan): Period[] {
  const months = plan.months ?? [];
  const latest = [...months].reverse().find((m) => m.actual) ?? months[0];
  if (!latest) return [];
  const out: Period[] = [
    { id: "latest", label: latest.key, keys: [latest.key], months: [latest.month], endKey: latest.key, totalKey: latest.key },
  ];
  const groups = new Map<string, typeof months>();
  for (const m of months.filter((x) => x.fiscalYear === latest.fiscalYear)) {
    const q = quarterKey(m.fiscalYear, m.month);
    groups.set(q, [...(groups.get(q) ?? []), m]);
  }
  for (const [q, ms] of groups) {
    const first = ms[0].month;
    const last = ms[ms.length - 1].month;
    const span = `${MONTH_SHORT[Number(first.slice(5, 7)) - 1]}–${MONTH_SHORT[Number(last.slice(5, 7)) - 1]} ${last.slice(0, 4)}`;
    const forecast = ms.some((m) => !m.actual);
    out.push({
      id: q,
      label: `${q} (${span}${forecast ? ", partly forecast" : ""})`,
      keys: ms.map((m) => m.key),
      months: ms.map((m) => m.month),
      endKey: ms[ms.length - 1].key,
      totalKey: q,
    });
  }
  return out;
}
