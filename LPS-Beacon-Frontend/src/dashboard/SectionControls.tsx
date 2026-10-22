// src/dashboard/SectionControls.tsx
// "Expand all" / "Collapse all" for the Dashboard's collapsible sections. Sits just above the first one.

import { setAllDashboardSections } from "./sectionState";

export default function SectionControls() {
  return (
    <div className="dashboard-section-controls">
      <button type="button" className="link-button" onClick={() => setAllDashboardSections(true)}>
        Expand all
      </button>
      <span aria-hidden="true">·</span>
      <button type="button" className="link-button" onClick={() => setAllDashboardSections(false)}>
        Collapse all
      </button>
    </div>
  );
}
