// src/charts/LineChart.tsx
// One or more lines over time. Gaps in the data (null) break the line instead of being drawn as zero.

import { useState } from "react";
import type { PointerEvent } from "react";
import ChartAxes from "./ChartAxes";
import ChartTooltip from "./ChartTooltip";
import { CHART_H, MARGIN, extent, formatChartValue, niceScale } from "./chartMath";
import type { ChartFormat } from "./chartMath";

export interface LineSeries {
  name: string;
  values: (number | null)[];
  color: string;
  dashed?: boolean;
}

interface Props {
  categories: string[];
  notes?: string[]; // a short note per category, shown in the tooltip (for example "Actual" or "Forecast")
  series: LineSeries[];
  format: ChartFormat; // used in the tooltip
  axisFormat?: ChartFormat; // used on the value axis; defaults to format
  forecastFrom?: number;
  zeroBaseline?: boolean; // start the value axis at zero
  flags?: boolean[]; // one per category; true draws a warning sign above that month
  flagText?: string; // what the warning means, shown in the tooltip
  ariaLabel: string;
  width?: number;
}

// Turns a row of values into SVG path text, starting a new segment after every gap.
function pathFor(values: (number | null)[], x: (i: number) => number, y: (v: number) => number): string {
  let d = "";
  let penDown = false;
  values.forEach((v, i) => {
    if (v === null) {
      penDown = false;
      return;
    }
    d += `${penDown ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
    penDown = true;
  });
  return d.trim();
}

export default function LineChart({
  categories,
  notes,
  series,
  format,
  axisFormat,
  forecastFrom,
  zeroBaseline = false,
  flags,
  flagText = "Flagged",
  ariaLabel,
  width = 640,
}: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const n = categories.length;
  const ext = extent(series.map((s) => s.values));
  if (!ext || n === 0) return <p className="note chart-empty">No data yet.</p>;

  let [lo, hi] = ext;
  if (zeroBaseline) {
    lo = Math.min(0, lo);
  } else {
    const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.05 || 1;
    lo = lo >= 0 ? Math.max(0, lo - pad) : lo - pad; // do not invent a negative axis for data that is never negative
    hi += pad;
  }
  const scale = niceScale(lo, hi);
  const innerW = width - MARGIN.l - MARGIN.r;
  const innerH = CHART_H - MARGIN.t - MARGIN.b;
  const x = (i: number) => MARGIN.l + ((i + 0.5) * innerW) / n;
  const y = (v: number) => MARGIN.t + innerH * (1 - (v - scale.min) / (scale.max - scale.min));

  function onMove(e: PointerEvent<SVGRectElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - box.left) / box.width;
    setHover(Math.min(n - 1, Math.max(0, Math.floor(rel * n))));
  }

  // A warning triangle just above the highest point of each flagged month.
  const warnings = (flags ?? []).map((flagged, i) => {
    if (!flagged) return null;
    const top = Math.max(...series.map((s) => s.values[i] ?? -Infinity));
    const cy = Math.max(MARGIN.t + 8, (Number.isFinite(top) ? y(top) : MARGIN.t) - 14);
    const cx = x(i);
    return (
      <g key={i} className="chart-warning" pointerEvents="none">
        <path d={`M${cx} ${cy - 8} L${cx + 8} ${cy + 6} L${cx - 8} ${cy + 6} Z`} />
        <text x={cx} y={cy + 4.5} textAnchor="middle">
          !
        </text>
      </g>
    );
  });

  const tipLines = (i: number) => {
    const lines = series.map((s) => {
      const v = s.values[i];
      return { color: s.color, text: `${s.name}: ${v === null || v === undefined ? "–" : formatChartValue(v, format)}` };
    });
    if (flags?.[i]) lines.push({ color: "var(--flag)", text: `⚠ ${flagText}` });
    return lines;
  };

  return (
    <svg viewBox={`0 0 ${width} ${CHART_H}`} className="chart-svg" role="img" aria-label={ariaLabel}>
      <ChartAxes
        width={width}
        ticks={scale.ticks}
        y={y}
        categories={categories}
        format={axisFormat ?? format}
        forecastFrom={forecastFrom}
      />
      {series.map((s) => (
        <g key={s.name}>
          <path
            d={pathFor(s.values, x, y)}
            fill="none"
            strokeWidth={2}
            strokeDasharray={s.dashed ? "6 4" : undefined}
            style={{ stroke: s.color }}
          />
          {s.values.map((v, i) =>
            v === null ? null : <circle key={i} cx={x(i)} cy={y(v)} r={hover === i ? 4 : 2.5} style={{ fill: s.color }} />
          )}
        </g>
      ))}
      {warnings}
      {hover !== null && (
        <>
          <line x1={x(hover)} x2={x(hover)} y1={MARGIN.t} y2={MARGIN.t + innerH} className="chart-guide" />
          <ChartTooltip
            x={x(hover)}
            plotRight={width - MARGIN.r}
            top={MARGIN.t}
            title={categories[hover]}
            subtitle={notes?.[hover]}
            lines={tipLines(hover)}
          />
        </>
      )}
      <rect
        x={MARGIN.l}
        y={MARGIN.t}
        width={innerW}
        height={innerH}
        fill="transparent"
        style={{ touchAction: "pan-y" }}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      />
    </svg>
  );
}
