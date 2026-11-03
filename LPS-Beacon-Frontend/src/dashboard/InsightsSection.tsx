// src/dashboard/InsightsSection.tsx
// The Dashboard's charts and tables from all the uploaded files, below the capacity plan charts:
//   Redeployment     (latest review) who rolls off in the next months, by position, and the won or ongoing project
//                                    the matching put them on; who has no work matched yet (bench risk)
//   Utilisation      (UR report)     where non-billable time goes, Billable UR by team and tier
//   Workforce        (staff list)    leavers already recorded
// The numbers are prepared by the pipeline (GET /dashboard/insights); this file only lays them out.

import { useEffect, useState } from "react";
import { BANDS } from "../analysis/capacityPlanLayout";
import { getDashboardInsights } from "../api/client";
import { useAuth } from "../auth/useAuth";
import BarChart from "../charts/BarChart";
import ChartCard from "../charts/ChartCard";
import LineChart from "../charts/LineChart";
import { formatChartValue } from "../charts/chartMath";
import DashboardSection from "./DashboardSection";
import type { ChartFormat } from "../charts/chartMath";
import type { DashboardInsights, ResourceOutlook, Utilisation, Workforce } from "./insightTypes";

const BLUE = "var(--chart-1)";
const ORANGE = "var(--chart-2)";
const TEAL = "var(--chart-3)";
const GREY = "var(--chart-4)";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-10" -> "Oct'26"
function monthLabel(ym: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym ?? "");
  return m ? `${MONTHS[Number(m[2]) - 1]}'${m[1].slice(2)}` : "–";
}

function show(value: number | null | undefined, format: ChartFormat): string {
  return value === null || value === undefined || Number.isNaN(value) ? "–" : formatChartValue(value, format);
}

export default function InsightsSection() {
  const { token } = useAuth();
  const [data, setData] = useState<DashboardInsights | null | undefined>(undefined); // undefined = loading
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getDashboardInsights(token ?? undefined)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the dashboard insights.");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (error)
    return (
      <p className="error-banner dashboard-banner" role="alert">
        {error}
      </p>
    );
  if (data === undefined) return <p className="note">Loading the insights from the uploaded files…</p>;
  if (data === null)
    return (
      <p className="note dashboard-banner">
        Charts from the uploaded files (redeployment, utilisation, leavers) appear once a UR report or staff list has been
        uploaded and a matching has been published.
      </p>
    );

  return (
    <>
      {data.resources && <ResourceSection resources={data.resources} />}
      {data.utilisation && <UtilisationSection utilisation={data.utilisation} />}
      {data.workforce && <WorkforceSection workforce={data.workforce} />}
      {data.notes.length > 0 && <p className="note dashboard-banner">Not shown yet: {data.notes.join("; ")}.</p>}
    </>
  );
}

function ResourceSection({ resources }: { resources: ResourceOutlook }) {
  const rolls = resources.rollOffs ?? [];
  const bench = resources.benchRisk ?? [];
  return (
    <DashboardSection
      id="resources"
      title="Redeployment: who rolls off, and where they can go"
      aside={
        resources.run.asOf && (
          <span className="kpi-asof"> · from the review planned as of {monthLabel(resources.run.asOf.slice(0, 7))}</span>
        )
      }
    >
      <div className="chart-grid">
        {rolls.length > 0 && (
          <ChartCard
            title="People rolling off vs redeployed"
            subtitle="Per month: people whose project ends (and who would also be free if fiscal-year-end plans are not renewed), and how many the published matching put on won or ongoing work."
            legend={[
              { name: "Project ends", color: BLUE },
              { name: "If not renewed at FY end", color: GREY },
              { name: "Redeployed (matched)", color: TEAL },
            ]}
          >
            <LineChart
              categories={rolls.map((r) => monthLabel(r.month))}
              format="int"
              zeroBaseline
              ariaLabel="Line chart of people rolling off and people redeployed by month"
              series={[
                { name: "Project ends", values: rolls.map((r) => r.available), color: BLUE },
                { name: "If not renewed at FY end", values: rolls.map((r) => r.availableIfNotRenewed), color: GREY, dashed: true },
                { name: "Redeployed (matched)", values: rolls.map((r) => r.matched), color: TEAL },
              ]}
            />
          </ChartCard>
        )}
        {bench.length > 0 && (
          <ChartCard
            title="No work matched yet, by position"
            subtitle={`People on the bench now or rolling off within 6 months with no won or ongoing work matched: ${resources.benchRiskTotal ?? 0} in total. The ${bench.length} largest positions.`}
          >
            <div className="insight-table-wrap">
              <table className="review-table insight-table">
                <thead>
                  <tr>
                    <th scope="col">Role</th>
                    <th scope="col" className="num">Free now</th>
                    <th scope="col" className="num">Free in 0–6 months</th>
                    <th scope="col" className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {bench.map((r) => (
                    <tr key={r.role}>
                      <td>{r.role}</td>
                      <td className="num">{r.availableNow}</td>
                      <td className="num">{r.rollingOff6m}</td>
                      <td className="num">
                        <strong>{r.total}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>
        )}
        {(resources.redeployments ?? []).length > 0 && (
          <ChartCard
            wide
            title="Redeployments in the next 6 months"
            subtitle="People on the bench or rolling off, and the won or ongoing project the published matching put them on. Edit the matching on the Upload page."
          >
            <div className="insight-table-wrap">
              <table className="review-table insight-table">
                <thead>
                  <tr>
                    <th scope="col">Free from</th>
                    <th scope="col">Person</th>
                    <th scope="col">Position</th>
                    <th scope="col">Now on</th>
                    <th scope="col">Goes to</th>
                    <th scope="col">Agency</th>
                    <th scope="col">Starts</th>
                  </tr>
                </thead>
                <tbody>
                  {(resources.redeployments ?? []).map((r, i) => (
                    <tr key={`${r.resource}-${r.toProjectId}-${i}`}>
                      <td>{monthLabel(r.availableFrom)}</td>
                      <td>{r.resource ?? "–"}</td>
                      <td>
                        {r.position ?? "–"}
                        {r.band ? <span className="note"> · Band {r.band}</span> : null}
                      </td>
                      <td>{r.fromProject ?? "–"}</td>
                      <td>{r.toProject ?? r.toProjectId ?? "–"}</td>
                      <td>{r.toCustomer ?? "–"}</td>
                      <td>{monthLabel(r.start)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>
        )}
      </div>
    </DashboardSection>
  );
}

const NON_BILLABLE: { key: keyof Utilisation["nonBillableByMonth"][number]; name: string; color: string }[] = [
  { key: "leave", name: "Leave", color: BLUE },
  { key: "missingManday", name: "Missing man-days", color: ORANGE },
  { key: "admin", name: "Admin", color: GREY },
  { key: "training", name: "Training", color: TEAL },
  { key: "presales", name: "Presales", color: "var(--band-5)" },
  { key: "internal", name: "Internal", color: "var(--brand-ink)" },
  { key: "bench", name: "Bench", color: "var(--flag)" },
];

function UtilisationSection({ utilisation }: { utilisation: Utilisation }) {
  const months = utilisation.nonBillableByMonth;
  const target = utilisation.overallTarget;
  const table = (title: string, rows: Utilisation["byTeam"]) => (
    <ChartCard
      title={title}
      subtitle={`Billable UR in ${monthLabel(utilisation.latestMonth)}${target !== null ? `; red is below the ${show(target, "pct1")} overall target` : ""}.`}
    >
      <div className="insight-table-wrap">
        <table className="review-table insight-table">
          <thead>
            <tr>
              <th scope="col">{title.startsWith("By team") ? "Team" : "Tier"}</th>
              <th scope="col" className="num">Staff</th>
              <th scope="col" className="num">Billable UR</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const low = target !== null && r.billableUr !== null && r.billableUr < target - 1e-9;
              return (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td className="num">{r.staff}</td>
                  <td className={`num${low ? " insight-flag" : ""}`}>{show(r.billableUr, "pct1")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </ChartCard>
  );
  return (
    <DashboardSection id="utilisation" title="Utilisation (UR report)">
      <div className="chart-grid">
        <ChartCard
          wide
          title="Where non-billable time goes"
          subtitle="Man-days per month that were not billable, by reason. Missing man-days are days nobody logged."
          legend={NON_BILLABLE.map((n) => ({ name: n.name, color: n.color }))}
        >
          <BarChart
            categories={months.map((m) => monthLabel(m.month))}
            notes={months.map((m) => `${formatChartValue(m.workingDays, "int")} working days in total`)}
            format="int"
            width={1240} // a full-width card: draw wider so the text keeps its normal size
            ariaLabel="Stacked bar chart of non-billable man-days by reason and month"
            series={NON_BILLABLE.map((n) => ({ name: n.name, values: months.map((m) => Number(m[n.key])), color: n.color }))}
          />
        </ChartCard>
        {utilisation.byTeam.length > 0 && table("By team", utilisation.byTeam)}
        {utilisation.byTier.length > 0 && table("By tier", utilisation.byTier)}
      </div>
    </DashboardSection>
  );
}

function WorkforceSection({ workforce }: { workforce: Workforce }) {
  return (
    <DashboardSection id="workforce" title="Workforce (staff list)">
      <div className="chart-grid">
        <ChartCard
          title="Leavers already recorded"
          subtitle={
            workforce.upcomingLeaversTotal
              ? `${workforce.upcomingLeaversTotal} staff have a last employment date from this month on.`
              : "No staff have a last employment date from this month on."
          }
        >
          {workforce.upcomingLeavers.length > 0 && (
            <div className="insight-table-wrap">
              <table className="review-table insight-table">
                <thead>
                  <tr>
                    <th scope="col">Month</th>
                    {BANDS.map((b) => (
                      <th key={b.id} scope="col" className="num">
                        {b.label}
                      </th>
                    ))}
                    <th scope="col" className="num">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {workforce.upcomingLeavers.map((r) => (
                    <tr key={r.month}>
                      <td>{monthLabel(r.month)}</td>
                      {BANDS.map((b) => (
                        <td key={b.id} className="num">
                          {Number(r[b.id]) || ""}
                        </td>
                      ))}
                      <td className="num">
                        <strong>{r.total}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ChartCard>
      </div>
    </DashboardSection>
  );
}
