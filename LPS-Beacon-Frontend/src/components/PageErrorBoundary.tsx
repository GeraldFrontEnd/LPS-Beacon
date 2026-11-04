// src/components/PageErrorBoundary.tsx
// Catches an error thrown while a page is drawn, so one broken page shows a message instead of a blank screen (the
// whole app would otherwise unmount). Most likely cause: the backend's data is older or newer than this web app
// (for example a pipeline that has not been redeployed). The boundary resets when the address changes.

import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { useLocation } from "react-router-dom";

interface State {
  error: Error | null;
}

class Boundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Page failed to draw:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="page-error" role="alert">
        <h1>This page could not be shown</h1>
        <p>
          The data from the server did not match what the page expected. This usually means the backend and the web app
          were deployed at different versions; redeploying both (and rebuilding the capacity inputs) fixes it.
        </p>
        <p className="page-error-detail">{this.state.error.message}</p>
        <button type="button" className="secondary-button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </main>
    );
  }
}

export default function PageErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <Boundary key={pathname}>{children}</Boundary>;
}
