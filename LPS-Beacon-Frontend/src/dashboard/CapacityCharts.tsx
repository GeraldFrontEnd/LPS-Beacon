// src/dashboard/CapacityCharts.tsx
// The charts built from the capacity plan. They only read numbers from the plan and never change them.

import { useEffect, useState } from "react";
import { BANDS, MONTH_COLUMNS, isActualColumn, rowId } from "../analysis/capacityPlanLayout";
import { getCapacityPlan } from "../api/client";
import type { CapacityPlan } from "../api/types";
import { useAuth } from "../auth/useAuth";
import BarChart from "../charts/BarChart";
import ChartCard from "../charts/ChartCard";
import Heatmap from "../charts/Heatmap";
import LineChart from "../charts/LineChart";
import { formatChartValue } from "../charts/chartMath";
import type { ChartFormat } from "../charts/chartMath";
import { FORECAST_FROM, MONTH_LABELS, MONTH_NOTES, monthSeries } from "./planSeries";

// The colours live in index.css (--chart-* and --band-*).
const BLUE = "var(--chart-1)";
const ORANGE = "var(--chart-2)";
const TEAL = "var(--chart-3)";
const GREY = "var(--chart-4)";
const BAND_COLORS = ["var(--band-9)", "var(--band-8)", "var(--band-7)", "var(--band-6)", "var(--band-5)", "var(--band-4)", "var(--band-3)"];

// The month the financial year (FY'26) ends in; used for the "headcount at year end" box.
const FY_END_KEY = "Mar'27";

// The number boxes at the top: single cells read straight from the plan.
function KpiBoxes({ plan }: { plan: CapacityPlan }) {
  let latest = -1; // the last month marked "Actual" that has a headcount
  MONTH_COLUMNS.forEach((c, i) => {
    if (isActualColumn(c) && plan.values["ending-hc"]?.[c.key] != null) latest = i;
  });
  const at = (id: string, i: number) => (i < 0 ? null : monthSeries(plan, id)[i]);
  const show = (v: number | null, f: ChartFormat) => (v === null ? "–" : formatChartValue(v, f));

  const latestLabel = latest < 0 ? "latest actual" : MONTH_LABELS[latest];
  const endIndex = MONTH_COLUMNS.findIndex((c) => c.key === FY_END_KEY);
  const now = at("ending-hc", latest);
  const end = at("ending-hc", endIndex);
  const delta = now !== null && end !== null ? end - now : null;

  return (
    <div className="stats">
      <div className="stat">
        <div className="stat-value">{show(now, "int")}</div>
        <div className="stat-label">Headcount, {latestLabel}</div>
      </div>
      <div className="stat">
        <div className="stat-value">{show(end, "int")}</div>
        <div className="stat-label">
          Headcount, {FY_END_KEY}
          {delta !== null && ` (${delta > 0 ? "+" : ""}${formatChartValue(delta, "int")} vs ${latestLabel})`}
        </div>
      </div>
      <div className="stat">
        <div className="stat-value">{show(at("billable-ur", latest), "pct1")}</div>
        <div className="stat-label">Billable utilisation, {latestLabel}</div>
      </div>
      <div className="stat">
        <div className="stat-value">{show(at("gross-margin-pct", latest), "pct1")}</div>
        <div className="stat-label">Gross margin, {latestLabel}</div>
      </div>
    </div>
  );
}

export default function CapacityCharts() {
  const { token } = useAuth();
  const [plan, setPlan] = useState<CapacityPlan | null>(null); // null = still loading
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCapacityPlan(token ?? undefined)
      .then((data) => {
        if (!cancelled) setPlan(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the capacity plan.");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (error) {
    return (
      <p className="error-banner dashboard-banner" role="alert">
        {error}
      </p>
    );
  }
  if (!plan) return <p className="note">Loading the capacity plan…</p>;
  if (Object.keys(plan.values).length === 0) {
    return (
      <p className="note">
        No capacity plan has been generated yet. The charts will appear once the system has processed the uploaded files.
      </p>
    );
  }

  const bandLegend = BANDS.map((b, i) => ({ name: b.label, color: BAND_COLORS[i] }));
  const common = { categories: MONTH_LABELS, notes: MONTH_NOTES, forecastFrom: FORECAST_FROM };

  return (
    <section className="dashboard-section">
      <h2 className="dashboard-heading">Capacity plan</h2>
      <KpiBoxes plan={plan} />

      <div className="chart-grid">
        <ChartCard title="Headcount outlook" subtitle="Ending headcount at the end of each month." legend={[{ name: "Ending headcount", color: BLUE }]}>
          <LineChart
            {...common}
            format="int"
            ariaLabel="Line chart of ending headcount by month"
            series={[{ name: "Ending headcount", values: monthSeries(plan, "ending-hc"), color: BLUE }]}
          />
        </ChartCard>

        <ChartCard title="Headcount by band" subtitle="Ending headcount, stacked by band." legend={bandLegend}>
          <BarChart
            {...common}
            format="int"
            ariaLabel="Stacked bar chart of ending headcount by band and month"
            series={BANDS.map((b, i) => ({
              name: b.label,
              values: monthSeries(plan, rowId("ending-hc", b.id)),
              color: BAND_COLORS[i],
            }))}
          />
        </ChartCard>

        <ChartCard
          title="Joiners and leavers"
          subtitle="Hires above the line, leavers below it. This is headcount movement, not project roll-on and roll-off."
          legend={[
            { name: "Joiners", color: TEAL },
            { name: "Leavers", color: ORANGE },
          ]}
        >
          <BarChart
            {...common}
            format="int"
            ariaLabel="Bar chart of joiners above and leavers below zero by month"
            series={[
              { name: "Joiners", values: monthSeries(plan, "joiners"), color: TEAL },
              { name: "Leavers", values: monthSeries(plan, "leavers"), color: ORANGE, down: true },
            ]}
          />
        </ChartCard>

        <ChartCard
          title="Billable and non-billable headcount"
          subtitle="The non-billable part is the bench."
          legend={[
            { name: "Billable", color: BLUE },
            { name: "Non-billable", color: GREY },
          ]}
        >
          <BarChart
            {...common}
            format="int"
            ariaLabel="Stacked bar chart of billable and non-billable headcount by month"
            series={[
              { name: "Billable", values: monthSeries(plan, "billable-hc"), color: BLUE },
              { name: "Non-billable", values: monthSeries(plan, "non-billable-hc"), color: GREY },
            ]}
          />
        </ChartCard>

        <ChartCard
          title="Revenue and resource cost"
          subtitle="Revenue is the figure entered by finance. Capacity revenue is what the billable headcount could earn (the plan's “Revenue per FTE” rows)."
          legend={[
            { name: "Revenue", color: BLUE },
            { name: "Capacity revenue", color: TEAL },
            { name: "Resource cost", color: ORANGE },
          ]}
        >
          <LineChart
            {...common}
            format="usd"
            axisFormat="usdCompact"
            zeroBaseline
            ariaLabel="Line chart of revenue, capacity revenue and resource cost by month"
            series={[
              { name: "Revenue", values: monthSeries(plan, "revenue"), color: BLUE },
              { name: "Capacity revenue", values: monthSeries(plan, "revenue-per-fte"), color: TEAL, dashed: true },
              { name: "Resource cost", values: monthSeries(plan, "resource-cost"), color: ORANGE },
            ]}
          />
        </ChartCard>

        <ChartCard title="Gross margin %" subtitle="Gross margin as a share of revenue." legend={[{ name: "Gross margin %", color: BLUE }]}>
          <LineChart
            {...common}
            format="pct1"
            axisFormat="pct0"
            ariaLabel="Line chart of gross margin percentage by month"
            series={[{ name: "Gross margin %", values: monthSeries(plan, "gross-margin-pct"), color: BLUE }]}
          />
        </ChartCard>

        <ChartCard wide title="Billable utilisation by band" subtitle="Share of each band's headcount that is billable. Darker means more utilised.">
          <Heatmap
            columns={MONTH_LABELS}
            forecastFrom={FORECAST_FROM}
            rowLabels={["All bands", ...BANDS.map((b) => b.label)]}
            values={[monthSeries(plan, "billable-ur"), ...BANDS.map((b) => monthSeries(plan, rowId("billable-ur", b.id)))]}
            format="pct0"
            domain={[0.5, 1]}
            ariaLabel="Heat map of billable utilisation by band and month"
          />
        </ChartCard>
      </div>
    </section>
  );
}
