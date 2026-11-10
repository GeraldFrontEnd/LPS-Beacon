// src/components/AuthLayout.tsx
// The frame shared by the sign-in and "Forgot your password?" pages:
//   - left: the LPS-Beacon brand on the LPS purple (beacon logo, LPS logo, large product name, slogan)
//   - a white line down the middle
//   - right: a heading, the purple banner and the white card holding the page's form

import type { ReactNode } from "react";
import BeaconLogo from "./BeaconLogo";
import lpsLogo from "../../LPSLogo.avif";

interface AuthLayoutProps {
  heading: string; // the large greeting above the card, e.g. "Welcome back"
  children: ReactNode; // the card's contents
}

export default function AuthLayout({ heading, children }: AuthLayoutProps) {
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

      {/* RIGHT: the card. */}
      <section className="login-form-panel">
        <div className="login-stack">
          {/* The greeting, centred above the purple banner and card. */}
          <div className="login-welcome">
            <h1>{heading}</h1>
          </div>

          {/* Purple banner joined to the top of the card, with the slogan. */}
          <div className="login-logo">
            <span className="login-logo-slogan">Workforce Analytics Agent</span>
          </div>

          <div className="login-card">{children}</div>
        </div>
      </section>
    </main>
  );
}
