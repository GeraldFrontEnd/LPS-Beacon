// src/charts/ChartTooltip.tsx
// The small box that follows the pointer over a line or bar chart. It lives inside the SVG.

interface Props {
  x: number; // horizontal position of the hovered category
  plotRight: number;
  top: number;
  title: string;
  subtitle?: string;
  lines: { color: string; text: string }[];
}

export default function ChartTooltip({ x, plotRight, top, title, subtitle, lines }: Props) {
  const longest = Math.max(title.length, subtitle?.length ?? 0, ...lines.map((l) => l.text.length + 3));
  const w = Math.max(110, longest * 6.4 + 22);
  const headerH = 16 + (subtitle ? 14 : 0);
  const h = headerH + lines.length * 18 + 8;
  // Show the box to the right of the pointer, or to the left when it would run off the chart.
  const left = x + 14 + w > plotRight ? x - 14 - w : x + 14;
  const y = top + 6;

  return (
    <g className="chart-tooltip" pointerEvents="none">
      <rect x={left} y={y} width={w} height={h} rx={6} />
      <text x={left + 10} y={y + 16} className="chart-tip-title">
        {title}
      </text>
      {subtitle && (
        <text x={left + 10} y={y + 30} className="chart-tip-sub">
          {subtitle}
        </text>
      )}
      {lines.map((l, i) => {
        const ly = y + headerH + 18 * (i + 1) - 4;
        return (
          <g key={i}>
            <circle cx={left + 14} cy={ly - 4} r={4} style={{ fill: l.color }} />
            <text x={left + 24} y={ly} className="chart-tip-line">
              {l.text}
            </text>
          </g>
        );
      })}
    </g>
  );
}
