// src/dashboard/InsightsSection.tsx
// The Dashboard's charts and tables from all the uploaded files, below the capacity plan charts:
//   Sales pipeline   (SFDC)          open pipeline by stage, revenue outlook, largest open opportunities
//   Resources        (latest review) people becoming available against pipeline demand, bench risk by role
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
import type { ChartFormat } from "../charts/chartMath";
import type { DashboardInsights, SalesPipeline, ResourceOutlook, Utilisation, Workforce } from "./insightTypes";

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
        Charts from the uploaded files (sales pipeline, roll-offs, utilisation) appear once a UR report, staff list or
        SFDC pipeline has been uploaded.
      </p>
    );

  return (
    <>
      {data.pipeline && <PipelineSection pipeline={data.pipeline} />}
      {data.resources && <ResourceSection resources={data.resources} />}
      {data.utilisation && <UtilisationSection utilisation={data.utilisation} />}
      {data.workforce && <WorkforceSection workforce={data.workforce} />}
      {data.notes.length > 0 && <p className="note dashboard-banner">Not shown yet: {data.notes.join("; ")}.</p>}
    </>
  );
}

function PipelineSection({ pipeline }: { pipeline: SalesPipeline }) {
  const k = pipeline.kpis;
  const stages = pipeline.byStage;
  const revenue = pipeline.revenueByMonth;
  return (
    <section className="dashboard-section">
      <h2 className="dashboard-heading">Sales pipeline (SFDC)</h2>
      <div className="stats">
        <Stat value={show(k.openCount, "int")} label="Open opportunities" />
        <Stat value={show(k.openTcv, "usdCompact")} label="Open pipeline TCV" />
        <Stat value={show(k.openWeightedTcv, "usdCompact")} label="Weighted by probability" />
        <Stat value={show(k.winRate, "pct0")} label={`Win rate, last 12 months (${k.closedLast12m} closed)`} />
        <Stat value={show(k.wonTcvLast12m, "usdCompact")} label="Won TCV, last 12 months" />
      </div>
      <div className="chart-grid">
        <ChartCard
          title="Open pipeline by stage"
          subtitle="Total contract value per stage; the dark part is what the stage's win probability makes likely."
          legend={[
            { name: "Weighted (TCV × probability)", color: BLUE },
            { name: "Rest of TCV", color: GREY },
          ]}
        >
          <BarChart
            categories={stages.map((s) => `${s.stage.slice(0, 2)} (${s.count})`)}
            notes={stages.map((s) => s.stage)}
            format="usdCompact"
            ariaLabel="Stacked bar chart of open pipeline value by stage, weighted part and rest"
            series={[
              { name: "Weighted", values: stages.map((s) => s.weightedTcv), color: BLUE },
              { name: "Rest of TCV", values: stages.map((s) => Math.max(0, s.tcv - s.weightedTcv)), color: GREY },
            ]}
          />
        </ChartCard>

        <ChartCard
          title="Revenue outlook"
          subtitle="Forecast revenue per month in SFDC: signed (Closed Won) plus open opportunities weighted by probability. Compare with the capacity plan's revenue."
          legend={[
            { name: "Signed (Closed Won)", color: BLUE },
            { name: "Open, weighted", color: TEAL },
          ]}
        >
          <BarChart
            categories={revenue.map((r) => monthLabel(r.month))}
            notes={revenue.map((r) => `Open pipeline unweighted: ${formatChartValue(r.open, "usdCompact")}`)}
            format="usdCompact"
            ariaLabel="Stacked bar chart of signed and probability-weighted open revenue by month"
            series={[
              { name: "Signed", values: revenue.map((r) => r.booked), color: BLUE },
              { name: "Open, weighted", values: revenue.map((r) => r.openWeighted), color: TEAL },
            ]}
          />
        </ChartCard>

        <ChartCard wide title="Largest open opportunities" subtitle="By probability-weighted contract value.">
          <div className="insight-table-wrap">
            <table className="review-table insight-table">
              <thead>
                <tr>
                  <th scope="col">Opportunity</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Stage</th>
                  <th scope="col" className="num">Probability</th>
                  <th scope="col" className="num">TCV</th>
                  <th scope="col" className="num">Weighted</th>
                  <th scope="col">Expected close</th>
                  <th scope="col">Offering</th>
                </tr>
              </thead>
              <tbody>
                {pipeline.topOpen.map((o) => (
                  <tr key={o.crmId}>
                    <td>
                      {o.name}
                      <span className="insight-sub">{o.crmId}</span>
                    </td>
                    <td>{o.customer ?? "–"}</td>
                    <td>{o.stage}</td>
                    <td className="num">{show(o.probability, "pct0")}</td>
                    <td className="num">{show(o.tcv, "usdCompact")}</td>
                    <td className="num">{show(o.weightedTcv, "usdCompact")}</td>
                    <td>{monthLabel(o.expectedClose)}</td>
                    <td>{o.offering ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>
      </div>
    </section>
  );
}

function ResourceSection({ resources }: { resources: ResourceOutlook }) {
  const rolls = resources.rollOffs ?? [];
  const bench = resources.benchRisk ?? [];
  return (
    <section className="dashboard-section">
      <h2 className="dashboard-heading">
        Resource supply and demand
        {resources.run.asOf && <span className="kpi-asof"> · from the review planned as of {monthLabel(resources.run.asOf.slice(0, 7))}</span>}
      </h2>
      <div className="chart-grid">
        {rolls.length > 0 && (
          <ChartCard
            title="People becoming available vs pipeline demand"
            subtitle="Per month: people whose project ends (and who would also be free if fiscal-year-end plans are not renewed), against new demand from accepted pipeline opportunities and how much of it was matched."
            legend={[
              { name: "Project ends", color: BLUE },
              { name: "If not renewed at FY end", color: GREY },
              { name: "Pipeline demand", color: ORANGE },
              { name: "Matched", color: TEAL },
            ]}
          >
            <LineChart
              categories={rolls.map((r) => monthLabel(r.month))}
              format="int"
              zeroBaseline
              ariaLabel="Line chart of people becoming available and pipeline demand by month"
              series={[
                { name: "Project ends", values: rolls.map((r) => r.available), color: BLUE },
                { name: "If not renewed at FY end", values: rolls.map((r) => r.availableIfNotRenewed), color: GREY, dashed: true },
                { name: "Pipeline demand", values: rolls.map((r) => r.pipelineDemand), color: ORANGE },
                { name: "Matched", values: rolls.map((r) => r.matched), color: TEAL },
              ]}
            />
          </ChartCard>
        )}
        {bench.length > 0 && (
          <ChartCard
            title="Bench risk by role"
            subtitle={`People free now or within 6 months that no demand is matched to: ${resources.benchRiskTotal ?? 0} in total. The ${bench.length} largest roles.`}
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
      </div>
    </section>
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
    <section className="dashboard-section">
      <h2 className="dashboard-heading">Utilisation (UR report)</h2>
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
    </section>
  );
}

function WorkforceSection({ workforce }: { workforce: Workforce }) {
  return (
    <section className="dashboard-section">
      <h2 className="dashboard-heading">Workforce (staff list)</h2>
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
    </section>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
