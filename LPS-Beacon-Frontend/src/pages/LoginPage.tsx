// src/pages/LoginPage.tsx
// The sign-in screen (the brand panel and card come from AuthLayout), with a loading bar under the Sign in button
// while the sign-in runs. Two other states share the card:
//   - after "Forgot your password?" (ForgotPasswordPage), a green note says the password was changed
//   - a first sign-in with an administrator's temporary password asks the user to choose their own password

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import {
  DEMO_ACCOUNTS,
  IS_MOCK,
  NewPasswordRequiredError,
  passwordMeetsRules,
  takeSignOutNotice,
} from "../auth/authService";
import { ROLE_LABELS } from "../auth/permissions";
import AuthLayout from "../components/AuthLayout";
import PasswordField, { EyeIcon, EyeOffIcon, PasswordRules } from "../components/PasswordField";

// The three states of the loading bar under the Sign in button:
//   idle    - nothing is happening; only the empty track shows
//   loading - the sign-in is running; a purple segment glides back and forth along the track and three small
//             bars bounce up and down beside "Signing you in…" (Cognito does not report real progress, so the
//             bar shows that work is happening rather than a percentage)
//   done    - the sign-in finished; the bar fills completely in green and we pause briefly before opening the app
type SignInPhase = "idle" | "loading" | "done";

const FINISH_PAUSE_MS = 600; // how long the full green bar stays on screen before the app opens

// What another page can pass when it sends the user here.
interface LoginState {
  from?: string; // RequireAuth: the page they tried to open
  email?: string; // ForgotPasswordPage: the account whose password was just changed
  notice?: string; // ForgotPasswordPage: "Your password has been changed…"
}

export default function LoginPage() {
  const { user, signIn, completeNewPassword, isLoading } = useAuth();
  const location = useLocation();
  const state = location.state as LoginState | null;

  // What the user has typed so far.
  const [email, setEmail] = useState(state?.email ?? "");
  const [password, setPassword] = useState("");
  // The error text to show, or null for none. Starts with the reason the user was signed out, if there is one.
  const [error, setError] = useState<string | null>(() => takeSignOutNotice());
  // A green confirmation (the password was just changed), cleared once they try to sign in.
  const [notice, setNotice] = useState<string | null>(state?.notice ?? null);
  // true while we wait for the login to finish (to disable the button).
  const [isSubmitting, setIsSubmitting] = useState(false);
  // true when the password is shown as plain text (the eye button).
  const [showPassword, setShowPassword] = useState(false);
  // The loading bar's state.
  const [phase, setPhase] = useState<SignInPhase>("idle");
  // First sign-in: Cognito wants a new password before it lets them in.
  const [needsNewPassword, setNeedsNewPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  // Remembers whether the page is still on screen, so we don't update state after it has gone.
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Where to go after login: the page they originally tried to open, or the chat.
  const from = state?.from ?? "/";

  // Still checking for an earlier login: show nothing yet, so the form doesn't flash.
  if (isLoading) return null;

  // Already logged in: leave this page. While the bar is running or finishing we wait, so the user sees it reach 100%.
  if (user && phase === "idle") return <Navigate to={from} replace />;

  // Runs a sign-in step with the loading bar: the password sign-in, or the new password on a first sign-in.
  async function run(step: () => Promise<void>) {
    setError(null);
    setNotice(null);
    setIsSubmitting(true);
    setPhase("loading"); // starts the moving bar
    try {
      await step(); // throws if the login is wrong
      if (!mounted.current) return;
      setPhase("done"); // the bar fills in green
      await new Promise((resolve) => window.setTimeout(resolve, FINISH_PAUSE_MS));
      if (mounted.current) setPhase("idle"); // back to idle: the redirect above now opens the app
    } catch (err) {
      if (!mounted.current) return;
      setPhase("idle"); // stop the bar and show the error instead
      if (err instanceof NewPasswordRequiredError) {
        setNeedsNewPassword(true); // not an error: switch the card to "Choose a new password"
        setPassword("");
      } else {
        setError(err instanceof Error ? err.message : "Could not sign in. Try again.");
      }
    } finally {
      if (mounted.current) setIsSubmitting(false);
    }
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); // stop the browser from reloading the page
    void run(() => signIn(email, password));
  }

  function handleNewPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!passwordMeetsRules(newPassword)) return setError("The new password doesn't meet the rules listed under it.");
    if (newPassword !== confirmPassword) return setError("The two passwords don't match.");
    void run(async () => {
      try {
        await completeNewPassword(newPassword);
      } catch (err) {
        // The temporary sign-in timed out: start again from the password form.
        if (err instanceof Error && /took too long/.test(err.message)) setNeedsNewPassword(false);
        throw err;
      }
    });
  }

  const progressText = phase === "done" ? "Signed in. Opening LPS-Beacon…" : "Signing you in…";

  // The loading bar. The empty track is always there; pressing the button starts it moving.
  const progress = (
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
  );

  const errorBanner = error && (
    <p className="error-banner" role="alert">
      {error}
    </p>
  );

  if (needsNewPassword) {
    return (
      <AuthLayout heading="Choose your password">
        <p className="subtitle">
          This is your first sign-in, so replace the temporary password from your invitation email with your own.
        </p>
        <form onSubmit={handleNewPassword}>
          <input type="email" value={email} autoComplete="username" readOnly hidden />
          <PasswordField
            id="first-new-password"
            label="New password"
            value={newPassword}
            onChange={setNewPassword}
            autoComplete="new-password"
            placeholder="Choose a new password"
            describedBy="first-password-rules"
          />
          <PasswordField
            id="first-confirm-password"
            label="Confirm new password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
            placeholder="Type it again"
          />
          <PasswordRules id="first-password-rules" password={newPassword} confirm={confirmPassword} />
          {errorBanner}
          <button type="submit" className="primary-button" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Save password and sign in"}
          </button>
          {progress}
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout heading="Welcome back">
      <p className="subtitle">Sign in with your LPS email.</p>

      {notice && (
        <p className="success-banner" role="status">
          {notice}
        </p>
      )}

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
            {/* Takes the email already typed along, so it doesn't have to be typed again. */}
            <Link to="/forgot-password" state={{ email }} className="login-forgot">
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
              autoFocus={!!state?.notice} // just reset: the email is filled in, so start on the password
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

        {errorBanner}

        <button type="submit" className="primary-button" disabled={isSubmitting}>
          {isSubmitting ? "Signing in…" : "Sign in with email"}
        </button>

        {progress}
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
    </AuthLayout>
  );
}
