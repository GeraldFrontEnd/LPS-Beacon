// src/analysis/ProductivitySection.tsx
// "How productive are we, and who needs attention?" on the Analysis page, above the capacity plan.
//  1. Organisation baseline: Revenue per HC, GP per HC and Revenue per $ of HC cost, this fiscal year to date
//     (annualised) against last fiscal year.
//  2. FTE required: how many FTE a revenue target needs at a GP % and billable UR, with the rate card (iRate).
//  3. By agency (customer) and project: the same figures per FTE, flagged red / amber / green against the company
//     average and against the FTE their revenue needs. The thresholds are a draft until Ethan sets them.
// Naming: HC (headcount) for productivity; FTE only for "how many people do we need" and for the delivery effort
// planned on a project (SL x RP man-days / 18).

import { Fragment, useMemo, useState } from "react";
import type { AgencyProductivity, CapacityPlan, Flag, ProductivityFigures } from "../api/types";
import { lastYearBaseline, reportingYear, thisYearBaseline } from "./baseline";
import { BANDS, rowId } from "./capacityPlanLayout";

const usd0 = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const dec1 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dec2 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int0 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

const money = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : usd0.format(v));
const kUsd = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v) ? "–" : `${v < 0 ? "−" : ""}$${dec1.format(Math.abs(v) / 1000)}K`;
const mUsd = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v) ? "–" : `$${dec2.format(v / 1_000_000)}M`;
const ratio = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : `$${dec2.format(v)}`);
const pct = (v: number) => `${int0.format(v * 100)}%`;

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function change(now: number | null, before: number | null | undefined): string | null {
  if (now === null || before === null || before === undefined || !before) return null;
  const d = (now - before) / Math.abs(before);
  return `${d >= 0 ? "▲" : "▼"} ${int0.format(Math.abs(d) * 100)}% vs last FY`;
}

function FlagPill({ flag }: { flag: Flag | null }) {
  if (!flag) return <span className="flag-pill none">Not flagged</span>;
  const text = flag === "red" ? "Needs attention" : flag === "amber" ? "Watch" : "On track";
  return <span className={`flag-pill ${flag}`}>{text}</span>;
}

// ---- 2. FTE required ----
function FteRequired({ plan, fy }: { plan: CapacityPlan; fy: string }) {
  const settings = plan.settings?.[fy];
  const cols = (plan.months ?? []).filter((m) => m.fiscalYear === fy);
  const lastActual = [...cols].reverse().find((m) => m.actual) ?? cols[0];
  const fyDays = cols.reduce((s, c) => s + (plan.values["working-days"]?.[c.key] ?? 0), 0);
  const fyRevenue = cols.reduce((s, c) => s + (plan.values["revenue"]?.[c.key] ?? 0), 0);
  const target = settings?.target ?? { revenueUsd: 90_000_000, gpPct: 0.27, billableUr: 0.87 };

  const [revenueM, setRevenueM] = useState(String(target.revenueUsd / 1_000_000));
  const [gp, setGp] = useState(String(target.gpPct * 100));
  const [ur, setUr] = useState(String(target.billableUr * 100));
  const [days, setDays] = useState(String(Math.round(fyDays) || 250));

  // Weighted average cost per FTE per day: the rate card (iRate) weighted by the headcount in each band.
  const rates = settings?.bandDayRatesUsd ?? {};
  const key = lastActual?.key;
  let weightSum = 0;
  let costSum = 0;
  for (const band of BANDS) {
    const hc = key ? plan.values[rowId("ending-hc", band.id)]?.[key] ?? 0 : 0;
    weightSum += hc;
    costSum += hc * (rates[band.id] ?? 0);
  }
  const iRate = weightSum ? costSum / weightSum : null;
  const currentHc = key ? plan.values["ending-hc"]?.[key] ?? null : null;

  const revenue = Number(revenueM) * 1_000_000;
  const gpPct = Number(gp) / 100;
  const urPct = Number(ur) / 100;
  const workDays = Number(days);
  const valid = revenue > 0 && gpPct >= 0 && gpPct < 1 && urPct > 0 && urPct <= 1.5 && workDays > 0 && iRate;
  const price = valid ? iRate / (1 - gpPct) : null; // revenue per billable FTE-day at the target GP
  const perFte = price ? price * workDays * urPct : null; // revenue one FTE brings in a year
  const required = perFte ? revenue / perFte : null;
  const forForecast = perFte ? fyRevenue / perFte : null;
  const gap = required !== null && currentHc !== null ? required - currentHc : null;

  return (
    <section className="prod-card prod-fte" aria-labelledby="fte-title">
      <h3 id="fte-title">FTE required for the revenue target</h3>
      <div className="prod-inputs">
        <label>
          Revenue target (USD M)
          <input inputMode="decimal" value={revenueM} onChange={(e) => setRevenueM(e.target.value)} />
        </label>
        <label>
          GP %
          <input inputMode="decimal" value={gp} onChange={(e) => setGp(e.target.value)} />
        </label>
        <label>
          Billable UR %
          <input inputMode="decimal" value={ur} onChange={(e) => setUr(e.target.value)} />
        </label>
        <label>
          Working days a year
          <input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
        </label>
      </div>
      {valid ? (
        <>
          <dl className="prod-calc">
            <div>
              <dt>Revenue needed per calendar day</dt>
              <dd>{money(revenue / 365)}</dd>
            </div>
            <div>
              <dt>Weighted average cost per FTE per day (iRate)</dt>
              <dd>{money(iRate)}</dd>
            </div>
            <div>
              <dt>Revenue per FTE per billable day at {pct(gpPct)} GP</dt>
              <dd>{money(price)}</dd>
            </div>
            <div>
              <dt>Revenue one FTE brings in a year ({int0.format(workDays)} days × {pct(urPct)} UR)</dt>
              <dd>{money(perFte)}</dd>
            </div>
          </dl>
          <div className="prod-result">
            <div>
              <span className="prod-big">{int0.format(required ?? 0)}</span> FTE required
            </div>
            <div>
              <span className="prod-big">{currentHc === null ? "–" : int0.format(currentHc)}</span> HC today
              {lastActual ? ` (${lastActual.key})` : ""}
            </div>
            <div className={gap !== null && gap > 0 ? "prod-gap short" : "prod-gap"}>
              <span className="prod-big">{gap === null ? "–" : `${gap > 0 ? "+" : ""}${int0.format(gap)}`}</span>{" "}
              {gap !== null && gap > 0 ? "FTE short" : "FTE spare"}
            </div>
          </div>
          <p className="note">
            This year&apos;s revenue on the plan ({mUsd(fyRevenue)}) needs {int0.format(forForecast ?? 0)} FTE at these
            rates. Formula: revenue target ÷ (iRate ÷ (1 − GP %) × working days × UR).
          </p>
        </>
      ) : (
        <p className="note">Enter a revenue target, a GP % below 100, a UR % and the working days.</p>
      )}
    </section>
  );
}

// ---- 3. By agency and project ----
function figuresCells(f: ProductivityFigures) {
  return (
    <>
      <td className="num">{mUsd(f.revenue)}</td>
      <td className="num">{dec1.format(f.fte)}</td>
      <td className="num">{kUsd(f.revenuePerFte)}</td>
      <td className="num">{kUsd(f.gpPerFte)}</td>
      <td className="num">{ratio(f.revenuePerHcCost)}</td>
      <td className="num">{f.requiredFte === null ? "–" : dec1.format(f.requiredFte)}</td>
    </>
  );
}

function AgencyTable({ agencies, plan }: { agencies: AgencyProductivity[]; plan: CapacityPlan }) {
  const p = plan.productivity!;
  const [filter, setFilter] = useState<"attention" | "all">("attention");
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const attention = agencies.filter((a) => a.flag === "red" || a.flag === "amber");
  const shown = filter === "attention" ? attention : agencies;
  const toggle = (name: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  const r = p.rules;
  const avg = p.companyAverage;

  return (
    <section className="prod-card prod-agencies" aria-labelledby="agency-title">
      <div className="prod-agency-head">
        <h3 id="agency-title">Agencies and projects needing attention</h3>
        <div className="segmented" role="group" aria-label="Show">
          <button type="button" className={filter === "attention" ? "on" : ""} aria-pressed={filter === "attention"}
            onClick={() => setFilter("attention")}>
            Red or amber ({attention.length})
          </button>
          <button type="button" className={filter === "all" ? "on" : ""} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
            All agencies ({agencies.length})
          </button>
        </div>
      </div>
      <p className="note">
        {p.fiscalYear} {monthLabel(p.months[0])} to {monthLabel(p.months[p.months.length - 1])}. Revenue from the ABCD
        report; delivery FTE from the people planned on each project in SL x RP; per-FTE figures annualised. Company
        average (all agencies with at least {r.minFte} FTE): Revenue per FTE {kUsd(avg.revenuePerFte)}, GP per FTE{" "}
        {kUsd(avg.gpPerFte)}, Revenue per $ of HC cost {ratio(avg.revenuePerHcCost)}. Open an agency for its projects.
      </p>
      {r.draft && (
        <p className="prod-draft" role="note">
          Draft thresholds, waiting for Ethan to confirm: red when{" "}
          {r.metrics.map((m) => (m === "revenuePerFte" ? "Revenue per FTE" : "GP per FTE")).join(" or ")} is more than{" "}
          {pct(r.productivity.redBelowPct)} below the company average, amber when {pct(r.productivity.amberBelowPct)} to{" "}
          {pct(r.productivity.redBelowPct)} below; staffing red when actual FTE is more than {pct(r.staffing.redOffPct)} off
          the FTE required, amber when {pct(r.staffing.amberOffPct)} to {pct(r.staffing.redOffPct)} off.
        </p>
      )}
      <div className="prod-scroll">
        <table className="review-table prod-table">
          <thead>
            <tr>
              <th scope="col">Agency / project</th>
              <th scope="col">Status</th>
              <th scope="col" className="num">Revenue YTD</th>
              <th scope="col" className="num">Delivery FTE</th>
              <th scope="col" className="num">Revenue per FTE</th>
              <th scope="col" className="num">GP per FTE</th>
              <th scope="col" className="num">Revenue per $ HC cost</th>
              <th scope="col" className="num">FTE required</th>
              <th scope="col">Why</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((a) => {
              const isOpen = open.has(a.agency);
              return (
                <Fragment key={a.agency}>
                  <tr className={`prod-agency flag-${a.flag ?? "none"}`}>
                    <th scope="row">
                      <button type="button" className="plan-toggle" aria-expanded={isOpen} onClick={() => toggle(a.agency)}>
                        <span aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
                        {a.agency}
                        <span className="note"> · {a.projects.length} project{a.projects.length === 1 ? "" : "s"}</span>
                      </button>
                    </th>
                    <td>
                      <FlagPill flag={a.flag} />
                    </td>
                    {figuresCells(a)}
                    <td className="prod-why">{a.flagReason}</td>
                  </tr>
                  {isOpen &&
                    a.projects.map((pr) => (
                      <tr key={pr.projectId} className="prod-project">
                        <th scope="row">
                          {pr.projectName}
                          <span className="note"> · {pr.projectId}</span>
                        </th>
                        <td>
                          <FlagPill flag={pr.flag} />
                        </td>
                        {figuresCells(pr)}
                        <td className="prod-why">{pr.flagReason}</td>
                      </tr>
                    ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {shown.length === 0 && <p className="note review-none">No agency is flagged.</p>}
      </div>
    </section>
  );
}

export default function ProductivitySection({ plan }: { plan: CapacityPlan }) {
  const fy = reportingYear(plan);
  const now = useMemo(() => thisYearBaseline(plan, fy), [plan, fy]);
  const before = useMemo(() => lastYearBaseline(plan, fy), [plan, fy]);
  if (!plan.months || plan.months.length === 0) return null;

  const tiles: { label: string; value: string; was: string | null; delta: string | null }[] = now
    ? [
        { label: "Revenue per HC", value: kUsd(now.revenuePerHc), was: before ? kUsd(before.revenuePerHc) : null,
          delta: change(now.revenuePerHc, before?.revenuePerHc) },
        { label: "GP per HC", value: kUsd(now.gpPerHc), was: before ? kUsd(before.gpPerHc) : null,
          delta: change(now.gpPerHc, before?.gpPerHc) },
        { label: "Revenue per $ of HC cost", value: ratio(now.revenuePerHcCost),
          was: before ? ratio(before.revenuePerHcCost) : null, delta: change(now.revenuePerHcCost, before?.revenuePerHcCost) },
      ]
    : [];

  return (
    <div className="productivity">
      <h2 className="prod-title">How productive are we, and who needs attention?</h2>
      {now && (
        <section className="prod-card" aria-labelledby="baseline-title">
          <h3 id="baseline-title">Organisation baseline</h3>
          <p className="note">
            {fy} to date ({monthLabel(now.months[0])} to {monthLabel(now.months[now.months.length - 1])}), annualised:{" "}
            {mUsd(now.revenue)} revenue run-rate over an average of {int0.format(now.headcount)} delivery HC. GP is revenue
            minus HC cost at the rate card (iRate).
          </p>
          <div className="prod-tiles">
            {tiles.map((t) => (
              <div key={t.label} className="prod-tile">
                <div className="prod-tile-label">{t.label}</div>
                <div className="prod-tile-value">{t.value}</div>
                {t.was && (
                  <div className="prod-tile-was">
                    {before?.label}: {t.was}
                    {t.delta && <span className={t.delta.startsWith("▼") ? " down" : " up"}> {t.delta}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
          {before && (
            <p className="note">
              {before.label}: ABCD revenue {mUsd(before.revenue)} over {int0.format(before.headcount)} average HC and
              staff cost from the {before.source}.
            </p>
          )}
        </section>
      )}
      <FteRequired plan={plan} fy={fy} />
      {plan.productivity && plan.productivity.agencies.length > 0 ? (
        <AgencyTable agencies={plan.productivity.agencies} plan={plan} />
      ) : (
        <p className="note">
          The breakdown by agency and project appears once an ABCD report with actual months and an SL x RP file are
          uploaded.
        </p>
      )}
    </div>
  );
}
