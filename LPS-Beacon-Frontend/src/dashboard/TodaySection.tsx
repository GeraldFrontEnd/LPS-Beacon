// src/dashboard/TodaySection.tsx
// The top of the Dashboard: "How are we doing today?"
//  - Demand vs capacity: the backlog on won and ongoing work (FTE demand from SL x RP Project and Quote Won rows)
//    against the headcount delivering it, so the bench or the shortage shows month by month.
//  - Agencies needing attention: the agencies the Analysis page flags red, for management attention and Thomas's
//    review, with a link to the breakdown.

import { Link } from "react-router-dom";
import { MONTH_COLUMNS } from "../analysis/capacityPlanLayout";
import type { CapacityPlan } from "../api/types";
import ChartCard from "../charts/ChartCard";
import LineChart from "../charts/LineChart";
import DashboardSection from "./DashboardSection";
import { MONTH_LABELS, forecastFrom, monthNotes, monthSeries } from "./planSeries";

const BLUE = "var(--chart-1)";
const ORANGE = "var(--chart-2)";
const int0 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const dec1 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export default function TodaySection({ plan }: { plan: CapacityPlan }) {
  const ymOf = Object.fromEntries((plan.months ?? []).map((m) => [m.key, m.month]));
  const demand = plan.demandByMonth ?? null;
  const hc = monthSeries(plan, "ending-hc");
  const fteDemand = MONTH_COLUMNS.map((c) => demand?.[ymOf[c.key]]?.fte ?? null);
  // Today = the latest month with actual figures that also has demand.
  const actualKeys = new Set((plan.months ?? []).filter((m) => m.actual).map((m) => m.key));
  let today = -1;
  MONTH_COLUMNS.forEach((c, i) => {
    if (actualKeys.has(c.key) && fteDemand[i] !== null) today = i;
  });
  const hcToday = today >= 0 ? hc[today] : null;
  const demandToday = today >= 0 ? fteDemand[today] : null;
  const gapToday = hcToday !== null && demandToday !== null ? hcToday - demandToday : null;
  const shownTo = (() => {
    // Plans mostly stop at the fiscal year end; stop the chart where demand falls away (under a fifth of today's).
    let last = fteDemand.length - 1;
    while (last > 0 && (fteDemand[last] === null || (demandToday && (fteDemand[last] ?? 0) < demandToday * 0.2))) last--;
    return last + 1;
  })();

  const red = (plan.productivity?.agencies ?? []).filter((a) => a.flag === "red");

  return (
    <DashboardSection id="today" title="How are we doing today?">
      {demand ? (
        <>
          <div className="stats">
            <div className="stat">
              <div className="stat-value">{hcToday === null ? "–" : int0.format(hcToday)}</div>
              <div className="stat-label">Headcount{today >= 0 ? ` (${MONTH_LABELS[today]})` : ""}</div>
            </div>
            <div className="stat">
              <div className="stat-value">{demandToday === null ? "–" : int0.format(demandToday)}</div>
              <div className="stat-label">FTE demand on won and ongoing work</div>
            </div>
            <div className="stat">
              <div className={`stat-value${gapToday !== null && gapToday < 0 ? " stat-bad" : ""}`}>
                {gapToday === null ? "–" : `${gapToday > 0 ? "+" : ""}${int0.format(gapToday)}`}
              </div>
              <div className="stat-label">
                {gapToday === null ? "Bench or shortage" : gapToday >= 0 ? "On the bench (HC above demand)" : "Short (demand above HC)"}
              </div>
            </div>
          </div>
          <div className="chart-grid">
            <ChartCard
              wide
              title="Demand vs capacity"
              subtitle="FTE needed on won and ongoing projects (resource plans and won quote lines) against the headcount delivering them. Where demand is above headcount we are short; below it, people are on the bench. Resource plans mostly stop at the fiscal year end."
              legend={[
                { name: "Headcount", color: BLUE },
                { name: "FTE demand (won and ongoing)", color: ORANGE },
              ]}
            >
              <LineChart
                categories={MONTH_LABELS.slice(0, shownTo)}
                notes={monthNotes(plan).slice(0, shownTo)}
                forecastFrom={forecastFrom(plan)}
                format="int"
                ariaLabel="Line chart of headcount and FTE demand on won and ongoing work by month"
                series={[
                  { name: "Headcount", values: hc.slice(0, shownTo), color: BLUE },
                  { name: "FTE demand", values: fteDemand.slice(0, shownTo), color: ORANGE },
                ]}
              />
            </ChartCard>
          </div>
        </>
      ) : (
        <p className="note">Upload an SL x RP file to compare demand on won and ongoing work with the headcount.</p>
      )}

      <h3 className="dashboard-subtitle">Agencies needing attention</h3>
      {plan.productivity ? (
        red.length > 0 ? (
          <div className="insight-table-wrap">
            <table className="review-table insight-table">
              <thead>
                <tr>
                  <th scope="col">Agency</th>
                  <th scope="col" className="num">Delivery FTE</th>
                  <th scope="col" className="num">Revenue per FTE</th>
                  <th scope="col" className="num">FTE required</th>
                  <th scope="col">Why</th>
                </tr>
              </thead>
              <tbody>
                {red.slice(0, 8).map((a) => (
                  <tr key={a.agency}>
                    <td>
                      <span className="flag-pill red">Needs attention</span> {a.agency}
                    </td>
                    <td className="num">{dec1.format(a.fte)}</td>
                    <td className="num">{a.revenuePerFte === null ? "–" : `$${dec1.format(a.revenuePerFte / 1000)}K`}</td>
                    <td className="num">{a.requiredFte === null ? "–" : dec1.format(a.requiredFte)}</td>
                    <td>{a.flagReason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="note">
              {red.length} agenc{red.length === 1 ? "y is" : "ies are"} flagged red for management attention and Thomas&apos;s
              review{plan.productivity.rules.draft ? " (draft thresholds)" : ""}.{" "}
              <Link to="/analysis">See the breakdown by agency and project</Link>.
            </p>
          </div>
        ) : (
          <p className="note">No agency is flagged red.</p>
        )
      ) : (
        <p className="note">Appears once an ABCD report with actual months and an SL x RP file are uploaded.</p>
      )}
    </DashboardSection>
  );
}
