// src/dashboard/BenchView.tsx
// "Can we redeploy?" on the Dashboard (3 Nov instructions 9.4 A and E), from the published matching:
//  - Bench by quarter: for a fiscal year, how many people become free per standardised position and fiscal quarter
//    (the first day after their last planned month), not yet put on other work. Filter by band and position level.
//  - Click a position (or pick one) for the urgent-staffing list: everyone in that position, soonest free first, with
//    their current project and agency, and where the matching redeployed them, if anywhere.
// One row per resource-plan line, as the matching counts them. Names are shown: the Dashboard is finance_hr only.

import { useMemo, useState } from "react";
import type { AvailablePerson } from "./insightTypes";

const QUARTERS = ["Q1", "Q2", "Q3", "Q4"];
const QUARTER_SPAN: Record<string, string> = { Q1: "Apr–Jun", Q2: "Jul–Sep", Q3: "Oct–Dec", Q4: "Jan–Mar" };

function dateLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function BenchView({ people, asOf }: { people: AvailablePerson[]; asOf: string | null }) {
  const years = [...new Set(people.map((p) => p.fiscalYear))].sort();
  const [fy, setFy] = useState(years[0] ?? "");
  const [band, setBand] = useState("all");
  const [level, setLevel] = useState("all");
  const [showRedeployed, setShowRedeployed] = useState(false);
  const [position, setPosition] = useState<string | null>(null);

  const bands = [...new Set(people.map((p) => p.band).filter((b): b is number => b !== null))].sort((a, b) => b - a);
  const filtered = useMemo(
    () =>
      people.filter(
        (p) =>
          (band === "all" || String(p.band) === band) &&
          (level === "all" || p.level === level) &&
          (showRedeployed || !p.redeployedTo)
      ),
    [people, band, level, showRedeployed]
  );

  const inYear = filtered.filter((p) => p.fiscalYear === fy);
  const byPosition = new Map<string, Record<string, number>>();
  for (const p of inYear) {
    const key = p.position ?? "(no position)";
    const row = byPosition.get(key) ?? { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
    row[p.quarter] += 1;
    byPosition.set(key, row);
  }
  const rows = [...byPosition.entries()]
    .map(([pos, q]) => ({ pos, q, total: QUARTERS.reduce((s, k) => s + q[k], 0) }))
    .sort((a, b) => b.total - a.total);
  const totals = Object.fromEntries(QUARTERS.map((k) => [k, rows.reduce((s, r) => s + r.q[k], 0)]));

  // Urgent staffing: the position picked, soonest free first, any year.
  const positions = [...new Set(people.map((p) => p.position ?? "(no position)"))].sort();
  const list = position
    ? filtered.filter((p) => (p.position ?? "(no position)") === position).sort((a, b) => a.availableFrom.localeCompare(b.availableFrom))
    : [];
  const today = asOf ? new Date(asOf) : new Date();
  const within = (months: number) => {
    const limit = new Date(today.getFullYear(), today.getMonth() + months, today.getDate());
    return list.filter((p) => new Date(p.availableFrom) <= limit).length;
  };

  if (people.length === 0)
    return <p className="note">Appears once a matching has been published (Upload page, review, Publish).</p>;

  return (
    <div className="bench">
      <div className="bench-filters">
        <label>
          Fiscal year
          <select value={fy} onChange={(e) => setFy(e.target.value)}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label>
          Band
          <select value={band} onChange={(e) => setBand(e.target.value)}>
            <option value="all">All bands</option>
            {bands.map((b) => (
              <option key={b} value={String(b)}>
                Band {b}
              </option>
            ))}
          </select>
        </label>
        <label>
          Level
          <select value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="all">All levels</option>
            <option value="L1">L1</option>
            <option value="L2">L2</option>
            <option value="L3">L3</option>
            <option value="No level">No level</option>
          </select>
        </label>
        <label className="bench-check">
          <input type="checkbox" checked={showRedeployed} onChange={(e) => setShowRedeployed(e.target.checked)} />
          Include people already redeployed
        </label>
      </div>

      <div className="bench-grid">
        <div className="bench-table-wrap">
          <table className="bench-table">
            <thead>
              <tr>
                <th scope="col">Standardised position</th>
                {QUARTERS.map((q) => (
                  <th key={q} scope="col" className="num">
                    {q}
                    <span className="bench-span">{QUARTER_SPAN[q]}</span>
                  </th>
                ))}
                <th scope="col" className="num">{fy}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.pos} className={r.pos === position ? "picked" : undefined} onClick={() => setPosition(r.pos)}>
                  <th scope="row">
                    <button type="button" className="bench-pos" onClick={() => setPosition(r.pos)}>
                      {r.pos}
                    </button>
                  </th>
                  {QUARTERS.map((q) => (
                    <td key={q} className={`num${r.q[q] ? "" : " zero"}`}>
                      {r.q[q] || "·"}
                    </td>
                  ))}
                  <td className="num">
                    <strong>{r.total}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">All positions</th>
                {QUARTERS.map((q) => (
                  <td key={q} className="num">
                    {totals[q]}
                  </td>
                ))}
                <td className="num">
                  <strong>{rows.reduce((s, r) => s + r.total, 0)}</strong>
                </td>
              </tr>
            </tfoot>
          </table>
          {rows.length === 0 && <p className="note">Nobody becomes free in {fy} with these filters.</p>}
        </div>

        <div className="urgent">
          <h4>Who can start soonest?</h4>
          <select value={position ?? ""} onChange={(e) => setPosition(e.target.value || null)} aria-label="Standardised position">
            <option value="">Pick a standardised position…</option>
            {positions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          {position ? (
            <>
              <div className="urgent-counts">
                <span>
                  <strong>{within(0)}</strong> free now
                </span>
                <span>
                  <strong>{within(1)}</strong> in 1 month
                </span>
                <span>
                  <strong>{within(3)}</strong> in 3
                </span>
                <span>
                  <strong>{within(6)}</strong> in 6
                </span>
              </div>
              <ol className="urgent-list">
                {list.slice(0, 25).map((p, i) => (
                  <li key={`${p.resource}-${p.currentProject}-${i}`}>
                    <div className="urgent-when">{dateLabel(p.availableFrom)}</div>
                    <div className="urgent-who">
                      <strong>{p.resource ?? "–"}</strong>
                      <span className="note">
                        {" "}· Band {p.band ?? "–"}
                        {p.redeployedTo ? ` · redeployed to ${p.redeployedTo}` : ""}
                      </span>
                    </div>
                    <div className="urgent-now note">
                      Now on {p.currentProject ?? "–"}
                      {p.currentCustomer ? ` (${p.currentCustomer})` : ""}
                    </div>
                  </li>
                ))}
              </ol>
              {list.length > 25 && <p className="note">The first 25 of {list.length}.</p>}
              {list.length === 0 && <p className="note">Nobody in this position with these filters.</p>}
            </>
          ) : (
            <p className="note">Pick a position, or click one in the table, to list who can start first and when.</p>
          )}
        </div>
      </div>
    </div>
  );
}
