// src/components/PasswordField.tsx
// Password boxes for the sign-in pages: a box with an eye button that shows or hides the text, and the checklist of
// the user pool's password rules shown under a new password.

import { useState } from "react";
import type { ReactNode } from "react";
import { PASSWORD_RULES } from "../auth/authService";

// Open eye: shown while the password is hidden, click to show it.
export function EyeIcon() {
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
export function EyeOffIcon() {
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

interface PasswordFieldProps {
  id: string;
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  placeholder?: string;
  describedBy?: string; // id of the rules checklist, so screen readers read it with the box
}

export default function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  placeholder,
  describedBy,
}: PasswordFieldProps) {
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {/* The eye button sits inside the box, on the right. */}
      <span className="password-wrap">
        <input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-describedby={describedBy}
          required
        />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "Hide password" : "Show password"}
          aria-pressed={show}
        >
          {show ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </span>
    </div>
  );
}

// The password rules, each ticked off as the new password meets it, plus "Passwords match".
export function PasswordRules({ id, password, confirm }: { id: string; password: string; confirm: string }) {
  const rules = [
    ...PASSWORD_RULES.map((r) => ({ label: r.label, ok: r.test(password) })),
    { label: "Both passwords match", ok: password !== "" && password === confirm },
  ];
  return (
    <ul id={id} className="password-rules" aria-label="Password rules">
      {rules.map((r) => (
        <li key={r.label} className={r.ok ? "is-met" : undefined}>
          <span aria-hidden="true">{r.ok ? "✓" : "•"}</span>
          {r.label}
          <span className="visually-hidden">{r.ok ? " (done)" : " (not yet)"}</span>
        </li>
      ))}
    </ul>
  );
}
