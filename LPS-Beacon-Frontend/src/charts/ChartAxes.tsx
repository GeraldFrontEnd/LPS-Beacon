// src/charts/ChartAxes.tsx
// The parts every line/bar chart shares: the "forecast" shading, horizontal grid lines, value labels and month labels.

import { CHART_H, MARGIN, formatChartValue, labelStep } from "./chartMath";
import type { ChartFormat } from "./chartMath";

interface Props {
  width: number;
  ticks: number[];
  y: (value: number) => number;
  categories: string[];
  format: ChartFormat;
  absoluteLabels?: boolean; // diverging charts label both sides of zero with positive numbers
  forecastFrom?: number; // index of the first forecast category
}

export default function ChartAxes({ width, ticks, y, categories, format, absoluteLabels, forecastFrom }: Props) {
  const n = categories.length;
  const innerW = width - MARGIN.l - MARGIN.r;
  const innerH = CHART_H - MARGIN.t - MARGIN.b;
  const slot = innerW / n;
  const step = labelStep(n, slot);
  const forecastX = forecastFrom !== undefined && forecastFrom < n ? MARGIN.l + forecastFrom * slot : null;

  return (
    <g>
      {forecastX !== null && (
        <>
          <rect x={forecastX} y={MARGIN.t} width={width - MARGIN.r - forecastX} height={innerH} className="chart-forecast" />
          <text x={forecastX + 6} y={MARGIN.t + 12} className="chart-forecast-label">
            Forecast
          </text>
        </>
      )}
      {ticks.map((t) => (
        <g key={t}>
          <line x1={MARGIN.l} x2={width - MARGIN.r} y1={y(t)} y2={y(t)} className="chart-gridline" />
          <text x={MARGIN.l - 8} y={y(t) + 4} textAnchor="end" className="chart-tick">
            {formatChartValue(absoluteLabels ? Math.abs(t) : t, format)}
          </text>
        </g>
      ))}
      {categories.map((c, i) =>
        i % step === 0 ? (
          <text key={c} x={MARGIN.l + (i + 0.5) * slot} y={CHART_H - 10} textAnchor="middle" className="chart-tick">
            {c}
          </text>
        ) : null
      )}
    </g>
  );
}
