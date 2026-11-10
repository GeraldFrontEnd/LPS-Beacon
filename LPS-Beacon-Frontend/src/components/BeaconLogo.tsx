// src/components/BeaconLogo.tsx
// The LPS-Beacon mark: a beacon whose tower is three rising analytics bars, with a light at the top sending out
// signal arcs. It draws in "currentColor", so the parent's text colour decides its colour (white on the purple).
// The signal arcs use --beacon-ray if it is set, so they can be a softer shade than the tower.

interface BeaconLogoProps {
  size?: number; // width and height in pixels
  className?: string;
  title?: string; // read out by screen readers; pass "" to hide the logo from them (purely decorative)
}

export default function BeaconLogo({ size = 96, className, title = "LPS-Beacon logo" }: BeaconLogoProps) {
  const decorative = title === "";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : title}
    >
      {/* Signal arcs either side of the light. */}
      <g fill="none" stroke="var(--beacon-ray, currentColor)" strokeWidth="2.6" strokeLinecap="round">
        <path d="M23 9 Q17.5 16 23 23" />
        <path d="M16.5 4.5 Q8 16 16.5 27.5" />
        <path d="M41 9 Q46.5 16 41 23" />
        <path d="M47.5 4.5 Q56 16 47.5 27.5" />
      </g>
      {/* The light. */}
      <circle cx="32" cy="16" r="5.5" fill="currentColor" />
      {/* The tower: three rising bars, the tallest in the middle under the light. */}
      <rect x="20" y="40" width="7" height="17" rx="1.5" fill="currentColor" />
      <rect x="28.5" y="26" width="7" height="31" rx="1.5" fill="currentColor" />
      <rect x="37" y="33" width="7" height="24" rx="1.5" fill="currentColor" />
      {/* The ground line. */}
      <rect x="15" y="58.5" width="34" height="3" rx="1.5" fill="currentColor" />
    </svg>
  );
}
