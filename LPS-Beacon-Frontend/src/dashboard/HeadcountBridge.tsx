// src/dashboard/HeadcountBridge.tsx
// A waterfall for one fiscal quarter (3 Nov instructions 9.4 F, the proposed reading: open question #19): opening
// headcount, + joiners, − leavers, closing headcount; the note under it splits the closing headcount into billable and
// bench (non-billable). From the capacity plan's quarter columns, so typed-over joiners and leavers show here too.

import { useState } from "react";
import type { CapacityPlan } from "../api/types";
import { fmt } from "../analysis/baseline";

export default function HeadcountBridge({ plan, fy }: { plan: CapacityPlan; fy: string }) {
  const quarters = ["Q1", "Q2", "Q3", "Q4"].map((q) => `${q}'${fy.slice(2)}`);
  const lastActual = [...(plan.months ?? [])].reverse().find((m) => m.actual);
  const monthQ = lastActual ? { 4: 1, 5: 1, 6: 1, 7: 2, 8: 2, 9: 2, 10: 3, 11: 3, 12: 3, 1: 4, 2: 4, 3: 4 }[Number(lastActual.month.slice(5, 7))] : 1;
  const [q, setQ] = useState(quarters[(monthQ ?? 1) - 1]);
  const v = plan.values;
  const opening = v["current-hc"]?.[q] ?? 0;
  const joiners = v["joiners"]?.[q] ?? 0;
  const leavers = v["leavers"]?.[q] ?? 0;
  const closing = v["ending-hc"]?.[q] ?? 0;
  const lastMonthKey = (plan.months ?? []).filter((m) => m.fiscalYear === fy).map((m) => m.key)
    .filter((k) => {
      const n = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"].indexOf(k.slice(0, 3));
      return Math.floor(n / 3) + 1 === Number(q[1]);
    })
    .pop();
  const billable = lastMonthKey ? v["billable-hc"]?.[lastMonthKey] ?? 0 : 0;
  const bench = closing - billable;

  const steps = [
    { label: "Opening", from: 0, to: opening, kind: "total" },
    { label: "+ Joiners", from: opening, to: opening + joiners, kind: "up" },
    { label: "− Leavers", from: opening + joiners, to: opening + joiners - leavers, kind: "down" },
    { label: "Closing", from: 0, to: closing, kind: "total" },
  ];
  const hi = Math.max(...steps.map((s) => Math.max(s.from, s.to))) * 1.04 || 1;
  const lo = Math.min(...steps.filter((s) => s.kind !== "total").map((s) => Math.min(s.from, s.to)), opening) * 0.9;
  const W = 560, H = 260, top = 24, bottom = 40, left = 16, gap = 18;
  const bw = (W - left * 2 - gap * (steps.length - 1)) / steps.length;
  const y = (val: number) => top + (1 - (val - lo) / (hi - lo)) * (H - top - bottom);

  return (
    <div className="bridge">
      <div className="bridge-head">
        <div className="segmented" role="group" aria-label="Quarter">
          {quarters.map((k) => (
            <button key={k} type="button" className={k === q ? "on" : ""} aria-pressed={k === q} onClick={() => setQ(k)}>
              {k}
            </button>
          ))}
        </div>
        <span className="note">Proposed reading, to confirm with Ethan (open question #19). The axis starts at {fmt.int(lo)}.</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="bridge-svg" role="img"
        aria-label={`Headcount waterfall for ${q}: opening ${opening}, joiners ${joiners}, leavers ${leavers}, closing ${closing}`}>
        {steps.map((s, i) => {
          const x = left + i * (bw + gap);
          const a = Math.max(s.from, lo);
          const b = Math.max(s.to, lo);
          const yTop = y(Math.max(a, b));
          const h = Math.max(2, Math.abs(y(a) - y(b)));
          const value = s.kind === "up" ? joiners : s.kind === "down" ? leavers : s.to;
          return (
            <g key={s.label}>
              <rect x={x} y={yTop} width={bw} height={h} rx={3} className={`bridge-bar ${s.kind}`} />
              <text x={x + bw / 2} y={yTop - 6} textAnchor="middle" className="bridge-value">
                {s.kind === "up" ? "+" : s.kind === "down" ? "−" : ""}
                {fmt.int(value)}
              </text>
              <text x={x + bw / 2} y={H - 16} textAnchor="middle" className="bridge-label">
                {s.label}
              </text>
              {i < 3 && (
                <line x1={x + bw} x2={x + bw + gap} y1={y(s.to)} y2={y(s.to)} className="bridge-link" />
              )}
            </g>
          );
        })}
      </svg>
      <p className="note">
        {q}: opening headcount {fmt.int(opening)}, {fmt.int(joiners)} joined, {fmt.int(leavers)} left, closing {fmt.int(closing)}.
        At the end of the quarter {fmt.int(billable)} are billable and {fmt.int(bench)} on the bench (headcount × billable UR).
        Joiners and leavers come from the Workday reports; forecast months show only joiners typed into the capacity plan (unfilled demand is not counted).
      </p>
    </div>
  );
}
