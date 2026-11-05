// src/analysis/periodFigures.ts
// The Analysis page's agencies and projects for the period picked: one month, a quarter, or the fiscal year to date
// (4 Nov 2026). The pipeline sends each agency's and project's figures per month (byMonth); this adds them up for the
// months picked and works out the ratios, the company average and the flags again, with the same rules as the
// pipeline (pipeline/capacity.py _productivity):
//   HC                 people on it in the LAST month of the period (a whole number); the average a month in the tooltip
//   FTE actual         clocked billable days ÷ 18, averaged over the period's months
//   Days / head        clocked billable days per person a month (each person counted once a month)
//   Revenue / GP per FTE   annualised (× 12 ÷ months in the period)
//   Calculated FTE required   the calculator's formula (baseline.ts) on the period's annualised revenue (kept for the chat
//                      and the calculator; the table shows ADR instead)
//   ADR                average daily revenue: revenue ÷ billable days clocked (baseline.ts adr), actual only
//   Flags              red when days per head is below 15.3 or above 18; productivity against the company average of
//                      the same period (draft thresholds); agencies under the minimum FTE or without revenue are not
//                      flagged on productivity
// Inputs built by a pipeline older than 4 Nov 2026 have no byMonth: the page then shows the pipeline's own figures
// for the fiscal year to date and offers no other period.

import type {
  AgencyProductivity,
  CapacityPlan,
  Flag,
  ProductivityFigures,
  ProductivityMonth,
  ProjectProductivity,
} from "../api/types";
import { fteRequired } from "./baseline";

export interface PeriodOption {
  id: string; // "fy", "Q3", "2026-10"
  label: string;
  months: string[];
}

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const QUARTER_OF = (ym: string) => {
  const m = Number(ym.slice(5, 7));
  return m >= 4 && m <= 6 ? 1 : m >= 7 && m <= 9 ? 2 : m >= 10 ? 3 : 4;
};
const short = (ym: string) => `${MONTH[Number(ym.slice(5, 7)) - 1]}'${ym.slice(2, 4)}`;
const long = (ym: string) => `${MONTH[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

// The periods the data covers: the FY to date, each quarter with data (a partial quarter says so), each month.
export function periodOptions(months: string[], fiscalYear: string): PeriodOption[] {
  const out: PeriodOption[] = [];
  if (!months.length) return out;
  out.push({ id: "fy", label: `${fiscalYear} to date (${short(months[0])} – ${short(months[months.length - 1])})`, months });
  for (const q of [1, 2, 3, 4]) {
    const qm = months.filter((m) => QUARTER_OF(m) === q);
    if (!qm.length) continue;
    const label = qm.length < 3 ? `Q${q} ${fiscalYear} (${qm.map(short).join(", ")} so far)` : `Q${q} ${fiscalYear}`;
    out.push({ id: `Q${q}`, label, months: qm });
  }
  for (const m of [...months].reverse()) out.push({ id: m, label: long(m), months: [m] });
  return out;
}

export interface PeriodView {
  agencies: AgencyProductivity[];
  companyAverage: { revenuePerFte: number | null; gpPerFte: number | null; revenuePerHcCost: number | null };
  months: string[];
  fromPipeline: boolean; // true: no byMonth, the pipeline's FY figures as they came
}

const ORDER: Record<Flag, number> = { red: 2, amber: 1, green: 0 };

export function periodView(plan: CapacityPlan, fy: string, months: string[]): PeriodView {
  const p = plan.productivity!;
  const hasMonths = p.agencies.length > 0 && p.agencies.every((a) => a.byMonth);
  if (!hasMonths) {
    return { agencies: p.agencies, companyAverage: p.companyAverage, months: p.months, fromPipeline: true };
  }
  const n = months.length;
  const annual = 12 / n;
  const last = months[n - 1];
  const fullDays = p.rules.utilisation?.fullMonthManDays ?? 18;
  const util = p.rules.utilisation ?? { fullMonthManDays: 18, urTarget: 0.85, redBelowDays: 15.3, redAboveDays: 18 };
  const target = plan.settings?.[fy]?.target;
  const clocked = p.clocked !== false; // without clocking, actualDays holds the plan: no ADR

  const sum = (byMonth: Record<string, ProductivityMonth> | undefined) => {
    const t = { revenue: 0, hcCost: 0, actualDays: 0, planDays: 0, people: 0, clockedDays: 0, clockedPeople: 0 };
    for (const m of months) {
      const c = byMonth?.[m];
      if (!c) continue;
      t.revenue += c.revenue;
      t.hcCost += c.hcCost;
      t.actualDays += c.actualDays;
      t.planDays += c.planDays;
      t.people += c.people;
      t.clockedDays += c.clockedDays;
      t.clockedPeople += c.clockedPeople;
    }
    return t;
  };

  const figures = <T extends ProductivityFigures>(item: T): T => {
    const t = sum(item.byMonth);
    const fte = t.actualDays / fullDays / n;
    const gp = t.revenue - t.hcCost;
    const rate = t.actualDays ? t.hcCost / t.actualDays : null;
    const required =
      target && rate
        ? fteRequired({
            annualRevenue: t.revenue * annual,
            gpPct: target.gpPct,
            ur: target.billableUr,
            manDaysPerFte: target.manDaysPerFte ?? 18,
            manDaysAreBillable: target.manDaysAreBillable ?? false,
            iRate: rate,
          })?.totalFte ?? null
        : null;
    return {
      ...item,
      revenue: t.revenue,
      hcCost: t.hcCost,
      gp,
      headcount: item.byMonth?.[last]?.people ?? 0,
      headcountAverage: t.people / n,
      fte,
      planFte: t.planDays / fullDays / n,
      daysPerHead: t.clockedPeople ? t.clockedDays / t.clockedPeople : null,
      revenuePerFte: fte ? (t.revenue * annual) / fte : null,
      gpPerFte: fte ? (gp * annual) / fte : null,
      revenuePerHcCost: t.hcCost ? t.revenue / t.hcCost : null,
      ratePerDay: rate,
      requiredFte: required,
      adr: clocked && t.actualDays ? t.revenue / t.actualDays : null,
    };
  };

  const agencies = p.agencies.map((a) => ({
    ...figures(a),
    projects: a.projects.map((pr) => figures(pr) as ProjectProductivity).filter((pr) => pr.revenue || pr.fte || pr.planFte),
  }));

  // Company average of this period: agencies with at least the minimum FTE and some revenue.
  const rules = p.rules;
  const counted = agencies.filter((a) => a.fte >= rules.minFte && a.revenue > 0);
  const totFte = counted.reduce((s, a) => s + a.fte, 0);
  const totRev = counted.reduce((s, a) => s + a.revenue, 0);
  const totGp = counted.reduce((s, a) => s + a.gp, 0);
  const totCost = counted.reduce((s, a) => s + a.hcCost, 0);
  const companyAverage = {
    revenuePerFte: totFte ? (totRev * annual) / totFte : null,
    gpPerFte: totFte ? (totGp * annual) / totFte : null,
    revenuePerHcCost: totCost ? totRev / totCost : null,
  };

  const flag = <T extends ProductivityFigures>(item: T): T => {
    const days = item.daysPerHead;
    const use: Flag | null =
      days === null ? null : days < util.redBelowDays || days > util.redAboveDays ? "red" : "green";
    const reasons: string[] = [];
    if (use === "red" && days !== null) {
      reasons.push(
        days < util.redBelowDays
          ? `Under-utilised: people clock ${days.toFixed(1)} days a month on average (minimum ${util.redBelowDays})`
          : `Over-utilised: people clock ${days.toFixed(1)} days a month on average (limit ${util.redAboveDays})`
      );
    }
    if (item.fte < rules.minFte || item.revenue <= 0) {
      return {
        ...item,
        utilisationFlag: use,
        productivityFlag: null,
        flag: use === "red" ? "red" : null,
        flagReason: reasons.join("; ") || `Too small to judge productivity (under ${rules.minFte} FTE or no revenue)`,
      };
    }
    let prod: Flag | null = null;
    for (const k of rules.metrics as ("revenuePerFte" | "gpPerFte")[]) {
      const value = item[k];
      const avg = companyAverage[k];
      if (value === null || !avg) continue;
      const below = (avg - value) / avg;
      const f: Flag = below > rules.productivity.redBelowPct ? "red" : below > rules.productivity.amberBelowPct ? "amber" : "green";
      if (f !== "green") reasons.push(`${k === "revenuePerFte" ? "Revenue" : "GP"} per FTE is ${Math.round(below * 100)}% below the company average`);
      if (!prod || ORDER[f] > ORDER[prod]) prod = f;
    }
    const overall = [prod, use].filter((f): f is Flag => !!f).sort((x, y) => ORDER[y] - ORDER[x])[0] ?? null;
    return {
      ...item,
      utilisationFlag: use,
      productivityFlag: prod,
      flag: overall,
      flagReason:
        reasons.join("; ") ||
        `On track: people clock ${util.redBelowDays} to ${util.redAboveDays} days a month, and revenue per FTE is at or above the company average`,
    };
  };

  const flagged = agencies
    .map((a) => ({ ...flag(a), projects: a.projects.map((pr) => flag(pr)).sort((x, y) => y.revenue - x.revenue) }))
    .filter((a) => a.revenue || a.fte || a.planFte);
  const rank: Record<string, number> = { red: 0, amber: 1, green: 2 };
  flagged.sort((x, y) => (rank[x.flag ?? ""] ?? 3) - (rank[y.flag ?? ""] ?? 3) || y.revenue - x.revenue);
  return { agencies: flagged, companyAverage, months, fromPipeline: false };
}
