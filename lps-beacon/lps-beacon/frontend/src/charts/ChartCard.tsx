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
  children: ReactNode;
}

export default function ChartCard({ title, subtitle, legend, wide, children }: Props) {
  return (
    <section className={wide ? "chart-card chart-card-wide" : "chart-card"}>
      <h3 className="chart-title">{title}</h3>
      {subtitle && <p className="chart-subtitle">{subtitle}</p>}
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
