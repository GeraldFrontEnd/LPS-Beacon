// src/dashboard/ProductivityChart.tsx
// "How productive are we?" on the Dashboard (3 Nov instructions 9.4 G):
//  - Revenue per FTE (or GP per FTE) by agency as bars, with the company average as a dotted line. Bars below the line
//    are red. The agency picked in the Dashboard filter is outlined.
//  - "What if we hire N more?": Revenue per HC now, after N non-billable hires (revenue ÷ (HC + N)) and after N billable
//    hires (revenue + N × what one FTE brings in a year) ÷ (HC + N), for the organisation or the agency picked.

import { useState } from "react";
import type { CapacityPlan } from "../api/types";
import { fmt, fteRequired, latestActual, thisYearBaseline, weightedIRate } from "../analysis/baseline";

type Metric = "revenuePerFte" | "gpPerFte";
const MAX_BARS = 15;

export default function ProductivityChart({ plan, fy, agency }: { plan: CapacityPlan; fy: string; agency: string | null }) {
  const [metric, setMetric] = useState<Metric>("revenuePerFte");
  const [hires, setHires] = useState("2");
  const p = plan.productivity;
  if (!p) return <p className="note">Appears once an ABCD report with actual months and an SL x RP file are uploaded.</p>;

  const avg = p.companyAverage[metric];
  const flagged = p.agencies.filter((a) => a.fte >= p.rules.minFte && a.revenue > 0 && a[metric] !== null);
  let bars = [...flagged].sort((a, b) => b.revenue - a.revenue).slice(0, MAX_BARS);
  const picked = agency ? flagged.find((a) => a.agency === agency) : undefined;
  if (picked && !bars.includes(picked)) bars = [...bars.slice(0, MAX_BARS - 1), picked];
  bars.sort((a, b) => (b[metric] ?? 0) - (a[metric] ?? 0));

  const values = bars.map((a) => a[metric] ?? 0);
  const lo = Math.min(0, ...values);
  const hi = Math.max(avg ?? 0, ...values) * 1.08;
  const W = 760, rowH = 26, left = 230, right = 70, top = 24;
  const H = top + bars.length * rowH + 10;
  const x = (v: number) => left + ((v - lo) / (hi - lo || 1)) * (W - left - right);

  // What-if: the organisation, or the agency picked.
  const n = Math.max(0, Math.floor(Number(hires) || 0));
  const base = thisYearBaseline(plan, fy);
  const last = latestActual(plan);
  const t = plan.settings?.[fy]?.target;
  const annual = 12 / p.months.length;
  const scope = picked
    ? { label: picked.agency, revenue: picked.revenue * annual, heads: picked.fte, rate: picked.ratePerDay, unit: "FTE" }
    : base
      ? { label: "the organisation", revenue: base.revenue, heads: base.headcount,
          rate: last ? weightedIRate(plan, last.key, fy) : null, unit: "HC" }
      : null;
  const perFteYear = scope?.rate && t
    ? fteRequired({ annualRevenue: 1, gpPct: t.gpPct, ur: t.billableUr, manDaysPerFte: t.manDaysPerFte ?? 18,
        manDaysAreBillable: true, iRate: scope.rate })?.revenuePerFteYear ?? null
    : null;
  const now = scope && scope.heads ? scope.revenue / scope.heads : null;
  const costOnly = scope && scope.heads + n ? scope.revenue / (scope.heads + n) : null;
  const billable = scope && perFteYear !== null && scope.heads + n ? (scope.revenue + n * perFteYear) / (scope.heads + n) : null;

  return (
    <div className="prodchart">
      <div className="prodchart-main">
        <div className="prodchart-head">
          <div className="segmented" role="group" aria-label="Measure">
            <button type="button" className={metric === "revenuePerFte" ? "on" : ""} aria-pressed={metric === "revenuePerFte"}
              onClick={() => setMetric("revenuePerFte")}>
              Revenue per FTE
            </button>
            <button type="button" className={metric === "gpPerFte" ? "on" : ""} aria-pressed={metric === "gpPerFte"}
              onClick={() => setMetric("gpPerFte")}>
              GP per FTE
            </button>
          </div>
          <span className="prodchart-legend">
            <span className="legend-dash" /> company average {fmt.usdK(avg)} <span className="legend-swatch below" /> below
            <span className="legend-swatch above" /> at or above
          </span>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="prodchart-svg" role="img"
          aria-label={`Bar chart of ${metric === "revenuePerFte" ? "revenue" : "GP"} per FTE by agency against the company average`}>
          {bars.map((a, i) => {
            const v = a[metric] ?? 0;
            const y = top + i * rowH;
            const below = avg !== null && v < avg;
            return (
              <g key={a.agency}>
                <title>{`${a.agency}: ${fmt.usdK(v)} (${fmt.dec1(a.fte)} FTE, ${fmt.usdM(a.revenue)} revenue to date)`}</title>
                <text x={left - 10} y={y + rowH / 2 + 4} textAnchor="end" className="prodchart-label">
                  {a.agency.length > 30 ? `${a.agency.slice(0, 29)}…` : a.agency}
                </text>
                <rect x={Math.min(x(0), x(v))} y={y + 4} width={Math.abs(x(v) - x(0))} height={rowH - 8} rx={3}
                  className={`prodchart-bar ${below ? "below" : "above"}${a.agency === agency ? " picked" : ""}`} />
                <text x={Math.max(x(0), x(v)) + 6} y={y + rowH / 2 + 4} className="prodchart-value">{fmt.usdK(v)}</text>
              </g>
            );
          })}
          {avg !== null && (
            <g>
              <line x1={x(avg)} x2={x(avg)} y1={top - 8} y2={H - 4} className="prodchart-baseline" />
              <text x={x(avg)} y={top - 12} textAnchor="middle" className="prodchart-baseline-text">company average</text>
            </g>
          )}
        </svg>
        <p className="note">
          The {bars.length} agencies with the most revenue to date{picked && !bars.slice(0, -1).includes(picked) ? ", plus the one picked" : ""};
          per-FTE figures are yearly rates. The full list is on the Analysis page.
        </p>
      </div>

      <div className="whatif">
        <h4>What if we hire more?</h4>
        <p className="note">For {scope?.label ?? "the organisation"}{agency && !picked ? " (the agency picked is too small to rate)" : ""}.</p>
        <label className="whatif-input">
          Hire
          <input inputMode="numeric" value={hires} onChange={(e) => setHires(e.target.value)} />
          more people
        </label>
        <dl className="whatif-rows">
          <div>
            <dt>Revenue per {scope?.unit ?? "HC"} now</dt>
            <dd>{fmt.usdK(now)}</dd>
          </div>
          <div>
            <dt>If they are not billable</dt>
            <dd className={costOnly !== null && now !== null && costOnly < now ? "down" : undefined}>{fmt.usdK(costOnly)}</dd>
          </div>
          <div>
            <dt>If they are billable at the target GP</dt>
            <dd className={billable !== null && now !== null ? (billable < now ? "down" : "up") : undefined}>{fmt.usdK(billable)}</dd>
          </div>
        </dl>
        <details className="prod-formula">
          <summary>How this is worked out</summary>
          <ul>
            <li>Now: yearly revenue {fmt.usdM(scope?.revenue)} ÷ {fmt.dec1(scope?.heads)} {scope?.unit ?? "HC"}.</li>
            <li>Not billable: the same revenue ÷ ({fmt.dec1(scope?.heads)} + {n}).</li>
            <li>
              Billable: (revenue + {n} × {fmt.usd(perFteYear)}) ÷ ({fmt.dec1(scope?.heads)} + {n}), where {fmt.usd(perFteYear)} is
              what one FTE brings in a year (12 × 18 man-days × iRate ÷ (1 − GP %)).
            </li>
            <li>Whether new hires count as billable is open question #20.</li>
          </ul>
        </details>
      </div>
    </div>
  );
}
