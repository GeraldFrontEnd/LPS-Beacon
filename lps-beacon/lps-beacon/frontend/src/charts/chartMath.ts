// src/charts/chartMath.ts
// Number formatting, axis scales and layout constants shared by the chart components.

export type ChartFormat = "int" | "dec1" | "usd" | "usdCompact" | "pct0" | "pct1";

const intFmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const dec1Fmt = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const compactFmt = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

export function formatChartValue(value: number, format: ChartFormat): string {
  switch (format) {
    case "int":
      return intFmt.format(value);
    case "dec1":
      return dec1Fmt.format(value);
    case "usd":
      return `$${intFmt.format(value)}`;
    case "usdCompact":
      return `$${compactFmt.format(value)}`;
    case "pct0":
      return `${intFmt.format(value * 100)}%`;
    case "pct1":
      return `${dec1Fmt.format(value * 100)}%`;
  }
}

// Every chart is drawn in a fixed coordinate system (a viewBox) and scaled to the card's width by CSS.
export const CHART_H = 280;
export const MARGIN = { l: 58, r: 14, t: 16, b: 32 };

// Smallest and largest value across several rows of data. Gaps (null) are ignored. Null when there is no data at all.
export function extent(rows: (number | null)[][]): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const row of rows) {
    for (const v of row) {
      if (v !== null && Number.isFinite(v)) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
  }
  return lo === Infinity ? null : [lo, hi];
}

// Rounds a value range outwards to "nice" axis ends (1, 2, 5 times a power of ten) and lists the tick values.
export function niceScale(min: number, max: number, target = 5): { min: number; max: number; ticks: number[] } {
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / target;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / magnitude;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * magnitude;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toPrecision(12)));
  return { min: lo, max: hi, ticks };
}

// Show only every k-th label on the horizontal axis so they do not overlap.
export function labelStep(count: number, slotWidth: number, minLabelWidth = 46): number {
  void count;
  return Math.max(1, Math.ceil(minLabelWidth / slotWidth));
}
