// src/pages/DashboardPage.tsx
// Charts built from the capacity plan. Finance/HR only (see DASHBOARD_ROLES), because the plan holds revenue, cost
// and margin; the route in App.tsx does the check.

import CapacityCharts from "../dashboard/CapacityCharts";

export default function DashboardPage() {
  return (
    <main className="dashboard-page">
      <header className="page-header">
        <h1>Organizational DashBoard View </h1>
        <p>Headcount, Utilisation and Margin Insights from the Capacity Plan Analysis.</p>
      </header>

      <div className="dashboard-body">
        <CapacityCharts />
      </div>
    </main>
  );
}
