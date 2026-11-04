// src/pages/DashboardPage.tsx
// The Organisational Dashboard View: one "How are we doing today?" page (3 Nov instructions 9.4 D-G). Finance/HR only
// (see DASHBOARD_ROLES), because it holds revenue and cost; the route in App.tsx does the check.
//
//  Filter bar      agency, project ID and period (latest month or a fiscal quarter); the header cards recalculate
//  Header cards    headcount, permanent vs secondment, billable UR, FTE demand, FTE required, bench or shortage
//  Sections        demand vs capacity · productivity vs the company baseline + hiring what-if · agencies needing
//                  attention · bench by quarter and who can start soonest · headcount waterfall · capacity plan trends

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
import ProductivityChart from "../dashboard/ProductivityChart";
import SectionControls from "../dashboard/SectionControls";
import type { DashboardInsights } from "../dashboard/insightTypes";
import { periodChoices } from "../dashboard/period";

export default function DashboardPage() {
  const { token } = useAuth();
  const [plan, setPlan] = useState<CapacityPlan | null>(null);
  const [insights, setInsights] = useState<DashboardInsights | null>(null);
  const [view, setView] = useState<DashboardView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agency, setAgency] = useState("");
  const [projectId, setProjectId] = useState("");
  const [periodId, setPeriodId] = useState("latest");

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

  // The filtered figures come from GET /dashboard?agency=&projectId= (the lists come with every answer).
  useEffect(() => {
    let cancelled = false;
    getDashboardView({ agency: projectId ? null : agency || null, projectId: projectId || null }, token ?? undefined)
      .then((v) => !cancelled && setView(v))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Could not load the filter."));
    return () => {
      cancelled = true;
    };
  }, [token, agency, projectId]);

  const periods = useMemo(() => (plan ? periodChoices(plan) : []), [plan]);
  const period = periods.find((p) => p.id === periodId) ?? periods[0];
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
      </header>

      <div className="dashboard-body">
        {!hasPlan ? (
          <p className="note">No capacity plan yet. The Dashboard fills in once the uploaded files have been processed.</p>
        ) : (
          <>
            {period && <HeaderCards plan={plan} view={view} period={period} fy={fy} />}
            <SectionControls />

            <DashboardSection id="demand" title="Demand vs capacity">
              <div className="chart-grid">
                <DemandCapacity plan={plan} view={view} />
              </div>
            </DashboardSection>

            <DashboardSection id="productivity" title="How productive are we? Against the company baseline">
              <ProductivityChart plan={plan} fy={fy} agency={agency || view?.selection?.agency || null} />
            </DashboardSection>

            <DashboardSection id="attention" title={`Agencies needing attention (${red.length})`}>
              {red.length > 0 ? (
                <ul className="attention-list">
                  {red.map((a) => (
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
              <p className="note">
                For management attention and Thomas&apos;s review{plan.productivity?.rules.draft ? " (draft thresholds)" : ""}. Click an
                agency to filter the Dashboard to it, or <Link to="/analysis">see every agency and its projects</Link>.
              </p>
            </DashboardSection>

            <DashboardSection id="bench" title="Can we redeploy? Bench by quarter and who can start soonest">
              <BenchView people={insights?.resources?.availability ?? []} asOf={insights?.asOf ?? null} />
            </DashboardSection>

            <DashboardSection id="bridge" title="Headcount waterfall by quarter">
              <HeadcountBridge plan={plan} fy={fy} />
            </DashboardSection>

            <DashboardSection id="capacity-plan" title="Capacity plan over the months">
              <CapacityCharts plan={plan} />
            </DashboardSection>
          </>
        )}
      </div>
    </main>
  );
}
