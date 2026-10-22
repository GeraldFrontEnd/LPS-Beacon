// src/dashboard/CapacityCharts.tsx
// The charts built from the capacity plan. They only read numbers from the plan and never change them.

import { useEffect, useState } from "react";
import { BANDS, rowId } from "../analysis/capacityPlanLayout";
import { getCapacityPlan } from "../api/client";
import type { CapacityPlan } from "../api/types";
import { useAuth } from "../auth/useAuth";
import BarChart from "../charts/BarChart";
import ChartCard from "../charts/ChartCard";
import Heatmap from "../charts/Heatmap";
import LineChart from "../charts/LineChart";
import BandPicker from "./BandPicker";
import DashboardSection from "./DashboardSection";
import SectionControls from "./SectionControls";
import KpiBoxes from "./KpiBoxes";
import { isUrFlagged, urTargetsOf } from "./flagRules";
import { MONTH_LABELS, actualMask, forecastFrom, monthNotes, monthSeries } from "./planSeries";

// The colours live in index.css (--chart-*, --band-* and --flag).
const BLUE = "var(--chart-1)";
const ORANGE = "var(--chart-2)";
const TEAL = "var(--chart-3)";
const GREY = "var(--chart-4)";
const FLAG = "var(--flag)";
// Keyed by band id, so a band keeps its colour when others are hidden.
const BAND_COLORS: Record<string, string> = Object.fromEntries(BANDS.map((b) => [b.id, `var(--band-${b.id.slice(1)})`]));
const ALL_BAND_IDS = BANDS.map((b) => b.id);

export default function CapacityCharts() {
  const { token } = useAuth();
  const [plan, setPlan] = useState<CapacityPlan | null>(null); // null = still loading
  const [error, setError] = useState<string | null>(null);
  // Which bands each band chart shows.
  const [hcBands, setHcBands] = useState<string[]>(ALL_BAND_IDS);
  const [urBands, setUrBands] = useState<string[]>(ALL_BAND_IDS);

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
  const hasPlan = Object.keys(plan.values).length > 0;
  if (!hasPlan) {
    return (
      <>
        <KpiBoxes plan={null} />
        <SectionControls />
        <p className="note">
          No capacity plan has been generated yet. The charts will appear once the system has processed the uploaded files.
        </p>
      </>
    );
  }

  const common = { categories: MONTH_LABELS, notes: monthNotes(plan), forecastFrom: forecastFrom(plan) };
  const urTargets = urTargetsOf(plan);
  const actualMonths = actualMask(plan);
  const shownHcBands = BANDS.filter((b) => hcBands.includes(b.id));
  const shownUrBands = BANDS.filter((b) => urBands.includes(b.id));

  const revenue = monthSeries(plan, "revenue");
  const cost = monthSeries(plan, "resource-cost");
  const costOverRevenue = revenue.map((r, i) => r !== null && cost[i] !== null && cost[i]! > r);

  // Row 0 of the heat map is "All bands", then the chosen bands.
  const urRowBandIds = ["all", ...shownUrBands.map((b) => b.id)];

  return (
    <>
      <KpiBoxes plan={plan} />
      <SectionControls />

      <DashboardSection id="capacity-plan" title="Capacity plan">

        <div className="chart-grid">
          <ChartCard title="Headcount outlook" subtitle="Ending headcount at the end of each month." legend={[{ name: "Ending headcount", color: BLUE }]}>
            <LineChart
              {...common}
              format="int"
              ariaLabel="Line chart of ending headcount by month"
              series={[{ name: "Ending headcount", values: monthSeries(plan, "ending-hc"), color: BLUE }]}
            />
          </ChartCard>

          <ChartCard
            title="Headcount by band"
            subtitle="Ending headcount, stacked by band."
            legend={shownHcBands.map((b) => ({ name: b.label, color: BAND_COLORS[b.id] }))}
            actions={<BandPicker selected={hcBands} onChange={setHcBands} />}
          >
            <BarChart
              {...common}
              format="int"
              ariaLabel="Stacked bar chart of ending headcount by band and month"
              series={shownHcBands.map((b) => ({
                name: b.label,
                values: monthSeries(plan, rowId("ending-hc", b.id)),
                color: BAND_COLORS[b.id],
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
            subtitle="Revenue is the figure entered by finance. A warning sign marks months where resource cost is higher than revenue."
            legend={[
              { name: "Revenue", color: BLUE },
              { name: "Resource cost", color: ORANGE },
              { name: "Cost exceeds revenue", color: FLAG },
            ]}
          >
            <LineChart
              {...common}
              format="usd"
              axisFormat="usdCompact"
              zeroBaseline
              flags={costOverRevenue}
              flagText="Resource cost exceeds revenue"
              ariaLabel="Line chart of revenue and resource cost by month, with months where cost exceeds revenue flagged"
              series={[
                { name: "Revenue", values: revenue, color: BLUE },
                { name: "Resource cost", values: cost, color: ORANGE },
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

          <ChartCard
            wide
            title="Billable utilisation by band"
            subtitle="Billable UR per band. Actual months are red when below target (All bands: the overall target; each band: its own). Forecast months show the targets."
            actions={<BandPicker selected={urBands} onChange={setUrBands} />}
          >
            <Heatmap
              columns={MONTH_LABELS}
              forecastFrom={common.forecastFrom}
              rowLabels={["All bands", ...shownUrBands.map((b) => b.label)]}
              values={[monthSeries(plan, "billable-ur"), ...shownUrBands.map((b) => monthSeries(plan, rowId("billable-ur", b.id)))]}
              format="pct0"
              domain={[0.5, 1]}
              isFlagged={(row, v, col) => isUrFlagged(urRowBandIds[row], v, urTargets, actualMonths[col])}
              flagText="Actual below target"
              ariaLabel="Heat map of billable utilisation by band and month, with cells outside the target range in red"
            />
          </ChartCard>
        </div>
      </DashboardSection>
    </>
  );
}
