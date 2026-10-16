// src/pages/LoginPage.tsx
// The sign-in screen.

import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { DEMO_ACCOUNTS, IS_MOCK } from "../auth/authService";
import { ROLE_LABELS } from "../auth/permissions";

export default function LoginPage() {
  const { user, signIn, isLoading } = useAuth();
  const location = useLocation();

  // What the user has typed so far.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // The error text to show, or null for none.
  const [error, setError] = useState<string | null>(null);
  // true while we wait for the login to finish (to disable the button).
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Where to go after login: the page they originally tried to open, or the chat.
  // RequireAuth stored it in "location.state"; we tell TypeScript what shape it has.
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  // Still checking for an earlier login: show nothing yet, so the form doesn't flash.
  if (isLoading) return null;

  // Already logged in (including right after a successful login): leave this page.
  if (user) return <Navigate to={from} replace />;

  // Runs when the form is submitted.
  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); // stop the browser from reloading the page
    setError(null);
    setIsSubmitting(true);
    try {
      await signIn(email, password); // on success, "user" becomes set and the line above redirects
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-card">
        <h1>Sign in</h1>
        <p className="subtitle">Manpower assistant</p>

        <form onSubmit={handleSubmit}>
          {/* A label wrapped around an input links them: clicking the label focuses the box. */}
          <label className="field">
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username" // lets the browser's password manager help
              required
            />
          </label>
          <label className="field">
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          {error && (
            <p className="error-banner" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="primary-button" disabled={isSubmitting}>
            {isSubmitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {/* Practice accounts, shown only in mock mode. */}
        {IS_MOCK && (
          <div className="demo-box">
            <div>Practice accounts (password: demo123)</div>
            <ul>
              {DEMO_ACCOUNTS.map((a) => (
                <li key={a.email}>
                  <span>
                    {ROLE_LABELS[a.role]}: {a.email}
                  </span>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => {
                      setEmail(a.email); // fill in the form for the user
                      setPassword(a.password);
                    }}
                  >
                    Fill in
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </main>
  );
}
