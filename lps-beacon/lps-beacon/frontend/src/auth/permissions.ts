// src/auth/permissions.ts
// The ONE place that says which role may do what in the screens.
// To change who can open a page, edit this file and nothing else.
// Important: this only controls what the SCREENS show. Real data protection
// (for example hiding salaries) must be enforced by the backend, because anyone
// can tamper with code running in their own browser.

import type { Role } from "./types";

// Roles that are allowed to open the Upload page.
// This is an assumption: confirm with your team who should be able to upload.
export const UPLOAD_ROLES: Role[] = ["hr", "finance"];

// Friendly names shown on screen.
export const ROLE_LABELS: Record<Role, string> = {
  hr: "HR",
  pm: "Project manager",
  finance: "Finance",
};

// Roles that are allowed to open the Analysis page (the capacity plan). Finance only, because it shows revenue, cost and margin.
export const ANALYSIS_ROLES: Role[] = ["finance"];
