// src/auth/permissions.ts
// The ONE place that says which role may do what in the screens.
// To change who can open a page, edit this file and nothing else.
// Important: this only controls what the SCREENS show. Real data protection
// (for example hiding cost and margin) must be enforced by the backend, because anyone
// can tamper with code running in their own browser.

import type { Role } from "./types";

// Friendly names shown on screen.
export const ROLE_LABELS: Record<Role, string> = {
  restricted: "Restricted",
  finance_hr: "Finance/HR",
};

// Restricted accounts (mainly project managers) see the Chat page and nothing else; every other page needs a Finance/HR account.
const FINANCE_HR: Role[] = ["finance_hr"];

// Roles that are allowed to open the Dashboard page.
export const DASHBOARD_ROLES: Role[] = FINANCE_HR;

// Roles that are allowed to open the Upload page.
export const UPLOAD_ROLES: Role[] = FINANCE_HR;

// Roles that are allowed to open the Analysis page (the capacity plan, with revenue, cost and margin).
export const ANALYSIS_ROLES: Role[] = FINANCE_HR;
