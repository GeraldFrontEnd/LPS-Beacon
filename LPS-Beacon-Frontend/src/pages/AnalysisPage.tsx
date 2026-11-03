// src/pages/AnalysisPage.tsx
// The Analysis tab: "How productive are we, and who needs attention?" (organisation baseline, agencies and projects,
// FTE required). The capacity plan table moved to its own tab on 3 Nov 2026 (CapacityPlanPage.tsx).
// The whole page scrolls as one, so there is one vertical scroll bar.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ProductivitySection from "../analysis/ProductivitySection";
import { getCapacityPlan } from "../api/client";
import type { CapacityPlan } from "../api/types";
import { useAuth } from "../auth/useAuth";

export default function AnalysisPage() {
  const { token } = useAuth();
  const [plan, setPlan] = useState<CapacityPlan | null>(null); // null = still loading
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCapacityPlan(token ?? undefined)
      .then((data) => !cancelled && setPlan(data))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Could not load the analysis."));
    return () => {
      cancelled = true;
    };
  }, [token]);

  const empty = plan !== null && Object.keys(plan.values).length === 0;

  return (
    <main className="analysis-page productivity-page">
      <header className="page-header">
        <h1>Analysis</h1>
        <p>
          How productive we are against the company baseline, which agencies and projects need attention, and how many FTE a
          revenue target needs. All amounts in USD. The month-by-month numbers are on the{" "}
          <Link to="/capacity-plan">Capacity plan</Link> tab.
        </p>
      </header>
      {error && (
        <p className="error-banner analysis-banner" role="alert">
          {error}
        </p>
      )}
      {!plan && !error && <p className="note analysis-banner">Loading…</p>}
      {empty && (
        <p className="note analysis-banner">
          Nothing to analyse yet. The figures appear once the system has processed the uploaded files.
        </p>
      )}
      {plan && !empty && <ProductivitySection plan={plan} />}
    </main>
  );
}
