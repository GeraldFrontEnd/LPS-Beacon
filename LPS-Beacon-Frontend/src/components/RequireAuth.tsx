// src/components/RequireAuth.tsx
// A guard placed around a page. Not logged in -> go to the login page.
// Logged in but the wrong role -> show a "No access" message.

import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { ROLE_LABELS } from "../auth/permissions";
import type { Role } from "../auth/types";

interface RequireAuthProps {
  children: ReactNode; // the page to protect
  allowedRoles?: Role[]; // optional: if given, only these roles may see the page
}

export default function RequireAuth({ children, allowedRoles }: RequireAuthProps) {
  const { user, isLoading } = useAuth(); // who is logged in, and whether we are still checking
  const location = useLocation(); // the address the user is trying to open

  // Still checking for an earlier login: show a short message instead of flashing the login page.
  if (isLoading) {
    return (
      <main className="notice-page">
        <div className="upload-body">
          <p className="note">Loading…</p>
        </div>
      </main>
    );
  }

  // Not logged in: send them to /login and remember where they wanted to go.
  // "replace" stops the login redirect from filling up the Back button history.
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  // Logged in, but this page is limited to certain roles and theirs isn't one of them.
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return (
      <main className="notice-page">
        <header className="page-header">
          <h1>No access</h1>
          <p>
            Your role ({ROLE_LABELS[user.role]}) can't open this page. Ask your team if you think
            this is a mistake.
          </p>
        </header>
      </main>
    );
  }

  // Everything is fine: show the page. <>...</> is an invisible wrapper.
  return <>{children}</>;
}
