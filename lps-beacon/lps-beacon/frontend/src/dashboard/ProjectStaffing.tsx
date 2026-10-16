// src/dashboard/ProjectStaffing.tsx
// How staffed each project is. Finance users also see cost. (This is the original dashboard content.)
// It loads its own data, so if it fails the capacity plan charts above it still work.

import { useEffect, useState } from "react";
import { getDashboard } from "../api/client";
import type { ProjectSummary } from "../api/types";
import { useAuth } from "../auth/useAuth";

export default function ProjectStaffing() {
  const { token } = useAuth();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null); // null = still loading
  const [error, setError] = useState<string | null>(null);

  // Load the data once when the page opens (and again if the token changes).
  useEffect(() => {
    let cancelled = false; // stops us updating the screen if the user already left the page
    getDashboard(token ?? undefined)
      .then((data) => {
        if (!cancelled) setProjects(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the dashboard.");
      });
    return () => {
      cancelled = true; // cleanup that runs when the page closes
    };
  }, [token]);

  // Numbers for the summary boxes. They only make sense once data has arrived.
  const needed = projects?.reduce((sum, p) => sum + p.needed, 0) ?? 0;
  const assigned = projects?.reduce((sum, p) => sum + p.assigned, 0) ?? 0;
  const open = projects?.reduce((sum, p) => sum + Math.max(0, p.needed - p.assigned), 0) ?? 0;
  // Show the cost column only if the backend sent cost figures (it does so for finance only).
  const showCost = projects?.some((p) => p.costPerMonth !== undefined) ?? false;
  const totalCost = projects?.reduce((sum, p) => sum + (p.costPerMonth ?? 0), 0) ?? 0;

  return (
    <section className="staffing-section">
      <h2 className="dashboard-heading">Project staffing</h2>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {!projects && !error && <p className="note">Loading…</p>}

      {projects && (
        <>
          <div className="stats">
            <div className="stat">
              <div className="stat-value">{needed}</div>
              <div className="stat-label">People needed</div>
            </div>
            <div className="stat">
              <div className="stat-value">{assigned}</div>
              <div className="stat-label">People assigned</div>
            </div>
            <div className="stat">
              <div className="stat-value">{open}</div>
              <div className="stat-label">Open positions</div>
            </div>
            {showCost && (
              <div className="stat">
                <div className="stat-value">{totalCost.toLocaleString()}</div>
                <div className="stat-label">Cost per month</div>
              </div>
            )}
          </div>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Staffed</th>
                  <th className="num">Open</th>
                  {showCost && <th className="num">Cost per month</th>}
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => {
                  const gap = p.needed - p.assigned; // positive = short, negative = over-staffed
                  const pct = Math.min(100, (p.assigned / p.needed) * 100); // bar fill, capped at 100%
                  return (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td>
                        {p.assigned} of {p.needed}
                        <div className="bar">
                          {/* The width is set inline because it depends on the data. */}
                          <div className={gap < 0 ? "bar-fill over" : "bar-fill"} style={{ width: `${pct}%` }} />
                        </div>
                      </td>
                      <td className="num">
                        {gap > 0 ? gap : gap < 0 ? <span className="over-text">Over by {-gap}</span> : "0"}
                      </td>
                      {showCost && <td className="num">{(p.costPerMonth ?? 0).toLocaleString()}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
