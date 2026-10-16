// src/charts/BarChart.tsx
// Stacked bars over time. A series marked "down" is drawn below the zero line (used for leavers).
// Values are always given as positive numbers; "down" only decides which side of zero they are drawn on.

import { useState } from "react";
import type { PointerEvent } from "react";
import ChartAxes from "./ChartAxes";
import ChartTooltip from "./ChartTooltip";
import { CHART_H, MARGIN, extent, formatChartValue, niceScale } from "./chartMath";
import type { ChartFormat } from "./chartMath";

export interface BarSeries {
  name: string;
  values: (number | null)[];
  color: string;
  down?: boolean;
}

interface Props {
  categories: string[];
  notes?: string[];
  series: BarSeries[];
  format: ChartFormat;
  axisFormat?: ChartFormat;
  forecastFrom?: number;
  ariaLabel: string;
  width?: number;
}

export default function BarChart({ categories, notes, series, format, axisFormat, forecastFrom, ariaLabel, width = 640 }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const n = categories.length;
  if (!extent(series.map((s) => s.values)) || n === 0) return <p className="note chart-empty">No data yet.</p>;

  // The tallest stack above zero and the tallest below it decide the value axis.
  let maxUp = 0;
  let maxDown = 0;
  for (let i = 0; i < n; i++) {
    let up = 0;
    let down = 0;
    for (const s of series) {
      const v = s.values[i];
      if (v === null || v === undefined) continue;
      if (s.down) down += v;
      else up += v;
    }
    maxUp = Math.max(maxUp, up);
    maxDown = Math.max(maxDown, down);
  }
  const hasDown = series.some((s) => s.down);
  const scale = niceScale(-maxDown, maxUp);
  const innerW = width - MARGIN.l - MARGIN.r;
  const innerH = CHART_H - MARGIN.t - MARGIN.b;
  const slot = innerW / n;
  const barW = slot * 0.68;
  const y = (v: number) => MARGIN.t + innerH * (1 - (v - scale.min) / (scale.max - scale.min));

  function onMove(e: PointerEvent<SVGRectElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - box.left) / box.width;
    setHover(Math.min(n - 1, Math.max(0, Math.floor(rel * n))));
  }

  const bars = [];
  for (let i = 0; i < n; i++) {
    let up = 0;
    let down = 0;
    for (const s of series) {
      const v = s.values[i];
      if (v === null || v === undefined || v === 0) continue;
      const from = s.down ? -down : up;
      const to = s.down ? -(down + v) : up + v;
      if (s.down) down += v;
      else up += v;
      const top = y(Math.max(from, to));
      bars.push(
        <rect
          key={`${s.name}-${i}`}
          x={MARGIN.l + i * slot + (slot - barW) / 2}
          y={top}
          width={barW}
          height={Math.max(0, Math.abs(y(from) - y(to)))}
          className="chart-bar"
          style={{ fill: s.color }}
        />
      );
    }
  }

  return (
    <svg viewBox={`0 0 ${width} ${CHART_H}`} className="chart-svg" role="img" aria-label={ariaLabel}>
      <ChartAxes
        width={width}
        ticks={scale.ticks}
        y={y}
        categories={categories}
        format={axisFormat ?? format}
        absoluteLabels={hasDown}
        forecastFrom={forecastFrom}
      />
      {hover !== null && (
        <rect x={MARGIN.l + hover * slot} y={MARGIN.t} width={slot} height={innerH} className="chart-hover-band" />
      )}
      {bars}
      <line x1={MARGIN.l} x2={width - MARGIN.r} y1={y(0)} y2={y(0)} className="chart-zero" />
      {hover !== null && (
        <ChartTooltip
          x={MARGIN.l + (hover + 0.5) * slot}
          plotRight={width - MARGIN.r}
          top={MARGIN.t}
          title={categories[hover]}
          subtitle={notes?.[hover]}
          lines={series.map((s) => {
            const v = s.values[hover];
            return { color: s.color, text: `${s.name}: ${v === null || v === undefined ? "–" : formatChartValue(v, format)}` };
          })}
        />
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
