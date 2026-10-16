// src/pages/DashboardPage.tsx
// Finance users see charts built from the capacity plan. Everyone sees how staffed each project is.

import CapacityCharts from "../dashboard/CapacityCharts";
import ProjectStaffing from "../dashboard/ProjectStaffing";
import { ANALYSIS_ROLES } from "../auth/permissions";
import { useAuth } from "../auth/useAuth";

export default function DashboardPage() {
  const { user } = useAuth();
  // The capacity plan holds revenue, cost and margin, so its charts follow the same rule as the Analysis tab.
  const canSeePlan = !!user && ANALYSIS_ROLES.includes(user.role);

  return (
    <main className="dashboard-page">
      <header className="page-header">
        <h1>Dashboard</h1>
        <p>
          {canSeePlan
            ? "Headcount, utilisation and margin from the capacity plan, and how staffed each project is."
            : "How staffed each project is."}
        </p>
      </header>

      <div className="dashboard-body">
        {canSeePlan && <CapacityCharts />}
        <ProjectStaffing />
      </div>
    </main>
  );
}
