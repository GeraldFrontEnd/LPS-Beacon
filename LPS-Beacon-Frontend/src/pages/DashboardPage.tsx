// src/pages/DashboardPage.tsx
// Charts built from the capacity plan. Finance only, because the plan holds revenue, cost and margin.

import CapacityCharts from "../dashboard/CapacityCharts";
import { ANALYSIS_ROLES } from "../auth/permissions";
import { useAuth } from "../auth/useAuth";

export default function DashboardPage() {
  const { user } = useAuth();
  const canSeePlan = !!user && ANALYSIS_ROLES.includes(user.role);

  return (
    <main className="dashboard-page">
      <header className="page-header">
        <h1>Organizational DashBoard View </h1>
        <p>Headcount, Utilisation and Margin Insights from the Capacity Plan Analysis.</p>
      </header>

      <div className="dashboard-body">
        {canSeePlan ? (
          <CapacityCharts />
        ) : (
          <p className="note">The dashboard is only available to finance users.</p>
        )}
      </div>
    </main>
  );
}