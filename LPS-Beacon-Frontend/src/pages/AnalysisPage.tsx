// src/pages/AnalysisPage.tsx
// The Analysis tab: "How productive are we, and who needs attention?" (organisation actuals, agencies and projects,
// calculated FTE required, management target). The capacity plan table moved to its own tab on 3 Nov 2026
// (CapacityPlanPage.tsx).
// The whole page scrolls as one, so there is one vertical scroll bar.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import ProductivitySection from "../analysis/ProductivitySection";
import { getCapacityPlan, saveManagementTarget } from "../api/client";
import type { CapacityPlan, ManagementTargetEdit } from "../api/types";
import { useAuth } from "../auth/useAuth";
import { loadPageState, savePageState } from "../lib/pageState";

export default function AnalysisPage() {
  const { token } = useAuth();
  const [plan, setPlan] = useState<CapacityPlan | null>(null); // null = still loading
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Where the page was scrolled to, remembered for 30 minutes (lib/pageState.ts) and put back once the data is drawn.
  const main = useRef<HTMLElement | null>(null);
  const restored = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getCapacityPlan(token ?? undefined)
      .then((data) => !cancelled && setPlan(data))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Could not load the analysis."));
    return () => {
      cancelled = true;
    };
  }, [token]);

  // One typed line of the management target: saved for everyone, and the page gets the plan back.
  async function saveTarget(edit: ManagementTargetEdit) {
    setSaving(true);
    setError(null);
    try {
      setPlan(await saveManagementTarget(edit, token ?? undefined));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the change.");
    } finally {
      setSaving(false);
    }
  }

  useLayoutEffect(() => {
    if (!plan || restored.current || !main.current) return;
    restored.current = true;
    main.current.scrollTop = loadPageState("analysis.scroll", 0);
  }, [plan]);

  const empty = plan !== null && Object.keys(plan.values).length === 0;

  return (
    <main
      ref={main}
      className="analysis-page productivity-page"
      onScroll={(e) => restored.current && savePageState("analysis.scroll", e.currentTarget.scrollTop)}
    >
      <header className="page-header">
        <h1>Analysis</h1>
        <p>
          How many FTE a revenue target needs (or the revenue an FTE count brings), the organisation's actuals so far,
          which agencies and projects need attention and who works on them, and where we stand against the management target. All amounts in USD. The month-by-month numbers are on the{" "}
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
      {plan && !empty && <ProductivitySection plan={plan} savingTarget={saving} onSaveTarget={(e) => void saveTarget(e)} />}
    </main>
  );
}
