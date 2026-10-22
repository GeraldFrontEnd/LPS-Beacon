// src/dashboard/KpiBoxes.tsx
// The number boxes at the top of the Dashboard, all for the current month: headcount (from the HR headcount file),
// split into permanent staff and secondment, and average billable UR and gross margin (from the capacity plan).

import { useEffect, useState } from "react";
import { getHeadcountBreakdown } from "../api/client";
import DashboardSection from "./DashboardSection";
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

  return (
    <DashboardSection
      id="this-month"
      title={`This month, ${monthLabel}`}
      aside={asOf && <span className="kpi-asof"> · headcount as of {asOf}</span>}
    >
      {hcError && (
        <p className="error-banner dashboard-banner" role="alert">
          {hcError}
        </p>
      )}

      <div className="stats">
        <div className="stat">
          <div className="stat-value">{show(total, "int")}</div>
          <div className="stat-label">Total headcount</div>
        </div>
        <div className="stat">
          <div className="stat-value">{show(permanent, "int")}</div>
          <div className="stat-label">Permanent staff</div>
        </div>
        <div className="stat">
          <div className="stat-value">{show(secondment, "int")}</div>
          <div className="stat-label">Secondment</div>
        </div>
        <div className="stat">
          <div className="stat-value">{show(atNow("billable-ur"), "pct1")}</div>
          <div className="stat-label">Average billable UR</div>
        </div>
        <div className="stat">
          <div className="stat-value">{show(atNow("gross-margin-pct"), "pct1")}</div>
          <div className="stat-label">Gross margin</div>
        </div>
      </div>
    </DashboardSection>
  );
}
