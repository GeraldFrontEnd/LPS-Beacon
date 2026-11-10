// src/dashboard/CapacityCharts.tsx
// The capacity plan over the months: headcount by band, joiners and leavers, and billable UR by band. The same
// numbers as the Analysis page's table; nothing is changed here. Revenue, cost and margin moved to the productivity
// views (per HC and per FTE), which is what the 28 Oct demo asked for instead of per-band P&L charts.

import { useState } from "react";
import { BANDS, rowId } from "../analysis/capacityPlanLayout";
import type { CapacityPlan } from "../api/types";
import BarChart from "../charts/BarChart";
import ChartCard from "../charts/ChartCard";
import Heatmap from "../charts/Heatmap";
import BandPicker from "./BandPicker";
import { isUrFlagged, urTargetsOf } from "./flagRules";
import { MONTH_LABELS, actualMask, forecastFrom, monthNotes, monthSeries } from "./planSeries";

const ORANGE = "var(--chart-2)";
const TEAL = "var(--chart-3)";
// Keyed by band id, so a band keeps its colour when others are hidden.
const BAND_COLORS: Record<string, string> = Object.fromEntries(BANDS.map((b) => [b.id, `var(--band-${b.id.slice(1)})`]));
const ALL_BAND_IDS = BANDS.map((b) => b.id);

export default function CapacityCharts({ plan }: { plan: CapacityPlan }) {
  const [hcBands, setHcBands] = useState<string[]>(ALL_BAND_IDS);
  const [urBands, setUrBands] = useState<string[]>(ALL_BAND_IDS);
  const common = { categories: MONTH_LABELS, notes: monthNotes(plan), forecastFrom: forecastFrom(plan) };
  const urTargets = urTargetsOf(plan);
  const actualMonths = actualMask(plan);
  const shownHcBands = BANDS.filter((b) => hcBands.includes(b.id));
  const shownUrBands = BANDS.filter((b) => urBands.includes(b.id));
  const urRowBandIds = ["all", ...shownUrBands.map((b) => b.id)];

  return (
    <div className="chart-grid">
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
        subtitle="Hires above the line, leavers below it (Workday reports; forecast months only what is typed into the capacity plan, not unfilled demand)."
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
        wide
        title="Billable utilisation by band"
        subtitle="Actual months are red when below target (All bands: the overall target; each band: its own). Forecast months show the targets."
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
          ariaLabel="Heat map of billable utilisation by band and month, with cells below target in red"
        />
      </ChartCard>
    </div>
  );
}
