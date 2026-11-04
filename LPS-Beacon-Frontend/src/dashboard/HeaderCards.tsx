// src/dashboard/HeaderCards.tsx
// The Dashboard's headline figures for the filter: headcount, permanent vs secondment, billable UR, and the three FTE
// figures Finance asked for (4 Nov 2026): FTE demand (planned), FTE actual (clocked) and calculated FTE required.
// They recalculate when the agency, project or period changes. Each card says where its number comes from (hover).
//   FTE actual = clocked billable days ÷ 18 (MSPO clocking by project; SANDBOX: synthetic), averaged over the
//                period's clocked months. Months not clocked yet show "–".
//   Organisation: headcount and UR from the capacity plan, employment types from the staff list, demand from SL x RP,
//                 FTE required from the calculator's default settings (Analysis page).
//   Agency / project: the people planned on its projects that month (SL x RP), their employment type (staff list, else
//                 the UR report's tier), their UR (UR report), its FTE demand, and the FTE its revenue needs.

import type { CapacityPlan, DashboardMonthCell, DashboardView } from "../api/types";
import { fmt, fteRequired, weightedIRate } from "../analysis/baseline";
import type { Period } from "./period";

const ACTUAL_HOW = "FTE actually delivered: billable days clocked in MSPO ÷ 18.";

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

function orgCards(plan: CapacityPlan, view: DashboardView | null, period: Period, fy: string): Card[] {
  const v = plan.values;
  const hc = v["ending-hc"]?.[period.endKey] ?? null;
  const ur = v["billable-ur"]?.[period.totalKey] ?? null;
  const demandMonths = period.months.map((m) => plan.demandByMonth?.[m]?.fte).filter((x): x is number => x !== undefined);
  const demand = demandMonths.length ? demandMonths.reduce((a, b) => a + b, 0) / demandMonths.length : null;
  const t = plan.settings?.[fy]?.target;
  const rate = weightedIRate(plan, period.endKey, fy);
  const req = t && rate
    ? fteRequired({ annualRevenue: t.revenueUsd, gpPct: t.gpPct, ur: t.billableUr, manDaysPerFte: t.manDaysPerFte ?? 18,
        manDaysAreBillable: t.manDaysAreBillable ?? false, iRate: rate })
    : null;
  const p = view?.permanent;
  const permanent = p ? p.regular : null;
  const other = p ? p.supplementalOther + p.supplementalRetiree : 0;
  const actualMonths = period.months.map((m) => plan.actualFteByMonth?.[m]).filter((x): x is number => x !== undefined);
  const actual = average(actualMonths);
  return [
    { label: "Headcount", value: fmt.int(hc), sub: `end of ${period.endKey}`,
      how: "People employed at the end of the month: last month's headcount plus Workday joiners, minus leavers." },
    { label: "Permanent · Secondment", value: permanent === null ? "–" : `${fmt.int(permanent)} · ${fmt.int(view?.secondment)}`,
      sub: other ? `+ ${fmt.int(other)} supplemental · staff list ${view?.asOf ?? ""}` : `staff list ${view?.asOf ?? ""}`,
      how: "Staff by employment type, from the staff list. Supplemental staff are counted separately." },
    { label: "Billable UR", value: fmt.pct(ur), sub: period.id === "latest" ? undefined : "average of the months",
      how: "Billable days ÷ working days, from the UR report. Future months show the target." },
    { label: "FTE demand", value: fmt.int(demand), sub: hc !== null && demand !== null ? `planned · HC ${fmt.int(hc)}` : "planned",
      how: "FTE needed for won and ongoing work: planned man-days in the resource plan ÷ 18." },
    { label: "FTE actual", value: fmt.int(actual), sub: actualMonths.length ? "clocked" : "not clocked yet", how: ACTUAL_HOW },
    { label: "Calculated FTE required", value: fmt.int(req?.totalFte), sub: t ? `for ${fmt.usdM(t.revenueUsd)} a year` : undefined,
      how: "FTE needed to earn the revenue target, from the calculator on the Analysis page. Indicative: the formula is being revised." },
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
  const required = figures?.requiredFte ?? null;
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
    { label: "FTE demand", value: fmt.dec1(demand), sub: "planned",
      how: "FTE needed for its won and ongoing work: planned man-days ÷ 18." },
    { label: "FTE actual", value: fmt.dec1(actual), sub: clocked.length ? "clocked" : "not clocked yet", how: ACTUAL_HOW },
    { label: "Calculated FTE required", value: fmt.dec1(required), sub: "for its revenue",
      how: "FTE its revenue would need, by the current formula. Indicative: the formula is being revised." },
  ];
}

export default function HeaderCards({
  plan,
  view,
  period,
  fy,
}: {
  plan: CapacityPlan;
  view: DashboardView | null;
  period: Period;
  fy: string;
}) {
  const cards = view?.selection ? selectionCards(plan, view, period) : orgCards(plan, view, period, fy);
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
