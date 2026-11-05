// src/dashboard/HeaderCards.tsx
// The Dashboard's headline figures for the filter. Two groups (Hwee Yu, 4 Nov 2026):
//   Headcount       headcount, permanent vs secondment, billable UR
//   FTE             the three FTE figures she needs to see side by side, then the calculated one:
//     As sold       FTE in the business case (Bcase). No source file yet, so "–".
//     As planned    FTE the PM planned (SL x RP man-days ÷ 18), averaged over the period's months
//     Actual        billable days clocked in MSPO ÷ 18, averaged over the period's clocked months
//     ADR           average daily revenue: revenue ÷ billable days clocked (= monthly revenue ÷ (FTE actual × 18)),
//                   all actual, worked out by project and added up (baseline.ts adr). It replaces "Calculated FTE
//                   required" here: Hwee Yu, "the calculated that one is ADR, you need to do it by project".
// They recalculate when the agency, project or period changes. Each card says where its number comes from (hover).
//   Organisation: headcount and UR from the capacity plan, employment types from the staff list.
//   Agency / project: the people planned on its projects that month (SL x RP), their employment type (staff list, else
//                 the UR report's tier) and their UR (UR report).

import type { CapacityPlan, DashboardMonthCell, DashboardView } from "../api/types";
import { adr, fmt } from "../analysis/baseline";
import type { Period } from "./period";

const SOLD_HOW = "FTE sold in the business case (Bcase). Waiting for the Bcase file, so not shown yet.";
const PLAN_HOW = "FTE the project managers planned (MSPO resource plan, SL x RP): planned man-days ÷ 18.";
const ACTUAL_HOW = "FTE actually delivered: billable days clocked in MSPO ÷ 18.";
const ADR_HOW =
  "Average daily revenue: revenue ÷ billable days clocked, i.e. monthly revenue ÷ (FTE actual × 18). " +
  "Actual months only (ABCD revenue and MSPO clocking).";

function average(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

interface Card {
  label: string;
  value: string;
  sub?: string;
  tone?: "bad" | "good";
  how: string; // tooltip: how the number is worked out
}

// The period's months that have ABCD actuals and clocking (the productivity months), for ADR.
function adrMonths(plan: CapacityPlan, period: Period): string[] {
  const p = plan.productivity;
  if (!p || p.clocked === false) return [];
  return period.months.filter((m) => p.months.includes(m));
}

function adrSub(months: string[], period: Period): string {
  if (!months.length) return "no revenue and clocking for this period yet";
  return months.length < period.months.length ? `per clocked day · ${months.length} of ${period.months.length} months` : "per clocked day";
}

function orgCards(plan: CapacityPlan, view: DashboardView | null, period: Period): Card[] {
  const v = plan.values;
  const hc = v["ending-hc"]?.[period.endKey] ?? null;
  const ur = v["billable-ur"]?.[period.totalKey] ?? null;
  const demand = average(period.months.map((m) => plan.demandByMonth?.[m]?.fte).filter((x): x is number => x !== undefined));
  const p = view?.permanent;
  const permanent = p ? p.regular : null;
  const other = p ? p.supplementalOther + p.supplementalRetiree : 0;
  const actualMonths = period.months.map((m) => plan.actualFteByMonth?.[m]).filter((x): x is number => x !== undefined);
  const actual = average(actualMonths);
  // ADR of the whole organisation: every agency's revenue and clocked days added up, then divided.
  const months = adrMonths(plan, period);
  const totals: Record<string, { revenue: number; actualDays: number }> = {};
  for (const a of plan.productivity?.agencies ?? [])
    for (const m of months) {
      const c = a.byMonth?.[m];
      if (!c) continue;
      const t = (totals[m] ??= { revenue: 0, actualDays: 0 });
      t.revenue += c.revenue;
      t.actualDays += c.actualDays;
    }
  return [
    { label: "Headcount", value: fmt.int(hc), sub: `end of ${period.endKey}`,
      how: "People employed at the end of the month: last month's headcount plus Workday joiners, minus leavers." },
    { label: "Permanent · Secondment", value: permanent === null ? "–" : `${fmt.int(permanent)} · ${fmt.int(view?.secondment)}`,
      sub: other ? `+ ${fmt.int(other)} supplemental · staff list ${view?.asOf ?? ""}` : `staff list ${view?.asOf ?? ""}`,
      how: "Staff by employment type, from the staff list. Supplemental staff are counted separately." },
    { label: "Billable UR", value: fmt.pct(ur), sub: period.id === "latest" ? undefined : "average of the months",
      how: "Billable days ÷ working days, from the UR report. Future months show the target." },
    { label: "As sold (FTE)", value: "–", sub: "Bcase file not supplied yet", how: SOLD_HOW },
    { label: "As planned (FTE)", value: fmt.int(demand), sub: "PM's plan (SL x RP)", how: PLAN_HOW },
    { label: "Actual (FTE)", value: fmt.int(actual), sub: actualMonths.length ? "clocked (MSPO)" : "not clocked yet", how: ACTUAL_HOW },
    { label: "ADR", value: fmt.usd(adr(totals, months)), sub: adrSub(months, period), how: ADR_HOW },
  ];
}

function selectionCards(plan: CapacityPlan, view: DashboardView, period: Period): Card[] {
  const sel = view.selection!;
  const cells = period.months.map((m) => sel.byMonth[m]).filter(Boolean);
  const end = sel.byMonth[period.months[period.months.length - 1]] ?? cells[cells.length - 1];
  const demand = cells.length ? cells.reduce((s, c) => s + c.fte, 0) / cells.length : null;
  const billable = cells.reduce((s, c) => s + c.billable, 0);
  const days = cells.reduce((s, c) => s + c.workingDays, 0);
  const prod = plan.productivity;
  const figures =
    sel.kind === "agency"
      ? prod?.agencies.find((a) => a.agency === sel.agency)
      : prod?.agencies.flatMap((a) => a.projects).find((p) => p.projectId === sel.projectId);
  const months = adrMonths(plan, period);
  const clocked = cells.filter((c): c is DashboardMonthCell & { actualFte: number } => c.actualFte != null);
  const actual = average(clocked.map((c) => c.actualFte));
  return [
    { label: "People", value: fmt.int(end?.people), sub: `planned in ${period.endKey}`,
      how: "People planned on its projects this month. Someone on two projects counts in both." },
    { label: "Permanent · Secondment", value: end ? `${fmt.int(end.permanent)} · ${fmt.int(end.secondment)}` : "–",
      sub: end && end.other + end.unknown ? `+ ${end.other + end.unknown} other or unknown` : "of those people",
      how: "Those people by employment type, from the staff list." },
    { label: "Billable UR", value: days ? fmt.pct(billable / days) : "–", sub: days ? undefined : "no clocking yet",
      how: "Those people's billable days ÷ working days, from the UR report." },
    { label: "As sold (FTE)", value: "–", sub: "Bcase file not supplied yet", how: SOLD_HOW },
    { label: "As planned (FTE)", value: fmt.dec1(demand), sub: "PM's plan (SL x RP)", how: PLAN_HOW },
    { label: "Actual (FTE)", value: fmt.dec1(actual), sub: clocked.length ? "clocked (MSPO)" : "not clocked yet", how: ACTUAL_HOW },
    { label: "ADR", value: fmt.usd(adr(figures?.byMonth, months)), sub: adrSub(months, period),
      how: `${ADR_HOW} ${sel.kind === "agency" ? "Its projects' revenue and clocked days added up." : ""}`.trim() },
  ];
}

export default function HeaderCards({
  plan,
  view,
  period,
}: {
  plan: CapacityPlan;
  view: DashboardView | null;
  period: Period;
}) {
  const cards = view?.selection ? selectionCards(plan, view, period) : orgCards(plan, view, period);
  return (
    <dl className="dash-cards">
      {cards.map((c) => (
        <div key={c.label} className="dash-card" title={c.how}>
          <dt>{c.label}</dt>
          <dd className={c.tone ? `tone-${c.tone}` : undefined}>{c.value}</dd>
          {c.sub && <dd className="dash-card-sub">{c.sub}</dd>}
        </div>
      ))}
    </dl>
  );
}
