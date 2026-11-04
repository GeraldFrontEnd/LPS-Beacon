// src/pages/DashboardPage.tsx
// The Organisational Dashboard View: one "How are we doing today?" page (3 Nov instructions 9.4 D-G). Finance/HR only
// (see DASHBOARD_ROLES), because it holds revenue and cost; the route in App.tsx does the check.
//
//  Filter bar      agency, project ID and period (latest month or a fiscal quarter), with a jump bar to the groups
//                  below; the header cards and the people list recalculate. Full window width (4 Nov 2026).
//  Groups          Today: header cards · who is on it (full width, right under the cards) · demand vs capacity |
//                         headcount waterfall
//                  Who needs attention: agencies flagged red | productivity vs the company baseline + hiring what-if
//                  Can we redeploy: bench by quarter and who can start soonest (full width)
//                  Capacity plan: the plan's charts over the months (full width, charts side by side)
//                  "a | b" = side by side, each half the page, on a large screen; one under the other on a smaller one.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { reportingYear } from "../analysis/baseline";
import { getCapacityPlan, getDashboardInsights, getDashboardView } from "../api/client";
import type { CapacityPlan, DashboardView } from "../api/types";
import { useAuth } from "../auth/useAuth";
import BenchView from "../dashboard/BenchView";
import CapacityCharts from "../dashboard/CapacityCharts";
import DashboardSection from "../dashboard/DashboardSection";
import DemandCapacity from "../dashboard/DemandCapacity";
import HeaderCards from "../dashboard/HeaderCards";
import HeadcountBridge from "../dashboard/HeadcountBridge";
import PeopleTable from "../dashboard/PeopleTable";
import ProductivityChart from "../dashboard/ProductivityChart";
import SectionControls from "../dashboard/SectionControls";
import type { DashboardInsights } from "../dashboard/insightTypes";
import { periodChoices } from "../dashboard/period";

const RED_SHOWN = 12;

// The page's groups, in order, for the jump bar.
const GROUPS = [
  { id: "group-today", label: "Today" },
  { id: "group-attention", label: "Who needs attention" },
  { id: "group-redeploy", label: "Can we redeploy" },
  { id: "group-plan", label: "Capacity plan" },
];

function jumpTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
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
  // The people list shows the last month of the period (the month the People card counts).
  const month = period?.months[period.months.length - 1] ?? null;

  // The filtered figures come from GET /dashboard?agency=&projectId=&month= (the lists come with every answer).
  useEffect(() => {
    let cancelled = false;
    getDashboardView({ agency: projectId ? null : agency || null, projectId: projectId || null, month }, token ?? undefined)
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
              "Showing all agencies instead."
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
    if (arrivedWith && view?.people && !scrolled.current) {
      scrolled.current = true;
      document.getElementById("dashboard-section-people")?.closest("section")?.scrollIntoView({ block: "start" });
    }
  }, [arrivedWith, view?.people]);
  const fy = plan ? reportingYear(plan) : "FY26";
  const projects = (view?.filters.projects ?? []).filter((p) => !agency || p.agency === agency);
  const filterName = projectId
    ? `${view?.selection?.name ?? projectId} (${projectId})`
    : agency || "All agencies";
  const red = (plan?.productivity?.agencies ?? []).filter((a) => a.flag === "red");

  if (error)
    return (
      <main className="dashboard-page">
        <p className="error-banner dashboard-banner" role="alert">
          {error}
        </p>
      </main>
    );
  if (!plan) return <main className="dashboard-page"><p className="note dashboard-banner">Loading…</p></main>;
  const hasPlan = Object.keys(plan.values).length > 0;

  return (
    <main className="dashboard-page">
      <header className="dash-header">
        <div className="dash-title">
          <h1>How are we doing today?</h1>
          <p>
            {filterName} · {period?.label ?? "–"}. All amounts in USD. Hover a figure to see how it is worked out.
          </p>
        </div>
        <div className="dash-filters">
          <label>
            Agency
            <select className="dash-filter-agency" value={agency}
              onChange={(e) => { setAgency(e.target.value); setProjectId(""); }}>
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
            <button type="button" className="secondary-button" onClick={() => { setAgency(""); setProjectId(""); }}>
              Clear filter
            </button>
          )}
        </div>
        {hasPlan && (
          <nav className="dash-jump" aria-label="Sections of this page">
            <span className="dash-jump-label">Go to</span>
            {GROUPS.map((g) => (
              <button key={g.id} type="button" className="dash-jump-link" onClick={() => jumpTo(g.id)}>
                {g.label}
              </button>
            ))}
            <span className="dash-jump-spacer" />
            <SectionControls />
          </nav>
        )}
      </header>

      <div className="dashboard-body">
        {filterNote && (
          <p className="note dash-filter-note" role="status">
            {filterNote}
          </p>
        )}
        {!hasPlan ? (
          <p className="note">No capacity plan yet. The Dashboard fills in once the uploaded files have been processed.</p>
        ) : (
          <>
            <h2 className="dash-group" id="group-today">Today</h2>
            {period && <HeaderCards plan={plan} view={view} period={period} fy={fy} />}

            <DashboardSection
              id="people"
              title={view?.selection ? `Who is on ${view.selection.kind === "project" ? "this project" : "this agency"}` : "Who is on it"}
              aside={view?.selection ? <span className="dashboard-aside"> · {filterName}</span> : undefined}
            >
              {view?.selection ? (
                <PeopleTable people={view.people} kind={view.selection.kind} />
              ) : (
                <p className="note">
                  Pick an agency (and a project, to narrow it) in the filter at the top to list the people on it, the
                  project each one is on, their planned and clocked days and their FTE.
                </p>
              )}
            </DashboardSection>

            <div className="dash-pair">
              <DashboardSection id="demand" title="Demand vs capacity">
                <div className="chart-grid">
                  <DemandCapacity plan={plan} view={view} />
                </div>
              </DashboardSection>
              <DashboardSection id="bridge" title="Headcount waterfall by quarter">
                <HeadcountBridge plan={plan} fy={fy} />
              </DashboardSection>
            </div>

            <h2 className="dash-group" id="group-attention">Who needs attention</h2>
            <div className="dash-pair">
              <DashboardSection id="attention" title={`Agencies needing attention (${red.length})`}>
                {red.length > 0 ? (
                  <ul className="attention-list">
                    {(allRed ? red : red.slice(0, RED_SHOWN)).map((a) => (
                      <li key={a.agency}>
                        <button type="button" className="attention-name" onClick={() => { setAgency(a.agency); setProjectId(""); }}
                          title="Show only this agency">
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
                  <button type="button" className="secondary-button attention-more" onClick={() => setAllRed((v) => !v)}>
                    {allRed ? "Show fewer" : `Show all ${red.length}`}
                  </button>
                )}
                <p className="note">
                  For management attention and Thomas&apos;s review{plan.productivity?.rules.draft ? " (draft thresholds)" : ""}. Click an
                  agency to filter the Dashboard to it, or <Link to="/analysis">see every agency and its projects</Link>.
                </p>
              </DashboardSection>
              <DashboardSection id="productivity" title="How productive are we? Against the company baseline">
                <ProductivityChart plan={plan} fy={fy} agency={agency || view?.selection?.agency || null} />
              </DashboardSection>
            </div>

            <h2 className="dash-group" id="group-redeploy">Can we redeploy?</h2>
            <DashboardSection id="bench" title="Bench by quarter and who can start soonest">
              <BenchView people={insights?.resources?.availability ?? []} asOf={insights?.asOf ?? null} />
            </DashboardSection>

            <h2 className="dash-group" id="group-plan">Capacity plan</h2>
            <DashboardSection id="capacity-plan" title="Headcount, joiners and leavers, and utilisation over the months">
              <CapacityCharts plan={plan} />
            </DashboardSection>
          </>
        )}
      </div>
    </main>
  );
}
