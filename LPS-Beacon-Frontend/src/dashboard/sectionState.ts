// src/dashboard/sectionState.ts
// Which Dashboard sections are closed, remembered in this browser only, and the signal behind the page's
// "Expand all" / "Collapse all" buttons. Used by DashboardSection.tsx.

const STORAGE_KEY = "lps-beacon.dashboard.closedSections";
export const TOGGLE_ALL_EVENT = "lps-beacon:dashboard-sections";

export function readClosed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set(); // storage blocked (private window, preview): everything starts open
  }
}

export function rememberClosed(id: string, closed: boolean) {
  try {
    const ids = readClosed();
    if (closed) ids.add(id);
    else ids.delete(id);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // not remembered; the section still opens and closes
  }
}

// Opens (true) or closes (false) every section on the page.
export function setAllDashboardSections(open: boolean) {
  window.dispatchEvent(new CustomEvent<boolean>(TOGGLE_ALL_EVENT, { detail: open }));
}
