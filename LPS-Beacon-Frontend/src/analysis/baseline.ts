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

// The latest month with actual figures (its plan column), or null.
export function latestActual(plan: CapacityPlan) {
  return [...(plan.months ?? [])].reverse().find((m) => m.actual) ?? null;
}

// Weighted average cost per FTE per day: the rate card (iRate) weighted by the headcount in each band that month.
export function weightedIRate(plan: CapacityPlan, columnKey: string, fy: string): number | null {
  const rates = plan.settings?.[fy]?.bandDayRatesUsd ?? {};
  let heads = 0;
  let cost = 0;
  for (const band of Object.keys(rates)) {
    const hc = plan.values[`ending-hc:${band}`]?.[columnKey] ?? 0;
    heads += hc;
    cost += hc * rates[band];
  }
  return heads ? cost / heads : null;
}

// ---- The FTE-required calculator (3 Nov instructions, 8.2 / 9.4 C), the same formula as pipeline/capacity.py ----
export interface FteInputs {
  annualRevenue: number; // USD
  gpPct: number; // 0.27
  ur: number; // 0.854
  manDaysPerFte: number; // a month, 18
  manDaysAreBillable: boolean; // true: the man-days already allow for UR, so UR is not applied again
  iRate: number; // USD a day
}

export interface FteResult {
  pricePerDay: number; // revenue per FTE-day = iRate / (1 - GP %)
  revenuePerFteYear: number; // 12 x man-days x revenue per FTE-day
  billableFte: number;
  totalFte: number; // = billable unless the man-days are working days (then / UR)
}

export function fteRequired(i: FteInputs): FteResult | null {
  if (!(i.annualRevenue > 0 && i.gpPct >= 0 && i.gpPct < 1 && i.ur > 0 && i.manDaysPerFte > 0 && i.iRate > 0)) return null;
  const pricePerDay = i.iRate / (1 - i.gpPct);
  const revenuePerFteYear = 12 * i.manDaysPerFte * pricePerDay;
  const billableFte = i.annualRevenue / revenuePerFteYear;
  return { pricePerDay, revenuePerFteYear, billableFte, totalFte: i.manDaysAreBillable ? billableFte : billableFte / i.ur };
}

// ---- Money and number formats used across the Analysis page and the Dashboard ("$", never "US$") ----
const grouped0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const grouped1 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const grouped2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const missing = (v: number | null | undefined): v is null | undefined => v === null || v === undefined || !Number.isFinite(v);
const sign = (v: number) => (v < 0 ? "−" : "");

export const fmt = {
  usd: (v: number | null | undefined) => (missing(v) ? "–" : `${sign(v)}$${grouped0.format(Math.abs(v))}`),
  usdK: (v: number | null | undefined) => (missing(v) ? "–" : `${sign(v)}$${grouped1.format(Math.abs(v) / 1000)}K`),
  usdM: (v: number | null | undefined) => (missing(v) ? "–" : `${sign(v)}$${grouped2.format(Math.abs(v) / 1_000_000)}M`),
  ratio: (v: number | null | undefined) => (missing(v) ? "–" : `$${grouped2.format(v)}`),
  int: (v: number | null | undefined) => (missing(v) ? "–" : grouped0.format(v)),
  dec1: (v: number | null | undefined) => (missing(v) ? "–" : grouped1.format(v)),
  pct: (v: number | null | undefined) => (missing(v) ? "–" : `${grouped1.format(v * 100)}%`),
};

// "2026-10" -> "Oct 2026"
export function monthName(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${y}`;
}
