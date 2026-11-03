// src/dashboard/DemandCapacity.tsx
// Demand vs capacity by month. Organisation: headcount against the FTE demand on won and ongoing work (SL x RP Project
// and Quote Won rows), so the bench or the shortage shows. Agency or project picked: its FTE demand and the people
// planned on it. Resource plans mostly stop at the fiscal year end, so the chart stops where demand falls away.

import { MONTH_COLUMNS } from "../analysis/capacityPlanLayout";
import type { CapacityPlan, DashboardView } from "../api/types";
import ChartCard from "../charts/ChartCard";
import LineChart from "../charts/LineChart";
import { MONTH_LABELS, forecastFrom, monthNotes, monthSeries } from "./planSeries";

const BLUE = "var(--chart-1)";
const ORANGE = "var(--chart-2)";

export default function DemandCapacity({ plan, view }: { plan: CapacityPlan; view: DashboardView | null }) {
  const ymOf = Object.fromEntries((plan.months ?? []).map((m) => [m.key, m.month]));
  const sel = view?.selection ?? null;
  const supply = sel
    ? MONTH_COLUMNS.map((c) => sel.byMonth[ymOf[c.key]]?.people ?? null)
    : monthSeries(plan, "ending-hc");
  const demand = MONTH_COLUMNS.map((c) =>
    sel ? sel.byMonth[ymOf[c.key]]?.fte ?? null : plan.demandByMonth?.[ymOf[c.key]]?.fte ?? null
  );
  const peak = Math.max(0, ...demand.map((d) => d ?? 0));
  let end = demand.length;
  while (end > 1 && (demand[end - 1] === null || (demand[end - 1] ?? 0) < peak * 0.2)) end--;
  const name = sel ? (sel.kind === "project" ? sel.name ?? sel.projectId : sel.agency) : null;

  if (!plan.demandByMonth) return <p className="note">Upload an SL x RP file to compare demand with headcount.</p>;
  return (
    <ChartCard
      wide
      title={name ? `${name}: people and FTE demand by month` : "Headcount and FTE demand by month"}
      subtitle={
        name
          ? "FTE demand on its won and ongoing work, and the people planned on it each month (someone on two projects counts in both)."
          : "FTE needed on won and ongoing projects against the headcount delivering them. Demand above headcount = short; below = bench."
      }
      legend={[
        { name: sel ? "People planned" : "Headcount", color: BLUE },
        { name: "FTE demand (won and ongoing)", color: ORANGE },
      ]}
    >
      <LineChart
        categories={MONTH_LABELS.slice(0, end)}
        notes={monthNotes(plan).slice(0, end)}
        forecastFrom={forecastFrom(plan)}
        format={sel ? "dec1" : "int"}
        axisFormat="int"
        zeroBaseline={!!sel}
        ariaLabel="Line chart of people and FTE demand by month"
        series={[
          { name: sel ? "People planned" : "Headcount", values: supply.slice(0, end), color: BLUE },
          { name: "FTE demand", values: demand.slice(0, end), color: ORANGE },
        ]}
      />
    </ChartCard>
  );
}
