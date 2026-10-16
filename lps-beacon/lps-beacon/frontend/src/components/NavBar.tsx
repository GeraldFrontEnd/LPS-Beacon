// src/components/NavBar.tsx
// The bar at the top with links to each page, the user's name, and Sign out.

// NavLink is like a normal link, but it knows whether it points to the page you are on.
import { NavLink } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { ANALYSIS_ROLES, ROLE_LABELS, UPLOAD_ROLES } from "../auth/permissions";

// NavLink calls this function with { isActive } and uses the text we return as the class name.
function linkClass({ isActive }: { isActive: boolean }): string {
  return isActive ? "nav-link active" : "nav-link";
}

export default function NavBar() {
  const { user, signOut } = useAuth();

  // Nobody logged in (for example on the login page): show no bar at all.
  if (!user) return null;

  // Only some roles may upload, so only they see that link.
  const canUpload = UPLOAD_ROLES.includes(user.role);
  const canSeeAnalysis = ANALYSIS_ROLES.includes(user.role); // only finance sees the Analysis tab

  return (
    // aria-label tells screen readers what this navigation is for.
    <nav className="nav" aria-label="Main">
      {/* "end" means this link is only active on exactly "/", not on every page that starts with "/". */}
      <NavLink to="/" end className={linkClass}>
        Chat
      </NavLink>
      <NavLink to="/dashboard" className={linkClass}>
        Dashboard
      </NavLink>
      {canUpload && (
        <NavLink to="/upload" className={linkClass}>
          Upload files
        </NavLink>
      )}
      {canSeeAnalysis && (
        <NavLink to="/analysis" className={linkClass}>
          Analysis
        </NavLink>
      )}
      {/* Pushed to the right edge by CSS (margin-left: auto). */}
      <span className="nav-user">
        {user.name} · {ROLE_LABELS[user.role]}
      </span>
      <button type="button" className="nav-signout" onClick={signOut}>
        Sign out
      </button>
    </nav>
  );
}
