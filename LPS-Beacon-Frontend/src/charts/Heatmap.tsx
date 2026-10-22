// src/charts/Heatmap.tsx
// A grid of coloured cells: one row per band, one column per month. Darker means a higher value.

import { formatChartValue, labelStep } from "./chartMath";
import type { ChartFormat } from "./chartMath";

interface Props {
  rowLabels: string[];
  columns: string[];
  values: (number | null)[][]; // values[row][column]
  format: ChartFormat;
  domain: [number, number]; // the values that get the lightest and the darkest colour
  forecastFrom?: number;
  isFlagged?: (row: number, value: number, column: number) => boolean; // true turns the cell red
  flagText?: string; // what a red cell means, shown in the scale below the grid
  ariaLabel: string;
  width?: number;
}

const LIGHT = [236, 242, 248];
const DARK = [31, 78, 121];

function shade(t: number): string {
  const c = LIGHT.map((l, i) => Math.round(l + (DARK[i] - l) * t));
  return `rgb(${c.join(",")})`;
}

export default function Heatmap({
  rowLabels,
  columns,
  values,
  format,
  domain,
  forecastFrom,
  isFlagged,
  flagText = "Flagged",
  ariaLabel,
  width = 1100,
}: Props) {
  const hasData = values.some((row) => row.some((v) => v !== null));
  if (!hasData) return <p className="note chart-empty">No data yet.</p>;

  const left = 84;
  const right = 12;
  const top = 22;
  const cellH = 26;
  const cellW = (width - left - right) / columns.length;
  const height = top + rowLabels.length * cellH + 18; // extra room below the grid for the "Forecast" label
  const step = labelStep(columns.length, cellW);
  const [lo, hi] = domain;
  const showText = cellW >= 30;
  const forecastX = forecastFrom !== undefined && forecastFrom < columns.length ? left + forecastFrom * cellW : null;

  return (
    <>
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" role="img" aria-label={ariaLabel}>
        {columns.map((c, i) =>
          i % step === 0 ? (
            <text key={c} x={left + (i + 0.5) * cellW} y={14} textAnchor="middle" className="chart-tick">
              {c}
            </text>
          ) : null
        )}
        {rowLabels.map((label, r) => (
          <g key={label}>
            <text x={left - 8} y={top + r * cellH + cellH / 2 + 4} textAnchor="end" className="chart-tick">
              {label}
            </text>
            {columns.map((c, i) => {
              const v = values[r][i];
              const t = v === null ? 0 : Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
              const flagged = v !== null && !!isFlagged?.(r, v, i);
              return (
                <g key={c}>
                  <rect
                    x={left + i * cellW + 0.5}
                    y={top + r * cellH + 0.5}
                    width={cellW - 1}
                    height={cellH - 1}
                    rx={2}
                    className={v === null ? "heat-cell heat-empty" : flagged ? "heat-cell heat-flag" : "heat-cell"}
                    style={v === null || flagged ? undefined : { fill: shade(t) }}
                  >
                    <title>
                      {`${label}, ${c}: ${v === null ? "no data" : formatChartValue(v, format)}${flagged ? ` (${flagText})` : ""}`}
                    </title>
                  </rect>
                  {showText && v !== null && (
                    <text
                      x={left + (i + 0.5) * cellW}
                      y={top + r * cellH + cellH / 2 + 4}
                      textAnchor="middle"
                      className="heat-text"
                      style={{ fill: flagged || t > 0.55 ? "#ffffff" : "var(--ink)" }}
                      pointerEvents="none"
                    >
                      {formatChartValue(v, format)}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        ))}
        {forecastX !== null && (
          <g pointerEvents="none">
            <line x1={forecastX} x2={forecastX} y1={top - 4} y2={height - 12} className="heat-forecast-line" />
            <text x={forecastX + 4} y={height - 2} className="chart-forecast-label">
              Forecast
            </text>
          </g>
        )}
      </svg>
      <div className="heatmap-scale">
        <span>{formatChartValue(lo, format)}</span>
        <div className="heatmap-ramp" style={{ background: `linear-gradient(to right, ${shade(0)}, ${shade(1)})` }} />
        <span>{formatChartValue(hi, format)}</span>
        {isFlagged && (
          <span className="heatmap-flag-key">
            <span className="chart-swatch" style={{ background: "var(--flag)" }} />
            {flagText}
          </span>
        )}
      </div>
    </>
  );
}
