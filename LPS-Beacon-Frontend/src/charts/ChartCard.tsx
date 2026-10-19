// src/charts/ChartCard.tsx
// The framed box around one chart: title, short explanation, the chart itself and a colour legend.

import type { ReactNode } from "react";

interface LegendItem {
  name: string;
  color: string;
}

interface Props {
  title: string;
  subtitle?: string;
  legend?: LegendItem[];
  wide?: boolean; // spans the full width of the grid
  actions?: ReactNode; // controls shown at the top right, for example a filter
  children: ReactNode;
}

export default function ChartCard({ title, subtitle, legend, wide, actions, children }: Props) {
  return (
    <section className={wide ? "chart-card chart-card-wide" : "chart-card"}>
      <div className="chart-card-head">
        <div>
          <h3 className="chart-title">{title}</h3>
          {subtitle && <p className="chart-subtitle">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
      {legend && (
        <ul className="chart-legend">
          {legend.map((l) => (
            <li key={l.name}>
              <span className="chart-swatch" style={{ background: l.color }} />
              {l.name}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
