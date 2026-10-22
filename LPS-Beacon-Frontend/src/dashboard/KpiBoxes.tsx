// src/dashboard/KpiBoxes.tsx
// The number boxes at the top of the Dashboard, all for the current month: headcount (from the HR headcount file),
// split into permanent staff and secondment, and average billable UR and gross margin (from the capacity plan).

import { useEffect, useState } from "react";
import { getHeadcountBreakdown } from "../api/client";
import type { CapacityPlan, HeadcountBreakdown } from "../api/types";
import { useAuth } from "../auth/useAuth";
import { formatChartValue } from "../charts/chartMath";
import type { ChartFormat } from "../charts/chartMath";
import { CURRENT_MONTH, MONTH_LABELS, monthSeries } from "./planSeries";

const show = (v: number | null | undefined, f: ChartFormat) => (v === null || v === undefined ? "–" : formatChartValue(v, f));

export default function KpiBoxes({ plan }: { plan: CapacityPlan | null }) {
  const { token } = useAuth();
  const [hc, setHc] = useState<HeadcountBreakdown | null>(null);
  const [hcError, setHcError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getHeadcountBreakdown(token ?? undefined)
      .then((d) => {
        if (!cancelled) setHc(d);
      })
      .catch((err) => {
        if (!cancelled) setHcError(err instanceof Error ? err.message : "Could not load today's headcount.");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const monthLabel = CURRENT_MONTH === null ? "current month" : MONTH_LABELS[CURRENT_MONTH];
  const atNow = (id: string) => (plan && CURRENT_MONTH !== null ? monthSeries(plan, id)[CURRENT_MONTH] : null);

  const p = hc?.permanent;
  const permanent = p ? p.regular + p.supplementalOther + p.supplementalRetiree : null;
  const secondment = hc ? hc.secondment : null;
  const total = permanent !== null && secondment !== null ? permanent + secondment : null;
  const asOf = hc ? new Date(hc.asOf).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null;

  const figures: { value: string; label: string }[] = [
    { value: show(total, "int"), label: "Total headcount" },
    { value: show(permanent, "int"), label: "Permanent staff" },
    { value: show(secondment, "int"), label: "Secondment" },
    { value: show(atNow("billable-ur"), "pct1"), label: "Billable UR" },
    { value: show(atNow("gross-margin-pct"), "pct1"), label: "Gross margin" },
  ];

  return (
    <section className="kpi-summary" aria-labelledby="kpi-summary-title">
      <div className="kpi-summary-head">
        <h2 id="kpi-summary-title" className="kpi-summary-title">
          This month <span className="kpi-summary-month">{monthLabel}</span>
        </h2>
        {asOf && <span className="kpi-summary-asof">Headcount as of {asOf}</span>}
      </div>

      {hcError && (
        <p className="error-banner dashboard-banner" role="alert">
          {hcError}
        </p>
      )}

      <dl className="kpi-row">
        {figures.map((f) => (
          <div key={f.label} className="kpi">
            <dt className="kpi-label">{f.label}</dt>
            <dd className="kpi-value">{f.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
