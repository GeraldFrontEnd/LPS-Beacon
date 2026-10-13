// src/pages/PnlPage.tsx
// Monthly profit and loss per project. Finance only (the route in App.tsx enforces that).
// It reuses the dashboard's page and table styles.

import { useEffect, useState } from "react";
import { getPnl } from "../api/client";
import type { PnlRow } from "../api/types";
import { useAuth } from "../auth/useAuth";

// Shows a number with thousands separators, e.g. 96000 -> "96,000".
function fmt(n: number): string {
  return n.toLocaleString();
}

// Profit = money in minus all costs. A negative result is a loss.
function profitOf(r: PnlRow): number {
  return r.revenue - r.manpowerCost - r.otherCosts;
}

// Margin = profit as a percentage of revenue. "n/a" avoids dividing by zero.
function marginOf(r: PnlRow): string {
  return r.revenue === 0 ? "n/a" : `${((profitOf(r) / r.revenue) * 100).toFixed(1)}%`;
}

export default function PnlPage() {
  const { token } = useAuth();
  const [rows, setRows] = useState<PnlRow[] | null>(null); // null = still loading
  const [error, setError] = useState<string | null>(null);

  // Load the figures once when the page opens.
  useEffect(() => {
    let cancelled = false; // ignore the result if the user already left the page
    getPnl(token ?? undefined)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the P&L.");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Totals across all projects for the summary boxes.
  const revenue = rows?.reduce((sum, r) => sum + r.revenue, 0) ?? 0;
  const costs = rows?.reduce((sum, r) => sum + r.manpowerCost + r.otherCosts, 0) ?? 0;
  const profit = revenue - costs;

  return (
    <main className="dashboard-page">
      <header className="page-header">
        <h1>Profit and loss</h1>
        <p>Monthly figures per project.</p>
      </header>

      <div className="dashboard-body">
        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
        {!rows && !error && <p className="note">Loading…</p>}

        {rows && (
          <>
            <div className="stats">
              <div className="stat">
                <div className="stat-value">{fmt(revenue)}</div>
                <div className="stat-label">Revenue</div>
              </div>
              <div className="stat">
                <div className="stat-value">{fmt(costs)}</div>
                <div className="stat-label">Total costs</div>
              </div>
              <div className="stat">
                <div className={profit < 0 ? "stat-value loss" : "stat-value profit"}>{fmt(profit)}</div>
                <div className="stat-label">{profit < 0 ? "Loss" : "Profit"}</div>
              </div>
            </div>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th className="num">Revenue</th>
                    <th className="num">Manpower cost</th>
                    <th className="num">Other costs</th>
                    <th className="num">Profit</th>
                    <th className="num">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const p = profitOf(r);
                    return (
                      <tr key={r.id}>
                        <td>{r.name}</td>
                        <td className="num">{fmt(r.revenue)}</td>
                        <td className="num">{fmt(r.manpowerCost)}</td>
                        <td className="num">{fmt(r.otherCosts)}</td>
                        <td className={p < 0 ? "num loss" : "num profit"}>{fmt(p)}</td>
                        <td className="num">{marginOf(r)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
