// src/pages/DashboardPage.tsx
// Charts built from the capacity plan. Finance/HR only (see DASHBOARD_ROLES), because the plan holds revenue, cost
// and margin; the route in App.tsx does the check.

import CapacityCharts from "../dashboard/CapacityCharts";
import InsightsSection from "../dashboard/InsightsSection";

export default function DashboardPage() {
  return (
    <main className="dashboard-page">
      <header className="page-header">
        <h1>Organisational Dashboard View</h1>
        <p>
          How are we doing today? Demand on won and ongoing work against our headcount, the agencies that need attention,
          who can be redeployed, and the capacity plan. All amounts in USD.
        </p>
      </header>


      <div className="dashboard-body">
        <CapacityCharts />
        <InsightsSection />
      </div>
    </main>
  );
}
