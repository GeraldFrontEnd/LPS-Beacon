// src/analysis/ProductivitySection.tsx
// "How productive are we, and who needs attention?", the Analysis page, top to bottom (order from 4 Nov 2026):
//  1. The FTE / revenue calculator (FTE from a revenue target, or revenue from FTE; ADR-based), for the organisation or the agencies
//     picked in the agencies dropdown, with its formula printed beside the result.
//  2. Organisation actuals (fiscal year to date): Revenue per HC, GP per HC, Revenue per $ of HC cost and the weighted cost per FTE per day,
//     this fiscal year to date (annualised) against last fiscal year. Each shows how it is worked out.
//  3. Agencies and projects: every agency at a glance; a dropdown narrows it to the agencies picked; a row opens to
//     show its projects (the Project View), with HC, FTE actual (clocked) and days per head.
//  4. Management target: Finance's P&L summary, full year and quarters (ManagementTarget.tsx).
// Naming: HC = people (names); FTE = clocked days / 18 (MSPO clocking via the UR report).

import { Fragment, useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { usePageState } from "../lib/pageState";
import type { AgencyProductivity, CapacityPlan, Flag, ManagementTargetEdit, ProductivityFigures } from "../api/types";
import { FISCAL_YEARS } from "./capacityPlanLayout";
import ManagementTarget from "./ManagementTarget";
import ProjectResources from "./ProjectResources";
import { periodOptions, periodView } from "./periodFigures";
import MultiSelect from "../components/MultiSelect";
import {
  adr,
  fmt,
  lastYearBaseline,
  latestActual,
  monthName,
  reportingYear,
  thisYearBaseline,
  weightedIRate,
} from "./baseline";

const FLAG_TEXT: Record<Flag, string> = { red: "Needs attention", amber: "Watch", green: "On track" };

function FlagPill({ flag }: { flag: Flag | null }) {
  return <span className={`flag-pill ${flag ?? "none"}`}>{flag ? FLAG_TEXT[flag] : "Not flagged"}</span>;
}

function FlagDot({ flag }: { flag: Flag | null }) {
  return <span className={`flag-dot ${flag ?? "none"}`} aria-hidden="true" />;
}

// ---- 1. Organisation actuals, fiscal year to date (renamed from "baseline" on 5 Nov 2026: it is not a benchmark) ----
function Baseline({ plan, fy }: { plan: CapacityPlan; fy: string }) {
  const now = thisYearBaseline(plan, fy);
  const before = lastYearBaseline(plan, fy);
  const last = latestActual(plan);
  const iRate = last ? weightedIRate(plan, last.key, fy) : null;
  if (!now) return null;

  const delta = (a: number | null, b: number | null | undefined) => {
    if (a === null || b === null || b === undefined || !b) return null;
    const d = (a - b) / Math.abs(b);
    return { text: `${d >= 0 ? "▲" : "▼"} ${Math.abs(d * 100).toFixed(0)}%`, down: d < 0 };
  };
  const tiles = [
    { label: "Revenue per HC", value: fmt.usdK(now.revenuePerHc), was: before && fmt.usdK(before.revenuePerHc),
      d: delta(now.revenuePerHc, before?.revenuePerHc) },
    { label: "GP per HC", value: fmt.usdK(now.gpPerHc), was: before && fmt.usdK(before.gpPerHc),
      d: delta(now.gpPerHc, before?.gpPerHc) },
    { label: "Revenue per $1 of HC cost", value: fmt.ratio(now.revenuePerHcCost), was: before && fmt.ratio(before.revenuePerHcCost),
      d: delta(now.revenuePerHcCost, before?.revenuePerHcCost) },
    { label: "Weighted cost per FTE per day", value: fmt.usd(iRate), was: null, d: null },
  ];

  return (
    <section className="prod-card" aria-labelledby="baseline-title">
      <header className="prod-card-head">
        <div>
          <h3 id="baseline-title">Organisation actuals, {fy} to date</h3>
          <p className="prod-sub">
            Actual figures, {monthName(now.months[0])} to {monthName(now.months[now.months.length - 1])}, as a yearly
            rate, against last fiscal year. Actual months only: no forecast.
          </p>
        </div>
      </header>
      <div className="prod-tiles">
        {tiles.map((t) => (
          <div key={t.label} className="prod-tile">
            <div className="prod-tile-label">{t.label}</div>
            <div className="prod-tile-value">{t.value}</div>
            <div className="prod-tile-was">
              {t.was ? (
                <>
                  {before?.label} {t.was}
                  {t.d && <span className={t.d.down ? "down" : "up"}> {t.d.text}</span>}
                </>
              ) : (
                <>Rate card (iRate) by band, weighted by {last?.key ?? "today's"} headcount</>
              )}
            </div>
          </div>
        ))}
      </div>
      <details className="prod-formula">
        <summary>How these are worked out</summary>
        <ul>
          <li>
            Revenue per HC = revenue {fmt.usdM(now.revenue)} a year (ABCD actuals, annualised) ÷ average delivery HC{" "}
            {fmt.int(now.headcount)} = {fmt.usdK(now.revenuePerHc)}
          </li>
          <li>GP per HC = (revenue − HC cost at the rate card) ÷ average delivery HC = {fmt.usdK(now.gpPerHc)}</li>
          <li>Revenue per $1 of HC cost = revenue ÷ HC cost at the rate card = {fmt.ratio(now.revenuePerHcCost)}</li>
          <li>Weighted cost per FTE per day = Σ (HC in each band × iRate of that band) ÷ Σ HC = {fmt.usd(iRate)}</li>
          {before && (
            <li>
              {before.label}: ABCD revenue {fmt.usdM(before.revenue)}, {fmt.int(before.headcount)} average HC and staff cost
              from the {before.source}.
            </li>
          )}
        </ul>
      </details>
    </section>
  );
}

// ---- 2. Agencies and projects ----
type StatusFilter = "all" | Flag;

function figures(f: ProductivityFigures) {
  const days = f.daysPerHead;
  return (
    <>
      <td className="num">{fmt.usdM(f.revenue)}</td>
      <td className="num" title={f.headcountAverage != null ? `Average ${fmt.dec1(f.headcountAverage)} a month over the period` : undefined}>
        {fmt.int(f.headcount)}
      </td>
      <td className="num" title={`Planned: ${fmt.dec1(f.planFte)} FTE`}>{fmt.dec1(f.fte)}</td>
      <td className={`num${f.utilisationFlag === "red" ? " days-red" : ""}`}
        title={f.utilisationFlag === "red" ? (days !== null && days < 15.3 ? "Under-utilised: below 15.3 days" : "Over-utilised: above 18 days") : undefined}>
        {fmt.dec1(days)}
      </td>
      <td className="num">{fmt.usdK(f.revenuePerFte)}</td>
      <td className="num">{fmt.usdK(f.gpPerFte)}</td>
      <td className="num">{fmt.usd(f.adr)}</td>
    </>
  );
}

function figureHeads() {
  return (
    <>
      <th scope="col" className="num" title="Revenue in the period picked (ABCD report)">Revenue</th>
      <th scope="col" className="num" title="People working on it in the last month of the period. Hover a number for the monthly average">HC</th>
      <th scope="col" className="num" title="Billable days clocked ÷ 18, averaged per month. Hover a number to see the planned FTE">FTE actual</th>
      <th scope="col" className="num" title="Billable days each person clocks a month, on average. Red below 15.3 or above 18">
        Utilization rate
      </th>
      <th scope="col" className="num">Revenue per FTE</th>
      <th scope="col" className="num">GP per FTE</th>
      <th scope="col" className="num" title="Average daily revenue: revenue ÷ billable days clocked, i.e. monthly revenue ÷ (FTE actual × 18). Actual only">
        ADR
      </th>
    </>
  );
}

function AgencyExplorer({
  plan,
  fy,
  selected,
  onSelect,
}: {
  plan: CapacityPlan;
  fy: string;
  selected: string[];
  onSelect: (v: string[]) => void;
}) {
  const p = plan.productivity!;
  // Remembered for 30 minutes (lib/pageState.ts), so coming back from the Dashboard finds the page as it was left.
  const [status, setStatus] = usePageState<StatusFilter>("analysis.status", "all");
  const [openList, setOpenList] = usePageState<string[]>("analysis.open", []);
  const open = useMemo(() => new Set(openList), [openList]);
  // The period: the fiscal year to date (default), a quarter or a month (4 Nov 2026).
  const options = useMemo(() => periodOptions(p.months, p.fiscalYear), [p.months, p.fiscalYear]);
  const [periodId, setPeriodId] = usePageState("analysis.period", "fy");
  const period = options.find((o) => o.id === periodId) ?? options[0];
  const view = useMemo(() => periodView(plan, fy, period?.months ?? p.months), [plan, fy, period, p.months]);
  // A project's people open under its row (5 Nov 2026: the resource list moved here from the Dashboard).
  const [openProjects, setOpenProjects] = usePageState<string[]>("analysis.openProjects", []);
  const toggleProject = (id: string) =>
    setOpenProjects((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  // Opened from the Dashboard (?agency=&project=&period=): show that agency, open it (and the project), scroll to it.
  const [params, setParams] = useSearchParams();
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current) return;
    const agency = params.get("agency");
    if (!agency) return;
    arrived.current = true;
    const project = params.get("project");
    const wanted = params.get("period");
    if (wanted && options.some((o) => o.id === wanted)) setPeriodId(wanted);
    setStatus("all");
    onSelect([agency]);
    setOpenList((prev) => (prev.includes(agency) ? prev : [...prev, agency]));
    if (project) setOpenProjects((prev) => (prev.includes(project) ? prev : [...prev, project]));
    setParams({}, { replace: true });
    window.setTimeout(() => {
      const el = document.getElementById(project ? `prod-project-${project}` : `prod-agency-${agency}`);
      el?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 150);
  }, [params, setParams, options, setPeriodId, setStatus, onSelect, setOpenList, setOpenProjects]);
  const lastMonth = view.months[view.months.length - 1];
  const agencies = view.agencies;
  const counts = { red: 0, amber: 0, green: 0 } as Record<Flag, number>;
  agencies.forEach((a) => a.flag && (counts[a.flag] += 1));

  const shown = agencies.filter(
    (a) => (selected.length === 0 || selected.includes(a.agency)) && (status === "all" || a.flag === status)
  );
  const total = shown.reduce(
    (t, a) => ({ revenue: t.revenue + a.revenue, fte: t.fte + a.fte, gp: t.gp + a.gp }),
    { revenue: 0, fte: 0, gp: 0 }
  );
  const annual = 12 / view.months.length;
  const avg = view.companyAverage;
  const revPerFte = total.fte ? (total.revenue * annual) / total.fte : null;
  const toggle = (name: string) =>
    setOpenList((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  const r = p.rules;
  // The 4 Nov rule; inputs built by an older pipeline do not carry it, and the page must not fail on them.
  const util = r.utilisation ?? { fullMonthManDays: 18, urTarget: 0.85, redBelowDays: 15.3, redAboveDays: 18 };
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  return (
    <section className="prod-card" aria-labelledby="agency-title">
      <header className="prod-card-head">
        <div>
          <h3 id="agency-title">Agencies and projects</h3>
          <p className="prod-sub">
            {monthName(view.months[0])}
            {view.months.length > 1 ? ` to ${monthName(view.months[view.months.length - 1])}` : ""}. HC = people on it in{" "}
            {monthName(view.months[view.months.length - 1])}; FTE actual ={" "}
            {p.clocked === false ? "planned man-days (no clocking yet)" : "clocked billable days"} ÷ 18, averaged a month;
            revenue from the ABCD report. Click an agency to see its projects, and a project to see its people.
            {view.months.length < 3 && " One month of revenue can be lumpy (milestone billing): judge productivity on the year."}
          </p>
        </div>
        <div className="prod-controls">
          {!view.fromPipeline && options.length > 1 && (
            <label className="prod-period">
              <span>Period</span>
              <select value={period?.id} onChange={(e) => setPeriodId(e.target.value)}>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <MultiSelect
            label="Agencies"
            allLabel="All agencies"
            options={agencies.map((a) => ({
              value: a.agency,
              label: a.agency,
              hint: a.projects.map((pr) => `${pr.projectId} ${pr.projectName}`).join(" "),
              marker: <FlagDot flag={a.flag} />,
            }))}
            selected={selected}
            onChange={onSelect}
            shortcuts={[
              { label: "Only red", values: agencies.filter((a) => a.flag === "red").map((a) => a.agency) },
              { label: "Red and amber", values: agencies.filter((a) => a.flag === "red" || a.flag === "amber").map((a) => a.agency) },
            ]}
          />
          <div className="segmented" role="group" aria-label="Status">
            {(["all", "red", "amber", "green"] as StatusFilter[]).map((s) => (
              <button key={s} type="button" className={status === s ? "on" : ""} aria-pressed={status === s}
                onClick={() => setStatus(s)}>
                {s === "all" ? "All" : `${FLAG_TEXT[s]} (${counts[s]})`}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="prod-summary">
        <div>
          <span className="prod-summary-value">{shown.length}</span>
          <span className="prod-summary-label">{shown.length === 1 ? "agency" : "agencies"} shown</span>
        </div>
        <div>
          <span className="prod-summary-value">{fmt.usdM(total.revenue)}</span>
          <span className="prod-summary-label">revenue{view.months.length === p.months.length ? " to date" : " in the period"}</span>
        </div>
        <div>
          <span className="prod-summary-value">{fmt.dec1(total.fte)}</span>
          <span className="prod-summary-label">FTE actual</span>
        </div>
        <div>
          <span className="prod-summary-value">{fmt.usdK(revPerFte)}</span>
          <span className="prod-summary-label">revenue per FTE (company {fmt.usdK(avg.revenuePerFte)})</span>
        </div>
      </div>

      <div className="prod-scroll">
        <table className="prod-table">
          <thead>
            <tr>
              <th scope="col">Agency</th>
              <th scope="col">Status</th>
              {figureHeads()}
            </tr>
          </thead>
          <tbody>
            {shown.map((a: AgencyProductivity) => {
              const isOpen = open.has(a.agency);
              return (
                <Fragment key={a.agency}>
                  <tr id={`prod-agency-${a.agency}`} className={`prod-row${isOpen ? " open" : ""}`} onClick={() => toggle(a.agency)}>
                    <th scope="row">
                      <button type="button" className="prod-expand" aria-expanded={isOpen}
                        onClick={(e) => { e.stopPropagation(); toggle(a.agency); }}>
                        <span aria-hidden="true" className="prod-chevron">{isOpen ? "▾" : "▸"}</span>
                        <span className="prod-agency-name">{a.agency}</span>
                        <span className="prod-agency-count">
                          {a.projects.length} project{a.projects.length === 1 ? "" : "s"}
                        </span>
                      </button>
                    </th>
                    <td>
                      <FlagPill flag={a.flag} />
                    </td>
                    {figures(a)}
                  </tr>
                  {isOpen && (
                    <tr className="prod-detail">
                      <td colSpan={9}>
                        <p className="prod-reason">
                          <strong>Why:</strong> {a.flagReason}.
                        </p>
                        <table className="prod-subtable">
                          <thead>
                            <tr>
                              <th scope="col">Project</th>
                              <th scope="col">Status</th>
                              {figureHeads()}
                            </tr>
                          </thead>
                          <tbody>
                            {a.projects.map((pr) => {
                              const projectOpen = openProjects.includes(pr.projectId);
                              return (
                                <Fragment key={pr.projectId}>
                                  <tr id={`prod-project-${pr.projectId}`} title={pr.flagReason}>
                                    <th scope="row">
                                      {/* The name opens the project's people below it. */}
                                      <button type="button" className="prod-project-link" aria-expanded={projectOpen}
                                        title={projectOpen ? "Hide its people" : "Show its people"}
                                        onClick={() => toggleProject(pr.projectId)}>
                                        <span aria-hidden="true" className="prod-chevron">{projectOpen ? "▾" : "▸"}</span>{" "}
                                        {pr.projectName}
                                      </button>
                                      <span className="prod-project-id">{pr.projectId}</span>
                                    </th>
                                    <td>
                                      <FlagPill flag={pr.flag} />
                                    </td>
                                    {figures(pr)}
                                  </tr>
                                  {projectOpen && lastMonth && (
                                    <tr className="prod-resources">
                                      <td colSpan={9}>
                                        <ProjectResources agency={a.agency} projectId={pr.projectId} month={lastMonth} />
                                      </td>
                                    </tr>
                                  )}
                                </Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {shown.length === 0 && <p className="note prod-empty">No agency matches this filter.</p>}
      </div>

      <details className="prod-formula">
        <summary>How agencies are flagged{r.draft ? " (draft thresholds, waiting for Ethan)" : ""}</summary>
        <ul>
          <li>
            Company average, all agencies with at least {r.minFte} delivery FTE: revenue per FTE {fmt.usdK(avg.revenuePerFte)},
            GP per FTE {fmt.usdK(avg.gpPerFte)}, revenue per $1 of HC cost {fmt.ratio(avg.revenuePerHcCost)}.
          </li>
          <li>
            Red on utilisation: its people clock on average below {util.redBelowDays} or above {util.redAboveDays}{" "}
            billable days a month (1 person = {util.fullMonthManDays} working days at a {pct(util.urTarget)} UR target);
            green otherwise.
          </li>
          <li>
            Red on productivity: {r.metrics.map((m) => (m === "revenuePerFte" ? "revenue per FTE" : "GP per FTE")).join(" or ")}{" "}
            more than {pct(r.productivity.redBelowPct)} below the company average. Amber: {pct(r.productivity.amberBelowPct)} to{" "}
            {pct(r.productivity.redBelowPct)} below. Green: neither.
          </li>
          <li>
            HC counts names, FTE counts clocked days: a person on two projects counts once in each project&apos;s HC, and their
            clocked days are split by their planned days. Agencies under {r.minFte} FTE or without revenue are not flagged on
            productivity.
          </li>
        </ul>
      </details>
    </section>
  );
}

// ---- 3. FTE and revenue calculator (5 Nov 2026 review) ----
// Two ways round, picked with the switch at its top:
//   Calculate FTE       revenue target a year → FTE needed
//   Calculate revenue   FTE → the revenue they bring a year
// Revenue per FTE-day = ADR (average daily revenue: revenue ÷ billable days clocked, fiscal year to date);
// revenue one FTE brings a year = ADR × man-days a month (18) × 12; UR (87 %) is applied: FTE needed = revenue ÷ that
// ÷ UR, revenue = FTE × UR × that. The same formula as the chat's tool (lambda-api analytics_tools.fte_required).
interface Scope {
  key: string;
  label: string;
  annualRevenue: number; // the default revenue target
  adr: number | null; // the default ADR, fiscal year to date
  current: number | null; // people today (HC): the calculator's FTE apply UR, so they are people at the target UR
  currentLabel: string;
}

type CalcMode = "fte" | "revenue";

function FteCalculator({ plan, fy, scope }: { plan: CapacityPlan; fy: string; scope: Scope }) {
  const t = plan.settings?.[fy]?.target;
  // The inputs are remembered for 30 minutes per scope (lib/pageState.ts).
  const k = `analysis.calc.${scope.key}.`;
  const [mode, setMode] = usePageState<CalcMode>("analysis.calc.mode", "fte");
  const [revenueM, setRevenueM] = usePageState(k + "revenue", (scope.annualRevenue / 1_000_000).toFixed(scope.key === "org" ? 0 : 2));
  const [fteText, setFteText] = usePageState(k + "fte", scope.current !== null ? scope.current.toFixed(0) : "");
  const [adrText, setAdrText] = usePageState(k + "adr", scope.adr ? scope.adr.toFixed(0) : "");
  const [ur, setUr] = usePageState(k + "ur", String(Number(((t?.billableUr ?? 0.87) * 100).toFixed(1))));
  const [manDays, setManDays] = usePageState(k + "manDays", String(t?.manDaysPerFte ?? 18));

  const adrValue = Number(adrText);
  const urValue = Number(ur) / 100;
  const days = Number(manDays);
  const valid = adrValue > 0 && urValue > 0 && days > 0;
  const perFteYear = valid ? adrValue * days * 12 : null;
  const revenue = Number(revenueM) * 1_000_000;
  const fteIn = Number(fteText);
  const billableFte = perFteYear && mode === "fte" && revenue > 0 ? revenue / perFteYear : perFteYear && fteIn > 0 ? fteIn * urValue : null;
  const totalFte = mode === "fte" && billableFte !== null ? billableFte / urValue : null;
  const revenueOut = mode === "revenue" && billableFte !== null && perFteYear ? billableFte * perFteYear : null;
  const gap = totalFte !== null && scope.current !== null ? totalFte - scope.current : null;
  const target = t?.revenueUsd ?? null;

  const field = (label: string, value: string, set: (v: string) => void, unit: string, prefix?: string, extra?: ReactNode) => (
    <label>
      <span>
        {label}
        {extra}
      </span>
      <span className="fte-field">
        {prefix && <span className="fte-unit">{prefix}</span>}
        <input inputMode="decimal" value={value} onChange={(e) => set(e.target.value)} />
        <span className="fte-unit">{unit}</span>
      </span>
    </label>
  );

  return (
    <section className="prod-card" aria-labelledby="fte-title">
      <header className="prod-card-head">
        <div>
          <h3 id="fte-title">{mode === "fte" ? "Calculated FTE required for a revenue target" : "Revenue an FTE count brings"}</h3>
          <p className="prod-sub">For {scope.label}. Change any input; the formula on the right updates with it.</p>
        </div>
        <div className="segmented" role="group" aria-label="Calculate">
          <button type="button" className={mode === "fte" ? "on" : ""} aria-pressed={mode === "fte"} onClick={() => setMode("fte")}>
            Calculate FTE
          </button>
          <button type="button" className={mode === "revenue" ? "on" : ""} aria-pressed={mode === "revenue"}
            onClick={() => setMode("revenue")}>
            Calculate revenue
          </button>
        </div>
      </header>
      <div className="fte-layout">
        <div className="fte-inputs">
          {mode === "fte"
            ? field("Revenue target a year", revenueM, setRevenueM, "M", "$")
            : field("FTE (people)", fteText, setFteText, "FTE", undefined,
                scope.current !== null && Number(fteText).toFixed(0) !== scope.current.toFixed(0) ? (
                  <button type="button" className="link-button" onClick={() => setFteText(scope.current!.toFixed(0))}>
                    reset to {fmt.int(scope.current)}
                  </button>
                ) : undefined)}
          {field("ADR (revenue per FTE-day)", adrText, setAdrText, "a day", "$",
            scope.adr !== null && Number(adrText).toFixed(0) !== scope.adr.toFixed(0) ? (
              <button type="button" className="link-button" onClick={() => setAdrText(scope.adr!.toFixed(0))}>
                reset to {fmt.usd(scope.adr)}
              </button>
            ) : undefined)}
          {field("Billable UR", ur, setUr, "%")}
          {field("Man-days per FTE a month", manDays, setManDays, "days")}
        </div>

        <div className="fte-result">
          {valid && billableFte !== null && perFteYear ? (
            <>
              <div className="fte-numbers">
                {mode === "fte" ? (
                  <>
                    <div>
                      <span className="fte-big">{fmt.int(totalFte)}</span>
                      <span className="fte-cap">Calculated FTE required</span>
                    </div>
                    <div>
                      <span className="fte-big">{fmt.int(scope.current)}</span>
                      <span className="fte-cap">{scope.currentLabel}</span>
                    </div>
                    <div className={gap !== null && gap > 0 ? "short" : "spare"}>
                      <span className="fte-big">{gap === null ? "–" : fmt.int(Math.abs(gap))}</span>
                      <span className="fte-cap">{gap !== null && gap > 0 ? "FTE short" : "FTE to spare"}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <span className="fte-big">{fmt.usdM(revenueOut)}</span>
                      <span className="fte-cap">Revenue a year</span>
                    </div>
                    {scope.key === "org" && target !== null && revenueOut !== null && (
                      <div className={revenueOut < target ? "short" : "spare"}>
                        <span className="fte-big">{fmt.usdM(Math.abs(revenueOut - target))}</span>
                        <span className="fte-cap">{revenueOut < target ? "below" : "above"} the {fmt.usdM(target)} target</span>
                      </div>
                    )}
                  </>
                )}
              </div>
              <ol className="fte-steps">
                <li>
                  <span>Revenue per FTE-day</span>
                  <span>
                    ADR = <strong>{fmt.usd(adrValue)}</strong>
                  </span>
                </li>
                <li>
                  <span>Revenue one FTE brings a year</span>
                  <span>
                    {fmt.usd(adrValue)} × {manDays} days × 12 = <strong>{fmt.usd(perFteYear)}</strong>
                  </span>
                </li>
                {mode === "fte" ? (
                  <>
                    <li>
                      <span>Billable FTE</span>
                      <span>
                        {fmt.usdM(revenue)} ÷ {fmt.usd(perFteYear)} = <strong>{fmt.dec1(billableFte)}</strong>
                      </span>
                    </li>
                    <li>
                      <span>Total FTE</span>
                      <span>
                        {fmt.dec1(billableFte)} ÷ {ur}% = <strong>{fmt.dec1(totalFte)}</strong>
                      </span>
                    </li>
                  </>
                ) : (
                  <>
                    <li>
                      <span>Billable FTE</span>
                      <span>
                        {fteText} × {ur}% = <strong>{fmt.dec1(billableFte)}</strong>
                      </span>
                    </li>
                    <li>
                      <span>Revenue</span>
                      <span>
                        {fmt.dec1(billableFte)} × {fmt.usd(perFteYear)} = <strong>{fmt.usdM(revenueOut)}</strong>
                      </span>
                    </li>
                  </>
                )}
              </ol>
              <p className="fte-note">
                ADR is revenue ÷ billable days clocked, {fy} to date. 1 FTE = {manDays || 18} working days a month, the
                company&apos;s standard month; with UR applied the FTE are people at that UR, so they compare with HC.
              </p>
            </>
          ) : (
            <p className="note">
              Enter {mode === "fte" ? "a revenue target" : "an FTE count"}, an ADR, a UR and the man-days per FTE.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

export default function ProductivitySection({
  plan,
  savingTarget,
  onSaveTarget,
}: {
  plan: CapacityPlan;
  savingTarget: boolean;
  onSaveTarget: (edit: ManagementTargetEdit) => void;
}) {
  const fy = reportingYear(plan);
  // The management target's fiscal year: the one we are in, else the plan's first.
  // The vs MT and vs MT % columns can be hidden to keep the table narrow (remembered like the other page settings).
  const [showVariance, setShowVariance] = usePageState<boolean>("analysis.mtVariance", true);
  const [targetYear, setTargetYear] = usePageState<string>("analysis.targetYear", () => {
    const now = new Date();
    const start = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const y = `FY'${String(start).slice(2)}`;
    return FISCAL_YEARS.includes(y) ? y : FISCAL_YEARS[0];
  });
  const [selected, setSelected] = usePageState<string[]>("analysis.agencies", []);
  const [scopeKind, setScopeKind] = usePageState<"org" | "selection">("analysis.scope", "org");
  const p = plan.productivity;

  const scope: Scope = useMemo(() => {
    const months = p?.clocked === false ? [] : p?.months ?? [];
    // ADR over the agencies picked (or all): their revenue and clocked days added up, then divided.
    const adrOf = (list: AgencyProductivity[]) => {
      const totals: Record<string, { revenue: number; actualDays: number }> = {};
      for (const a of list)
        for (const m of months) {
          const c = a.byMonth?.[m];
          if (!c) continue;
          const t = (totals[m] ??= { revenue: 0, actualDays: 0 });
          t.revenue += c.revenue;
          t.actualDays += c.actualDays;
        }
      return adr(totals, months);
    };
    if (scopeKind === "selection" && p && selected.length > 0) {
      const picked = p.agencies.filter((a) => selected.includes(a.agency));
      const annual = 12 / p.months.length;
      return {
        key: `sel:${selected.join("|")}`,
        label: picked.length === 1 ? picked[0].agency : `the ${picked.length} agencies picked`,
        annualRevenue: picked.reduce((s, a) => s + a.revenue, 0) * annual,
        adr: adrOf(picked),
        current: picked.reduce((s, a) => s + a.headcount, 0),
        currentLabel: "HC on their projects (latest month)",
      };
    }
    const last = latestActual(plan);
    return {
      key: "org",
      label: "the organisation (Singapore delivery)",
      annualRevenue: plan.settings?.[fy]?.target?.revenueUsd ?? 90_000_000,
      adr: p ? adrOf(p.agencies) : null,
      current: last ? plan.values["ending-hc"]?.[last.key] ?? null : null,
      currentLabel: `HC today (${last?.key ?? "–"})`,
    };
  }, [plan, fy, p, selected, scopeKind]);

  if (!plan.months || plan.months.length === 0) return null;

  return (
    <div className="productivity">
      <h2 className="prod-title">How productive are we, and who needs attention?</h2>
      <div className="fte-scope segmented" role="group" aria-label="Calculate for">
        <button type="button" className={scopeKind === "org" ? "on" : ""} aria-pressed={scopeKind === "org"}
          onClick={() => setScopeKind("org")}>
          Organisation
        </button>
        <button type="button" className={scopeKind === "selection" ? "on" : ""} aria-pressed={scopeKind === "selection"}
          disabled={selected.length === 0}
          title={selected.length === 0 ? "Pick agencies in the Agencies list below first" : undefined}
          onClick={() => setScopeKind("selection")}>
          {selected.length === 0 ? "Agencies picked below" : `The ${selected.length} agenc${selected.length === 1 ? "y" : "ies"} picked`}
        </button>
      </div>
      <FteCalculator key={scope.key} plan={plan} fy={fy} scope={scope} />
      <Baseline plan={plan} fy={fy} />
      {p && p.agencies.length > 0 ? (
        <AgencyExplorer plan={plan} fy={fy} selected={selected} onSelect={setSelected} />
      ) : (
        <p className="note">
          The agencies and projects appear once an ABCD report with actual months and an SL x RP file are uploaded.
        </p>
      )}
      <section className="prod-card" aria-labelledby="mt-title">
        <header className="prod-card-head">
          <div>
            <h3 id="mt-title">Management target</h3>
            <p className="prod-sub">
              Finance&apos;s P&amp;L summary against the management target (MT): the full year, with the four quarters
              beside it. The MT is set by management, so every MT line is typed in and starts blank. Blue boxes are
              shared with everyone (costs negative, as on Finance&apos;s sheet); grey italics come from the uploaded
              files until someone types over them; the other lines are worked out. Per-HC figures are for the
              period (a quarter's is the quarter's), as on Finance's sheet.
            </p>
            <p className="prod-sub mt-remark">
              <strong>* Remark:</strong> the {"\u201c"}Act + fcst{"\u201d"} and last-year columns will come from David&apos;s P&amp;L
              agent. Until then, revenue is from the ABCD report and the other lines are typed in; the KPIs (GP %,
              per-HC figures, ADR) are worked out here from those numbers.
            </p>
          </div>
          <div className="prod-controls">
            {savingTarget && <span className="analysis-status">Saving…</span>}
            <button
              type="button"
              className="secondary-button"
              aria-pressed={showVariance}
              onClick={() => setShowVariance((v) => !v)}
              title="Show or hide the vs MT and vs MT % columns"
            >
              {showVariance ? "Hide vs MT" : "Show vs MT"}
            </button>
            <select className="mt-year" aria-label="Fiscal year" value={targetYear}
              onChange={(e) => setTargetYear(e.target.value)}>
              {FISCAL_YEARS.map((y) => (
                <option key={y} value={y}>
                  {y.replace("'", "")}
                </option>
              ))}
            </select>
          </div>
        </header>
        <div className="mt-scroll">
          <ManagementTarget
            plan={plan}
            fiscalYear={targetYear}
            saving={savingTarget}
            onSave={onSaveTarget}
            showVariance={showVariance}
          />
        </div>
      </section>
    </div>
  );
}
