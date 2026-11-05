// src/pages/DashboardPage.tsx
// The Organisational Dashboard View: one "How are we doing today?" page (3 Nov instructions 9.4 D-G). Finance/HR only
// (see DASHBOARD_ROLES), because it holds revenue and cost; the route in App.tsx does the check.
//
//  Laid out like the Analysis page (4 Nov 2026): plain cards, one under the other, no collapsible boxes, in two parts.
//  Filter bar      agency, project ID and period. It drives the first part only.
//  1. For the filter     the header cards · HC details by agency (Hwee Yu's layout: FTE as sold / as planned / actual,
//                        cost, ADR, projects and people; every agency, or the one picked) · demand vs capacity
//  2. Whole organisation not affected by the filter: agencies needing attention | productivity against the company
//                        baseline (the agency picked is outlined) · bench and who can start soonest | headcount
//                        waterfall · the capacity plan's charts
//  "a | b" = side by side, each half the page, on a large screen; one under the other on a smaller one.

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { reportingYear } from "../analysis/baseline";
import { getCapacityPlan, getDashboardInsights, getDashboardView } from "../api/client";
import type { CapacityPlan, DashboardView } from "../api/types";
import { useAuth } from "../auth/useAuth";
import BenchView from "../dashboard/BenchView";
import CapacityCharts from "../dashboard/CapacityCharts";
import DemandCapacity from "../dashboard/DemandCapacity";
import AgencyPanels from "../dashboard/AgencyPanels";
import HeaderCards from "../dashboard/HeaderCards";
import HeadcountBridge from "../dashboard/HeadcountBridge";
import ProductivityChart from "../dashboard/ProductivityChart";
import type { DashboardInsights } from "../dashboard/insightTypes";
import { periodChoices } from "../dashboard/period";

const RED_SHOWN = 12;

// One card of the page, the same frame as the Analysis page's (prod-card): a title, a line on what it shows, then
// the content.
function Card({ id, title, sub, children }: { id?: string; title: ReactNode; sub?: ReactNode; children: ReactNode }) {
  return (
    <section className="prod-card" id={id}>
      <header className="prod-card-head">
        <div>
          <h3>{title}</h3>
          {sub && <p className="prod-sub">{sub}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

export default function DashboardPage() {
  const { token } = useAuth();
  const [plan, setPlan] = useState<CapacityPlan | null>(null);
  const [insights, setInsights] = useState<DashboardInsights | null>(null);
  const [view, setView] = useState<DashboardView | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The filter lives in the address (?agency=&projectId=&period=), so the Analysis page can open a project here,
  // the browser's back button works, and a filtered view can be bookmarked or shared.
  const [params, setParams] = useSearchParams();
  const [agency, setAgency] = useState(() => params.get("agency") ?? "");
  const [projectId, setProjectId] = useState(() => params.get("projectId") ?? "");
  const [periodId, setPeriodId] = useState(() => params.get("period") ?? "latest");
  const [filterNote, setFilterNote] = useState<string | null>(null);
  const [arrivedWith] = useState(() => params.get("projectId")); // opened from another page: show its people
  const [allRed, setAllRed] = useState(false); // the red agencies list starts with the first RED_SHOWN

  useEffect(() => {
    let cancelled = false;
    Promise.all([getCapacityPlan(token ?? undefined), getDashboardInsights(token ?? undefined)])
      .then(([p, i]) => {
        if (cancelled) return;
        setPlan(p);
        setInsights(i);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Could not load the Dashboard."));
    return () => {
      cancelled = true;
    };
  }, [token]);

  const periods = useMemo(() => (plan ? periodChoices(plan) : []), [plan]);
  const period = periods.find((p) => p.id === periodId) ?? periods[0];
  // The HC details show the last month of the period (the month the People card counts).
  const month = period?.months[period.months.length - 1] ?? null;

  // The filtered figures come from GET /dashboard?agency=&projectId=&month= (the lists come with every answer).
  useEffect(() => {
    let cancelled = false;
    getDashboardView(
      { agency: projectId ? null : agency || null, projectId: projectId || null, month },
      token ?? undefined,
    )
      .then((v) => {
        if (cancelled) return;
        setView(v);
        setFilterNote(null);
        // A project opened from elsewhere: show its agency in the Agency box too.
        const sel = v?.selection;
        if (sel?.kind === "project" && sel.agency && !agency) setAgency(sel.agency);
      })
      .catch((err) => {
        if (cancelled) return;
        // A project or agency the Dashboard has no plan for (e.g. revenue only): say so and keep the page.
        if (projectId || agency) {
          setFilterNote(
            `${projectId || agency} has no people or demand planned in the resource plan, so the Dashboard can't show it. ` +
              "Showing all agencies instead.",
          );
          setProjectId("");
          setAgency("");
        } else setError(err instanceof Error ? err.message : "Could not load the filter.");
      });
    return () => {
      cancelled = true;
    };
  }, [token, agency, projectId, month]);

  // Keep the address in step with the filter (replace, so each change is not a new history entry).
  useEffect(() => {
    const next = new URLSearchParams();
    if (agency) next.set("agency", agency);
    if (projectId) next.set("projectId", projectId);
    if (periodId !== "latest") next.set("period", periodId);
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [agency, projectId, periodId, params, setParams]);

  // Opened on a project: bring its people into view once, when they are loaded.
  const scrolled = useRef(false);
  useEffect(() => {
    if (arrivedWith && view?.agencyPanels && !scrolled.current) {
      scrolled.current = true;
      document.getElementById("dash-people")?.scrollIntoView({ block: "start" });
    }
  }, [arrivedWith, view?.agencyPanels]);
  const fy = plan ? reportingYear(plan) : "FY26";
  const projects = (view?.filters.projects ?? []).filter((p) => !agency || p.agency === agency);
  const filterName = projectId ? `${view?.selection?.name ?? projectId} (${projectId})` : agency || "All agencies";
  const red = (plan?.productivity?.agencies ?? []).filter((a) => a.flag === "red");

  if (error)
    return (
      <main className="dashboard-page">
        <p className="error-banner dashboard-banner" role="alert">
          {error}
        </p>
      </main>
    );
  if (!plan)
    return (
      <main className="dashboard-page">
        <p className="note dashboard-banner">Loading…</p>
      </main>
    );
  const hasPlan = Object.keys(plan.values).length > 0;

  return (
    <main className="dashboard-page">
      <header className="dash-header">
        <div className="dash-title">
          <h1>How are we doing today?</h1>
          <p>
            Two sections: the first follows the agency, project and period you pick; the second is the whole
            organisation. All amounts in USD. Hover a figure to see how it is worked out.
          </p>
        </div>
      </header>

      <div className="dashboard-body">
        {filterNote && (
          <p className="note dash-filter-note" role="status">
            {filterNote}
          </p>
        )}
        {!hasPlan ? (
          <p className="note">
            No capacity plan yet. The Dashboard fills in once the uploaded files have been processed.
          </p>
        ) : (
          <>
            {/* Section 1: everything here follows the filter, which sits at its top. */}
            <section className="dash-block" aria-labelledby="dash-filtered-title">
              <div className="dash-block-head">
                <div>
                  <h2 id="dash-filtered-title">
                    {filterName} · {period?.label ?? "–"}
                  </h2>
                  <p className="dash-part-note">Pick an agency, a project and a period: this section follows them.</p>
                </div>
                <div className="dash-filters">
                  <label>
                    Agency
                    <select
                      className="dash-filter-agency"
                      value={agency}
                      onChange={(e) => {
                        setAgency(e.target.value);
                        setProjectId("");
                      }}
                    >
                      <option value="">All agencies</option>
                      {(view?.filters.agencies ?? []).map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Project ID
                    <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                      <option value="">{agency ? "All its projects" : "All projects"}</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.id} · {p.name.length > 40 ? `${p.name.slice(0, 39)}…` : p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Period
                    <select value={period?.id ?? "latest"} onChange={(e) => setPeriodId(e.target.value)}>
                      {periods.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.id === "latest" ? `Latest month (${p.label})` : p.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {(agency || projectId) && (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        setAgency("");
                        setProjectId("");
                      }}
                    >
                      Clear filter
                    </button>
                  )}
                </div>
              </div>
              {period && <HeaderCards plan={plan} view={view} period={period} />}

              <Card
                id="dash-people"
                title={`HC details by agency${view?.selection ? "" : " (every agency)"}`}
                sub={
                  "Each agency in the last month of the period: FTE as sold, as planned and actual, its total actual " +
                  "cost and ADR, its projects and the list of its people. Hover a figure to see how it is worked out."
                }
              >
                <AgencyPanels panels={view?.agencyPanels} plan={plan} />
              </Card>

              <Card
                title="Demand vs capacity"
                sub="Headcount (or the people planned), FTE demand and FTE actual by month."
              >
                <div className="chart-grid dash-chart-capped">
                  <DemandCapacity plan={plan} view={view} />
                </div>
              </Card>
            </section>

            {/* Section 2: the whole organisation, not filtered. */}
            <section className="dash-block" aria-labelledby="dash-org-title">
              <div className="dash-block-head">
                <div>
                  <h2 id="dash-org-title">Whole organisation</h2>
                  <p className="dash-part-note">Every agency, fiscal year to date. Not affected by the filter above.</p>
                </div>
              </div>
              <div className="dash-pair">
                <Card
                  title={`Agencies needing attention (${red.length})`}
                  sub={
                    <>
                      For management attention and Thomas&apos;s review
                      {plan.productivity?.rules.draft ? " (draft thresholds)" : ""}, fiscal year to date. Click an
                      agency to filter the page to it, or <Link to="/analysis">see every agency and its projects</Link>.
                    </>
                  }
                >
                  {red.length > 0 ? (
                    <ul className="attention-list">
                      {(allRed ? red : red.slice(0, RED_SHOWN)).map((a) => (
                        <li key={a.agency}>
                          <button
                            type="button"
                            className="attention-name"
                            onClick={() => {
                              setAgency(a.agency);
                              setProjectId("");
                            }}
                            title="Show only this agency"
                          >
                            {a.agency}
                          </button>
                          <span className="attention-why">{a.flagReason}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="note">No agency is flagged red.</p>
                  )}
                  {red.length > RED_SHOWN && (
                    <button
                      type="button"
                      className="secondary-button attention-more"
                      onClick={() => setAllRed((v) => !v)}
                    >
                      {allRed ? "Show fewer" : `Show all ${red.length}`}
                    </button>
                  )}
                </Card>

                <Card
                  title="How productive are we? Against the company baseline"
                  sub={
                    agency
                      ? `${agency} is outlined; the what-if below is for it.`
                      : "Pick an agency in the filter of the section above to outline it and run the what-if for it."
                  }
                >
                  <ProductivityChart plan={plan} fy={fy} agency={agency || view?.selection?.agency || null} />
                </Card>
              </div>

              <div className="dash-pair">
                <Card title="Can we redeploy? Bench by quarter and who can start soonest">
                  <BenchView people={insights?.resources?.availability ?? []} asOf={insights?.asOf ?? null} />
                </Card>

                <Card title="Headcount waterfall by quarter">
                  <HeadcountBridge plan={plan} fy={fy} />
                </Card>
              </div>

              <Card
                title="Capacity plan over the months"
                sub="Headcount by band, joiners and leavers, and billable utilisation by band."
              >
                <div className="dash-plan-charts">
                  <CapacityCharts plan={plan} />
                </div>
              </Card>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
