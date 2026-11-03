// src/dashboard/HeaderCards.tsx
// The Dashboard's headline figures for the filter (3 Nov instructions 9.4 D): headcount, permanent vs secondment,
// billable UR, FTE demand on won and ongoing work, FTE required for the revenue, and the gap. They recalculate when the
// agency, project or period changes. Each card says where its number comes from (hover).
//   Organisation: headcount and UR from the capacity plan, employment types from the staff list, demand from SL x RP,
//                 FTE required from the calculator's default settings (Analysis page).
//   Agency / project: the people planned on its projects that month (SL x RP), their employment type (staff list, else
//                 the UR report's tier), their UR (UR report), its FTE demand, and the FTE its revenue needs.

import type { CapacityPlan, DashboardView } from "../api/types";
import { fmt, fteRequired, weightedIRate } from "../analysis/baseline";
import type { Period } from "./period";

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
        manDaysAreBillable: t.manDaysAreBillable ?? true, iRate: rate })
    : null;
  const p = view?.permanent;
  const permanent = p ? p.regular : null;
  const other = p ? p.supplementalOther + p.supplementalRetiree : 0;
  const gap = hc !== null && demand !== null ? hc - demand : null;
  return [
    { label: "Headcount", value: fmt.int(hc), sub: `end of ${period.endKey}`,
      how: "Capacity plan Ending HC: the UR report's staff, rolled forward with the Workday joiners and leavers." },
    { label: "Permanent · Secondment", value: permanent === null ? "–" : `${fmt.int(permanent)} · ${fmt.int(view?.secondment)}`,
      sub: other ? `+ ${fmt.int(other)} supplemental · staff list ${view?.asOf ?? ""}` : `staff list ${view?.asOf ?? ""}`,
      how: "Staff list Employee Type: Regular Employee = permanent; Secondment; the Supplemental types shown apart (open question #12)." },
    { label: "Billable UR", value: fmt.pct(ur), sub: period.id === "latest" ? "UR report" : "average of the months",
      how: "Billable man-days ÷ standard working days (UR report); forecast months use the FY target." },
    { label: "FTE demand", value: fmt.int(demand), sub: "won and ongoing work",
      how: "SL x RP Project and Quote Won man-days ÷ 18, averaged over the period." },
    { label: "FTE required", value: fmt.int(req?.totalFte), sub: t ? `for ${fmt.usdM(t.revenueUsd)} a year` : undefined,
      how: "Revenue target ÷ (12 × 18 man-days × iRate ÷ (1 − GP %)). Change the inputs in the calculator on the Analysis page." },
    { label: gap !== null && gap < 0 ? "Short" : "On the bench", value: gap === null ? "–" : fmt.int(Math.abs(gap)),
      sub: "headcount − FTE demand", tone: gap !== null && gap < 0 ? "bad" : "good",
      how: "Headcount minus FTE demand on won and ongoing work. Below zero means more work than people." },
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
  const gap = required !== null && demand !== null ? demand - required : null;
  return [
    { label: "People", value: fmt.int(end?.people), sub: `planned in ${period.endKey}`,
      how: "People with man-days on its projects that month (SL x RP). Someone on two projects counts in both." },
    { label: "Permanent · Secondment", value: end ? `${fmt.int(end.permanent)} · ${fmt.int(end.secondment)}` : "–",
      sub: end && end.other + end.unknown ? `+ ${end.other + end.unknown} other or unknown` : "of those people",
      how: "Staff list Employee Type by IT Code; people not on it use the UR report's tier (Tier S_ = secondment)." },
    { label: "Billable UR", value: days ? fmt.pct(billable / days) : "–", sub: days ? "its people, UR report" : "no UR report rows",
      how: "Those people's billable days ÷ standard working days on the UR report, over the period's actual months." },
    { label: "FTE demand", value: fmt.dec1(demand), sub: "won and ongoing work",
      how: "Its SL x RP Project and Quote Won man-days ÷ 18, averaged over the period." },
    { label: "FTE required", value: fmt.dec1(required), sub: "for its revenue",
      how: "Its yearly revenue (ABCD) ÷ (12 × 18 man-days × its weighted iRate ÷ (1 − 27% GP))." },
    { label: gap !== null && gap < 0 ? "Understaffed" : "Overstaffed", value: gap === null ? "–" : fmt.dec1(Math.abs(gap)),
      sub: "FTE demand − FTE required", tone: gap === null || Math.abs(gap) < 1 ? undefined : gap < 0 ? "bad" : "good",
      how: "Planned FTE minus the FTE its revenue needs at the target GP. Agencies are flagged when this is far off." },
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
