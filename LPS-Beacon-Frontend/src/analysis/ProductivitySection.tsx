// src/analysis/ProductivitySection.tsx
// "How productive are we, and who needs attention?", the Analysis page, top to bottom (order from 4 Nov 2026):
//  1. Calculated FTE required: the calculator (1 FTE = 18 man-days a month), for the organisation or the agencies
//     picked in the agencies dropdown, with its formula printed beside the result.
//  2. Organisation baseline: Revenue per HC, GP per HC, Revenue per $ of HC cost and the weighted cost per FTE per day,
//     this fiscal year to date (annualised) against last fiscal year. Each shows how it is worked out.
//  3. Agencies and projects: every agency at a glance; a dropdown narrows it to the agencies picked; a row opens to
//     show its projects (the Project View), with HC, FTE actual (clocked) and days per head.
//  4. Management target: Finance's P&L summary, full year and quarters (ManagementTarget.tsx).
// Naming: HC = people (names); FTE = clocked days / 18 (MSPO clocking via the UR report).

import { Fragment, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { usePageState } from "../lib/pageState";
import type { AgencyProductivity, CapacityPlan, Flag, ManagementTargetEdit, ProductivityFigures } from "../api/types";
import { FISCAL_YEARS } from "./capacityPlanLayout";
import ManagementTarget from "./ManagementTarget";
import { periodOptions, periodView } from "./periodFigures";
import MultiSelect from "../components/MultiSelect";
import {
  fmt,
  fteRequired,
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

// ---- 1. Organisation baseline ----
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
          <h3 id="baseline-title">Organisation baseline</h3>
          <p className="prod-sub">
            {fy} to date, {monthName(now.months[0])} to {monthName(now.months[now.months.length - 1])}, as a yearly rate.
            The company figure every agency is compared with.
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
        Days / head
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
  // A project opens on the Dashboard, filtered to it (4 Nov 2026). The Dashboard's periods are the latest month and
  // the fiscal quarters, so a quarter or the latest month carries over; another month or the year opens the latest.
  const navigate = useNavigate();
  const openProject = (projectId: string) => {
    const q = new URLSearchParams({ projectId });
    const last = p.months[p.months.length - 1];
    if (period?.id.startsWith("Q")) q.set("period", `${period.id}'${p.fiscalYear.slice(2)}`);
    else if (period?.id === last) q.set("period", "latest");
    navigate(`/dashboard?${q}`);
  };
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
            revenue from the ABCD report. Click an agency to see its projects.
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
                  <tr className={`prod-row${isOpen ? " open" : ""}`} onClick={() => toggle(a.agency)}>
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
                            {a.projects.map((pr) => (
                              <tr key={pr.projectId} title={pr.flagReason}>
                                <th scope="row">
                                  {/* Only the name opens the project on the Dashboard; the rest of the row is plain. */}
                                  <button type="button" className="prod-project-link"
                                    title="Open this project on the Dashboard"
                                    onClick={() => openProject(pr.projectId)}>
                                    {pr.projectName}
                                  </button>
                                  <span className="prod-project-id">{pr.projectId}</span>
                                </th>
                                <td>
                                  <FlagPill flag={pr.flag} />
                                </td>
                                {figures(pr)}
                              </tr>
                            ))}
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

// ---- 3. FTE required ----
interface Scope {
  key: string;
  label: string;
  annualRevenue: number; // the default target
  iRate: number | null;
  current: number | null;
  currentLabel: string;
}

function FteCalculator({ plan, fy, scope }: { plan: CapacityPlan; fy: string; scope: Scope }) {
  const t = plan.settings?.[fy]?.target;
  // The inputs are remembered for 30 minutes per scope (lib/pageState.ts).
  const k = `analysis.fte.${scope.key}.`;
  const [revenueM, setRevenueM] = usePageState(k + "revenue", (scope.annualRevenue / 1_000_000).toFixed(scope.key === "org" ? 0 : 2));
  const [gp, setGp] = usePageState(k + "gp", String(((t?.gpPct ?? 0.27) * 100).toFixed(0)));
  const [ur, setUr] = usePageState(k + "ur", String(Number(((t?.billableUr ?? 0.854) * 100).toFixed(1))));
  const [manDays, setManDays] = usePageState(k + "manDays", String(t?.manDaysPerFte ?? 18));
  const [rate, setRate] = usePageState(k + "rate", scope.iRate ? scope.iRate.toFixed(0) : "");
  const [billableDays, setBillableDays] = usePageState(k + "billable", t?.manDaysAreBillable ?? false);

  const inputs = {
    annualRevenue: Number(revenueM) * 1_000_000,
    gpPct: Number(gp) / 100,
    ur: Number(ur) / 100,
    manDaysPerFte: Number(manDays),
    manDaysAreBillable: billableDays,
    iRate: Number(rate),
  };
  const result = fteRequired(inputs);
  const gap = result && scope.current !== null ? result.totalFte - scope.current : null;

  return (
    <section className="prod-card" aria-labelledby="fte-title">
      <header className="prod-card-head">
        <div>
          <h3 id="fte-title">Calculated FTE required for a revenue target</h3>
          <p className="prod-sub">For {scope.label}. Change any input; the formula on the right updates with it.</p>
        </div>
      </header>
      <div className="fte-layout">
        <div className="fte-inputs">
          <label>
            <span>Revenue target a year</span>
            <span className="fte-field">
              <span className="fte-unit">$</span>
              <input inputMode="decimal" value={revenueM} onChange={(e) => setRevenueM(e.target.value)} />
              <span className="fte-unit">M</span>
            </span>
          </label>
          <label>
            <span>Gross profit</span>
            <span className="fte-field">
              <input inputMode="decimal" value={gp} onChange={(e) => setGp(e.target.value)} />
              <span className="fte-unit">%</span>
            </span>
          </label>
          <label>
            <span>Billable UR</span>
            <span className="fte-field">
              <input inputMode="decimal" value={ur} onChange={(e) => setUr(e.target.value)} />
              <span className="fte-unit">%</span>
            </span>
          </label>
          <label>
            <span>Man-days per FTE a month</span>
            <span className="fte-field">
              <input inputMode="decimal" value={manDays} onChange={(e) => setManDays(e.target.value)} />
              <span className="fte-unit">days</span>
            </span>
          </label>
          <label className="fte-wide">
            <span>
              Weighted cost per FTE per day (iRate)
              {scope.iRate !== null && Number(rate).toFixed(0) !== scope.iRate.toFixed(0) && (
                <button type="button" className="link-button" onClick={() => setRate(scope.iRate!.toFixed(0))}>
                  reset to {fmt.usd(scope.iRate)}
                </button>
              )}
            </span>
            <span className="fte-field">
              <span className="fte-unit">$</span>
              <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
              <span className="fte-unit">a day</span>
            </span>
          </label>
          <fieldset className="fte-wide fte-convention">
            <legend>The {manDays || "18"} man-days are…</legend>
            <label>
              <input type="radio" checked={billableDays} onChange={() => setBillableDays(true)} />
              billable days (UR already allowed for)
            </label>
            <label>
              <input type="radio" checked={!billableDays} onChange={() => setBillableDays(false)} />
              working days (divide by UR, the company standard)
            </label>
          </fieldset>
        </div>

        <div className="fte-result">
          {result ? (
            <>
              <div className="fte-numbers">
                <div>
                  <span className="fte-big">{fmt.int(result.totalFte)}</span>
                  <span className="fte-cap">Calculated FTE required</span>
                </div>
                <div>
                  <span className="fte-big">{fmt.int(scope.current)}</span>
                  <span className="fte-cap">{scope.currentLabel}</span>
                </div>
                <div className={gap !== null && gap > 0 ? "short" : "spare"}>
                  <span className="fte-big">
                    {gap === null ? "–" : fmt.int(Math.abs(gap))}
                  </span>
                  <span className="fte-cap">{gap !== null && gap > 0 ? "FTE short" : "FTE to spare"}</span>
                </div>
              </div>
              <ol className="fte-steps">
                <li>
                  <span>Revenue per FTE-day</span>
                  <span>
                    {fmt.usd(inputs.iRate)} ÷ (1 − {gp}%) = <strong>{fmt.usd(result.pricePerDay)}</strong>
                  </span>
                </li>
                <li>
                  <span>Revenue one FTE brings a year</span>
                  <span>
                    12 × {manDays} × {fmt.usd(result.pricePerDay)} = <strong>{fmt.usd(result.revenuePerFteYear)}</strong>
                  </span>
                </li>
                <li>
                  <span>Billable FTE</span>
                  <span>
                    {fmt.usdM(inputs.annualRevenue)} ÷ {fmt.usd(result.revenuePerFteYear)} = <strong>{fmt.dec1(result.billableFte)}</strong>
                  </span>
                </li>
                <li>
                  <span>Total FTE</span>
                  <span>
                    {billableDays ? (
                      <>
                        = billable FTE = <strong>{fmt.dec1(result.totalFte)}</strong> (UR not applied again)
                      </>
                    ) : (
                      <>
                        {fmt.dec1(result.billableFte)} ÷ {ur}% = <strong>{fmt.dec1(result.totalFte)}</strong>
                      </>
                    )}
                  </span>
                </li>
              </ol>
              <p className="fte-note">
                1 FTE = 18 working days a month, the company&apos;s standard baseline, so UR is applied. This formula is
                being replaced (agreed to be incorrect on 4 Nov), so treat the figure as indicative.
              </p>
            </>
          ) : (
            <p className="note">Enter a revenue target, a GP below 100%, a UR, the man-days and a daily cost.</p>
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
    const last = latestActual(plan);
    if (scopeKind === "selection" && p && selected.length > 0) {
      const picked = p.agencies.filter((a) => selected.includes(a.agency));
      const annual = 12 / p.months.length;
      const fte = picked.reduce((s, a) => s + a.fte, 0);
      const weighted = picked.reduce((s, a) => s + (a.ratePerDay ?? 0) * a.fte, 0);
      return {
        key: `sel:${selected.join("|")}`,
        label: picked.length === 1 ? picked[0].agency : `the ${picked.length} agencies picked`,
        annualRevenue: picked.reduce((s, a) => s + a.revenue, 0) * annual,
        iRate: fte ? weighted / fte : null,
        current: fte,
        currentLabel: "FTE actual today",
      };
    }
    return {
      key: "org",
      label: "the organisation (Singapore delivery)",
      annualRevenue: plan.settings?.[fy]?.target?.revenueUsd ?? 90_000_000,
      iRate: last ? weightedIRate(plan, last.key, fy) : null,
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
