// src/pages/LoginPage.tsx
// The sign-in screen.

import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { DEMO_ACCOUNTS, IS_MOCK } from "../auth/authService";
import { ROLE_LABELS } from "../auth/permissions";
import lpsLogo from "../../LPSLogo.avif";

// Open eye: shown while the password is hidden, click to show it.
function EyeIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

// Crossed-out eye: shown while the password is visible, click to hide it.
function EyeOffIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

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
  // true when the password is shown as plain text (the eye button).
  const [showPassword, setShowPassword] = useState(false);

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
      {/* Brand in the top-left corner: "LPS-Beacon by <LPS logo>". */}
      <header className="login-header">
        <div className="login-brand">
          <span className="login-brand-name">LPS-Beacon</span>
          <span className="login-brand-by">
            by <img src={lpsLogo} alt="LPS, a Lenovo Company" className="login-brand-logo" />
          </span>
        </div>
        <Link to="/signup" className="login-signup-button">
          Sign Up
        </Link>
      </header>

      <div className="login-center">
        <div className="login-stack">
          {/* The LPS Beacon brand banner, sitting right on top of the sign-in card. */}
          <div className="login-logo">
            <span className="login-logo-text">LPS-Beacon</span>
            <span className="login-logo-slogan">Workforce Analytics Assistant</span>
          </div>

          <div className="login-card">
            <h1>Sign in</h1>

            <form onSubmit={handleSubmit}>
              {/* A label wrapped around an input links them: clicking the label focuses the box. */}
              <label className="field">
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@lpstech.com"
                  autoComplete="username" // lets the browser's password manager help
                  required
                />
              </label>
              <label className="field">
                Password
                {/* The eye button sits inside the box, on the right. */}
                <span className="password-wrap">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </span>
              </label>

              {error && (
                <p className="error-banner" role="alert">
                  {error}
                </p>
              )}

              <button type="submit" className="primary-button" disabled={isSubmitting}>
                {isSubmitting ? "Logging in…" : "Log in with email"}
              </button>

              <div className="login-links">
                <Link to="/forgot-password">Forgot Password?</Link>
              </div>
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
        </div>
      </div>
    </main>
  );
}
