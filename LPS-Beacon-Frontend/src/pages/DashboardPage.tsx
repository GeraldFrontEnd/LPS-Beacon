// src/pages/DashboardPage.tsx
// Charts built from the capacity plan. Finance/HR only (see DASHBOARD_ROLES), because the plan holds revenue, cost
// and margin; the route in App.tsx does the check.

import CapacityCharts from "../dashboard/CapacityCharts";
import InsightsSection from "../dashboard/InsightsSection";

export default function DashboardPage() {
  return (
    <main className="dashboard-page">
      <header className="page-header">
        <h1>Organizational DashBoard View </h1>
        <p>Headcount, utilisation and margin from the capacity plan, plus the sales pipeline, roll-offs and utilisation from the uploaded files. All amounts in USD.</p>
      </header>

      <div className="dashboard-body">
        <CapacityCharts />
        <InsightsSection />
      </div>
    </main>
  );
}
