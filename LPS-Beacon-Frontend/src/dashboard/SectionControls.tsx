// src/dashboard/SectionControls.tsx
// "Expand all" / "Collapse all" for the Dashboard's collapsible sections. Sits just above the first one,
// styled like the expand / collapse buttons on the Analysis page.

import { setAllDashboardSections } from "./sectionState";

export default function SectionControls() {
  return (
    <div className="dashboard-section-controls">
      <button type="button" className="secondary-button" onClick={() => setAllDashboardSections(true)}>
        Expand all
      </button>
      <button type="button" className="secondary-button" onClick={() => setAllDashboardSections(false)}>
        Collapse all
      </button>
    </div>
  );
}
