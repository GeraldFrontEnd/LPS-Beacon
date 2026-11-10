// src/pages/LoginPage.tsx
// The sign-in screen, split in two:
//   - left: the LPS-Beacon brand on the LPS purple (beacon logo, LPS logo, large product name, slogan)
//   - a white line down the middle
//   - right: a large sign-in card, with a loading bar under the Sign in button while the sign-in runs

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { DEMO_ACCOUNTS, IS_MOCK, takeSignOutNotice } from "../auth/authService";
import { ROLE_LABELS } from "../auth/permissions";
import BeaconLogo from "../components/BeaconLogo";
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

// The three states of the loading bar under the Sign in button:
//   idle    - nothing is happening; only the empty track shows
//   loading - the sign-in is running; a purple segment glides back and forth along the track and three small
//             bars bounce up and down beside "Signing you in…" (Cognito does not report real progress, so the
//             bar shows that work is happening rather than a percentage)
//   done    - the sign-in finished; the bar fills completely in green and we pause briefly before opening the app
type SignInPhase = "idle" | "loading" | "done";

const FINISH_PAUSE_MS = 600; // how long the full green bar stays on screen before the app opens

export default function LoginPage() {
  const { user, signIn, isLoading } = useAuth();
  const location = useLocation();

  // What the user has typed so far.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // The error text to show, or null for none. Starts with the reason the user was signed out, if there is one.
  const [error, setError] = useState<string | null>(() => takeSignOutNotice());
  // true while we wait for the login to finish (to disable the button).
  const [isSubmitting, setIsSubmitting] = useState(false);
  // true when the password is shown as plain text (the eye button).
  const [showPassword, setShowPassword] = useState(false);
  // The loading bar's state.
  const [phase, setPhase] = useState<SignInPhase>("idle");
  // Remembers whether the page is still on screen, so we don't update state after it has gone.
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Where to go after login: the page they originally tried to open, or the chat.
  // RequireAuth stored it in "location.state"; we tell TypeScript what shape it has.
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  // Still checking for an earlier login: show nothing yet, so the form doesn't flash.
  if (isLoading) return null;

  // Already logged in: leave this page. While the bar is running or finishing we wait, so the user sees it reach 100%.
  if (user && phase === "idle") return <Navigate to={from} replace />;

  // Runs when the form is submitted.
  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); // stop the browser from reloading the page
    setError(null);
    setIsSubmitting(true);
    setPhase("loading"); // starts the moving bar
    try {
      await signIn(email, password); // throws if the login is wrong
      if (!mounted.current) return;
      setPhase("done"); // the bar fills in green
      await new Promise((resolve) => window.setTimeout(resolve, FINISH_PAUSE_MS));
      if (mounted.current) setPhase("idle"); // back to idle: the redirect above now opens the app
    } catch (err) {
      if (!mounted.current) return;
      setPhase("idle"); // stop the bar and show the error instead
      setError(err instanceof Error ? err.message : "Could not sign in. Try again.");
    } finally {
      if (mounted.current) setIsSubmitting(false);
    }
  }

  const progressText = phase === "done" ? "Signed in. Opening LPS-Beacon…" : "Signing you in…";

  return (
    <main className="login-page">
      {/* LEFT: the brand panel on the LPS purple. */}
      <section className="login-brand-panel" aria-label="LPS-Beacon">
        <div className="login-hero">
          {/* The beacon mark, above the LPS logo. */}
          <BeaconLogo size={112} className="login-hero-mark" title="" />
          {/* The LPS logo is turned white in CSS so it shows on the purple. */}
          <img src={lpsLogo} alt="LPS, a Lenovo Company" className="login-hero-logo" />
          <h2 className="login-hero-name">LPS-Beacon</h2>
          <p className="login-hero-slogan">Workforce Analytics Agent</p>
        </div>
      </section>

      {/* The white line that splits the page in two. Purely visual, so screen readers skip it. */}
      <div className="login-divider" aria-hidden="true" />

      {/* RIGHT: the sign-in card. */}
      <section className="login-form-panel">
        <div className="login-stack">
          {/* The greeting, centred above the purple banner and card. */}
          <div className="login-welcome">
            <h1>Welcome back</h1>
          </div>

          {/* Purple banner joined to the top of the card, with the slogan. */}
          <div className="login-logo">
            <span className="login-logo-slogan">Workforce Analytics Agent</span>
          </div>

          <div className="login-card">
            <p className="subtitle">Sign in with your LPS email.</p>

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

              {/* Password: the label and the "Forgot your password?" link share one row.
                  The link is outside the <label>, so htmlFor/id link the label to the box instead. */}
              <div className="field">
                <div className="field-label-row">
                  <label htmlFor="login-password">Password</label>
                  <Link to="/forgot-password" className="login-forgot">
                    Forgot your password?
                  </Link>
                </div>
                {/* The eye button sits inside the box, on the right. */}
                <span className="password-wrap">
                  <input
                    id="login-password"
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
              </div>

              {error && (
                <p className="error-banner" role="alert">
                  {error}
                </p>
              )}

              <button type="submit" className="primary-button" disabled={isSubmitting}>
                {isSubmitting ? "Signing in…" : "Sign in with email"}
              </button>

              {/* The loading bar. The empty track is always there; pressing Sign in starts it moving. */}
              <div className="login-progress-block">
                <div
                  className={`login-progress is-${phase}`}
                  role="progressbar"
                  aria-label="Sign-in progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={phase === "done" ? 100 : phase === "idle" ? 0 : undefined} // no number while loading: we can't measure it
                  aria-busy={phase === "loading"}
                >
                  <div className="login-progress-fill" />
                </div>
                <div className="login-progress-status" aria-live="polite">
                  {/* Three small bars that bounce up and down while the sign-in runs, echoing the beacon logo. */}
                  {phase === "loading" && (
                    <span className="login-bounce" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </span>
                  )}
                  {phase !== "idle" && <span>{progressText}</span>}
                </div>
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
      </section>
    </main>
  );
}
