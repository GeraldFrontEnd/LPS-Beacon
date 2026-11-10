// src/pages/ForgotPasswordPage.tsx
// "Forgot your password?", in two steps on one card, the same for Restricted and Finance/HR accounts (a reset does
// not change the user's Cognito group, so their role is the same the next time they sign in):
//   1. the user types their email; Cognito emails them a 6-digit code (the lps-beacon-reset-audit trigger logs it)
//   2. they type the code and choose a new password; then they go back to the sign-in page to sign in with it
// The page never says whether an email has an account: an unknown email gets the same "check your email" answer.

import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import {
  IS_MOCK,
  MOCK_RESET_CODE,
  confirmPasswordReset,
  passwordMeetsRules,
  requestPasswordReset,
} from "../auth/authService";
import AuthLayout from "../components/AuthLayout";
import PasswordField, { PasswordRules } from "../components/PasswordField";

type Step = "request" | "confirm";

export default function ForgotPasswordPage() {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [step, setStep] = useState<Step>("request");
  // The sign-in page passes on the email already typed there.
  const [email, setEmail] = useState(() => (location.state as { email?: string } | null)?.email ?? "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (isLoading) return null;
  if (user) return <Navigate to="/" replace />; // already signed in: nothing to reset here

  async function sendCode() {
    setError(null);
    setBusy(true);
    try {
      await requestPasswordReset(email);
      setStep("confirm");
      setCode("");
      setInfo(
        `If ${email.trim()} has an LPS-Beacon account, we've emailed it a 6-digit code. ` +
          "It can take a minute to arrive, so check your junk folder too. The code expires in 1 hour."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the code. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function handleRequest(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void sendCode();
  }

  async function handleConfirm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!passwordMeetsRules(password)) return setError("The new password doesn't meet the rules listed under it.");
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    try {
      await confirmPasswordReset(email, code, password);
      // Back to sign in, with the email filled in and a confirmation above the form.
      navigate("/login", {
        replace: true,
        state: { email: email.trim(), notice: "Your password has been changed. Sign in with your new password." },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset the password. Try again.");
      setBusy(false);
    }
  }

  return (
    <AuthLayout heading="Reset your password">
      {step === "request" ? (
        <>
          <p className="subtitle">Enter your LPS email and we'll send you a code to choose a new password.</p>
          <form onSubmit={handleRequest}>
            <label className="field">
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@lpstech.com"
                autoComplete="username"
                autoFocus
                required
              />
            </label>
            {error && (
              <p className="error-banner" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? "Sending code…" : "Send code"}
            </button>
          </form>
        </>
      ) : (
        <>
          {info && (
            <p className="success-banner" role="status">
              {info}
            </p>
          )}
          {IS_MOCK && <p className="demo-box">Practice mode: no email is sent. Use the code {MOCK_RESET_CODE}.</p>}
          <form onSubmit={handleConfirm}>
            {/* Hidden copy of the email, so the browser's password manager saves the new password for this account. */}
            <input type="email" value={email} autoComplete="username" readOnly hidden />
            <label className="field">
              Code from the email
              <input
                type="text"
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\s/g, ""))}
                placeholder="6-digit code"
                autoComplete="one-time-code"
                maxLength={6}
                autoFocus
                required
              />
            </label>
            <PasswordField
              id="reset-new-password"
              label="New password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              placeholder="Choose a new password"
              describedBy="reset-password-rules"
            />
            <PasswordField
              id="reset-confirm-password"
              label="Confirm new password"
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
              placeholder="Type it again"
            />
            <PasswordRules id="reset-password-rules" password={password} confirm={confirm} />
            {error && (
              <p className="error-banner" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? "Changing password…" : "Change password"}
            </button>
            <p className="login-alt-actions">
              <button type="button" className="link-button" onClick={() => void sendCode()} disabled={busy}>
                Send a new code
              </button>
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setStep("request");
                  setError(null);
                  setInfo(null);
                }}
                disabled={busy}
              >
                Use a different email
              </button>
            </p>
          </form>
        </>
      )}
      <p className="login-back">
        <Link to="/login" className="login-forgot">
          ← Back to sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
