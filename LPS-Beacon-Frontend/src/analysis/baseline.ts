// src/analysis/baseline.ts
// The organisation's productivity baseline, worked out from the capacity plan, for the Analysis page and the
// Dashboard: Revenue per HC, GP per HC and Revenue per $ of HC cost, this fiscal year to date (annualised) and last
// fiscal year. GP is revenue minus HC cost at the rate card (iRate).

import type { CapacityPlan } from "../api/types";

// The fiscal year's months that have actual figures, with the plan's column keys.
export function ytdColumns(plan: CapacityPlan, fy: string) {
  return (plan.months ?? []).filter((m) => m.fiscalYear === fy && m.actual);
}

export interface Baseline {
  revenuePerHc: number | null;
  gpPerHc: number | null;
  revenuePerHcCost: number | null;
  revenue: number;
  headcount: number;
}

export function thisYearBaseline(plan: CapacityPlan, fy: string): (Baseline & { months: string[] }) | null {
  const cols = ytdColumns(plan, fy);
  if (cols.length === 0) return null;
  const v = plan.values;
  const sum = (row: string) => cols.reduce((s, c) => s + (v[row]?.[c.key] ?? 0), 0);
  const revenue = sum("revenue");
  const cost = sum("resource-cost");
  const hc = sum("ending-hc") / cols.length;
  const annual = 12 / cols.length;
  return {
    months: cols.map((c) => c.month),
    revenue: revenue * annual,
    headcount: hc,
    revenuePerHc: hc ? (revenue * annual) / hc : null,
    gpPerHc: hc ? ((revenue - cost) * annual) / hc : null,
    revenuePerHcCost: cost ? revenue / cost : null,
  };
}

export function lastYearBaseline(plan: CapacityPlan, fy: string): (Baseline & { label: string; source: string }) | null {
  const prior = plan.settings?.[fy]?.priorYear;
  if (!prior || !plan.revenueByMonth) return null;
  const start = 2000 + Number(prior.fiscalYear.slice(2));
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(start, 3 + i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const known = months.filter((m) => plan.revenueByMonth?.[m]);
  if (known.length < 12) return null;
  const revenue = known.reduce((s, m) => s + (plan.revenueByMonth?.[m]?.revenue ?? 0), 0);
  const hc = prior.averageHeadcount;
  return {
    label: prior.fiscalYear,
    source: prior.source,
    revenue,
    headcount: hc,
    revenuePerHc: hc ? revenue / hc : null,
    gpPerHc: hc ? (revenue - prior.staffCostUsd) / hc : null,
    revenuePerHcCost: prior.staffCostUsd ? revenue / prior.staffCostUsd : null,
  };
}


// The fiscal year the page reports on: the productivity's, else that of the latest actual month.
export function reportingYear(plan: CapacityPlan): string {
  return plan.productivity?.fiscalYear ?? [...(plan.months ?? [])].reverse().find((m) => m.actual)?.fiscalYear ?? "FY26";
}
