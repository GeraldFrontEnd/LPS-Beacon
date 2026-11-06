// src/dashboard/AgencyPanels.tsx
// Agencies and projects, the Dashboard's summary (5 Nov 2026 review: the Dashboard summarises, the Analysis page
// holds the detail). One row per agency with its projects under it, in the last month of the period:
//   HC            distinct people on its projects that month
//   As sold       quote line man-days ÷ 18 (pipeline/capacity.py _as_sold)
//   As planned    the PM's plan, SL x RP man-days ÷ 18
//   Actual        billable days clocked in MSPO ÷ 18; a forecast month has none
//   Total actual cost   clocked days × rate card (iRate) by band (pipeline hcCost), over the period's actual months
//   ADR           revenue ÷ billable days clocked over the period's actual months (as on the Analysis page)
//   Status        the Analysis page's flags for the same months; an agency shows red when it, or any of its projects,
//                 is red
// Clicking an agency or project name opens it on the Analysis page, where its people are listed.
// A status filter (as on the Analysis page) narrows the list to the agencies needing attention, to watch or on track.
// The rows come from GET /dashboard (lambda-api agency_panels, results/capacity/roster.json).

import { Fragment, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AgencyPanels as Panels, CapacityPlan, Flag, ProductivityFigures } from "../api/types";
import { fmt, monthName } from "../analysis/baseline";
import { periodOptions, periodView } from "../analysis/periodFigures";
import { usePageState } from "../lib/pageState";

const SHOWN = 10;
type StatusFilter = "all" | Flag;
const FLAG_LABEL: Record<Flag, string> = { red: "Needs attention", amber: "Watch", green: "On track" };

function Status({ flag, note }: { flag: Flag | null | undefined; note?: string }) {
  if (!flag) return <span className="flag-pill none">Not flagged</span>;
  return (
    <span className={`flag-pill ${flag}`} title={note}>
      {FLAG_LABEL[flag]}
    </span>
  );
}

export default function AgencySummary({
  panels,
  plan,
  fy,
  periodMonths,
  filtered: narrowed = false,
}: {
  panels: Panels | undefined;
  plan: CapacityPlan;
  fy: string;
  periodMonths: string[]; // the Dashboard period's months ("2026-10", ...)
  filtered?: boolean; // an agency or project is picked in the Dashboard's filter: list only what the API sent
}) {
  const navigate = useNavigate();
  const [showAll, setShowAll] = useState(false);
  // Remembered for 30 minutes like the Analysis page's filter (lib/pageState.ts).
  const [status, setStatus] = usePageState<StatusFilter>("dashboard.status", "all");
  const p = plan.productivity;

  // The Analysis figures for the same months (flags, cost, revenue); the fiscal year to date when the period has no
  // actual months yet.
  const analysis = useMemo(() => {
    if (!p) return null;
    const months = periodMonths.filter((m) => p.months.includes(m));
    const view = periodView(plan, fy, months.length ? months : p.months);
    const agencies = new Map(view.agencies.map((a) => [a.agency, a]));
    const projects = new Map<string, ProductivityFigures>();
    for (const a of view.agencies) for (const pr of a.projects) projects.set(pr.projectId, pr);
    return { agencies, projects, months: view.months };
  }, [p, plan, fy, periodMonths]);

  // The Analysis period that matches: the month, the quarter, else the fiscal year to date.
  const analysisPeriod = useMemo(() => {
    if (!p) return "fy";
    const ids = new Set(periodOptions(p.months, p.fiscalYear).map((o) => o.id));
    if (periodMonths.length === 1 && ids.has(periodMonths[0])) return periodMonths[0];
    const ytd = p.months.filter((m) => periodMonths.includes(m));
    if (ytd.length === p.months.length && p.months.length > 1) return "fy"; // the year to date
    const m = Number(periodMonths[0]?.slice(5, 7));
    const q = m >= 4 && m <= 6 ? "Q1" : m >= 7 && m <= 9 ? "Q2" : m >= 10 ? "Q3" : "Q4";
    return periodMonths.length > 1 && ids.has(q) ? q : "fy";
  }, [p, periodMonths]);

  const open = (agency: string, projectId?: string) => {
    const q = new URLSearchParams({ agency, period: analysisPeriod });
    if (projectId) q.set("project", projectId);
    navigate(`/analysis?${q}`);
  };

  if (!panels) return <p className="note">Loading the agencies…</p>;
  if (!panels.month || (!panels.agencies.length && !analysis?.agencies.size))
    return <p className="note">Nobody is planned or clocked on any project{panels.month ? ` in ${monthName(panels.month)}` : ""}.</p>;

  const month = panels.month;
  // The same agencies as the Analysis page for the period: one with revenue or FTE in the period but nobody on it in
  // its last month is still listed (with no people that month), so both pages count the same agencies.
  const listed: Panels["agencies"] = [...panels.agencies];
  const have = new Set(listed.map((a) => a.agency));
  for (const af of narrowed ? [] : analysis?.agencies.values() ?? []) {
    if (have.has(af.agency)) continue;
    listed.push({
      agency: af.agency, headcount: 0, planDays: 0, planFte: 0, actualDays: null, actualFte: null, asSoldFte: null,
      projects: af.projects.map((pr) => ({
        projectId: pr.projectId, name: pr.projectName, headcount: 0, planDays: 0, planFte: 0, actualDays: null,
        actualFte: null, asSoldFte: null,
      })),
    });
  }
  const usable = !!p && p.clocked !== false && !!analysis && periodMonths.some((m) => p.months.includes(m));
  // Cost and ADR over the period, the same figures as the Analysis page (periodView); a month with no actual figures
  // yet (forecast) has none.
  const money = (f: ProductivityFigures | undefined) =>
    usable && f ? { cost: f.hcCost, adr: f.adr ?? null } : { cost: null, adr: null };
  // An agency's status: red when it, or any of its projects, is red; otherwise its own flag.
  const statusOf = (a: Panels["agencies"][number]) => {
    const redProjects = a.projects.filter((pr) => analysis?.projects.get(pr.projectId)?.flag === "red").length;
    const af = analysis?.agencies.get(a.agency);
    const flag: Flag | null = redProjects > 0 ? "red" : af?.flag ?? null;
    return { flag, redProjects, af };
  };
  const counts = { red: 0, amber: 0, green: 0 } as Record<Flag, number>;
  listed.forEach((a) => {
    const f = statusOf(a).flag;
    if (f) counts[f] += 1;
  });
  const filtered = status === "all" ? listed : listed.filter((a) => statusOf(a).flag === status);
  const shown = showAll ? filtered : filtered.slice(0, SHOWN);

  return (
    <div className="sum">
      <div className="segmented sum-status" role="group" aria-label="Status">
        {(["all", "red", "amber", "green"] as StatusFilter[]).map((s) => (
          <button key={s} type="button" className={status === s ? "on" : ""} aria-pressed={status === s}
            onClick={() => setStatus(s)}>
            {s === "all" ? `All (${listed.length})` : `${FLAG_LABEL[s]} (${counts[s]})`}
          </button>
        ))}
      </div>
      <p className="sum-note">
        {monthName(month)}
        {panels.clocked ? "" : " · forecast month: plan only, nothing clocked yet"}
        {panels.pending.asSold ? ` · As sold: ${panels.pending.asSold}` : ""}. Click an agency or project to see its
        people on the Analysis page.
      </p>
      <div className="sum-scroll">
        <table className="sum-table">
          <thead>
            <tr>
              <th scope="col">Agency / project</th>
              <th scope="col">Status</th>
              <th scope="col" className="num" title="People on its projects that month">HC</th>
              <th scope="col" className="num" title="Quote line man-days ÷ 18">As sold</th>
              <th scope="col" className="num" title="The PM's plan: planned man-days ÷ 18">As planned</th>
              <th scope="col" className="num" title="Billable days clocked in MSPO ÷ 18">Actual</th>
              <th scope="col" className="num" title="Billable days clocked × rate card (iRate) of each person's band">
                Total actual cost
              </th>
              <th scope="col" className="num" title="Average daily revenue: revenue ÷ billable days clocked = monthly revenue ÷ (FTE actual × 18)">
                ADR
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((a) => {
              const { flag, redProjects, af } = statusOf(a);
              const note = redProjects
                ? `${redProjects} of its projects need${redProjects === 1 ? "s" : ""} attention`
                : af?.flagReason;
              const m = money(af);
              return (
                <Fragment key={a.agency}>
                  <tr className="sum-agency">
                    <th scope="row">
                      <button type="button" className="sum-link" onClick={() => open(a.agency)}
                        title="Open this agency on the Analysis page">
                        {a.agency}
                      </button>
                      <span className="sum-sub">
                        {a.projects.length} project{a.projects.length === 1 ? "" : "s"}
                        {redProjects ? ` · ${redProjects} red` : ""}
                      </span>
                    </th>
                    <td><Status flag={flag} note={note} /></td>
                    <td className="num">{fmt.int(a.headcount)}</td>
                    <td className="num">{fmt.dec1(a.asSoldFte)}</td>
                    <td className="num">{fmt.dec1(a.planFte)}</td>
                    <td className="num">{fmt.dec1(a.actualFte)}</td>
                    <td className="num">{fmt.usd(m.cost)}</td>
                    <td className="num">{fmt.usd(m.adr)}</td>
                  </tr>
                  {a.projects.map((pr) => {
                    const pf = analysis?.projects.get(pr.projectId);
                    const pm = money(pf);
                    return (
                      <tr key={pr.projectId} className="sum-project">
                        <th scope="row">
                          <button type="button" className="sum-link" onClick={() => open(a.agency, pr.projectId)}
                            title="Open this project and its people on the Analysis page">
                            {pr.name ?? pr.projectId}
                          </button>
                          <span className="sum-sub">{pr.projectId}</span>
                        </th>
                        <td><Status flag={pf?.flag} note={pf?.flagReason} /></td>
                        <td className="num">{fmt.int(pr.headcount)}</td>
                        <td className="num">{fmt.dec1(pr.asSoldFte)}</td>
                        <td className="num">{fmt.dec1(pr.planFte)}</td>
                        <td className="num">{fmt.dec1(pr.actualFte)}</td>
                        <td className="num">{fmt.usd(pm.cost)}</td>
                        <td className="num">{fmt.usd(pm.adr)}</td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {filtered.length === 0 && <p className="note">No agency has this status.</p>}
      {filtered.length > SHOWN && (
        <button type="button" className="secondary-button people-more" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show fewer" : `Show all ${filtered.length} agencies`}
        </button>
      )}
    </div>
  );
}
