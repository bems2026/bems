import { useId } from 'react';

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  strokeWidth?: number;
  /** Stretch to the parent's own box (100% x 100%) instead of a fixed pixel `height` —
   * for the 1:1 aspect-ratio per-device cards, where the box size comes from CSS
   * (`aspect-ratio`, tracking column width) rather than a prop. `width`/`height` still set
   * the internal viewBox's coordinate space either way; only the rendered size changes. */
  fill?: boolean;
}

/**
 * A plain SVG polyline — not a Recharts instance. Analytics mounts up to 11 of these
 * (4 branch cards + 7 outlet cards) at once; a hand-rolled polyline is real frame-cost
 * savings there for no loss of fidelity. The line itself carries the real signal and stays
 * `aria-hidden` — the accessible value is the numeric stat rendered next to it, same
 * division of labour `MetricValue` + a chart share everywhere else in this app. The
 * gradient area fill under the line is decoration on top of that, matching the two
 * Recharts `AreaChart`s elsewhere (`HistoryAreaChart`, `UntrackedLoadCard`) so every chart in
 * the app reads as one visual system rather than "the small ones are just lines."
 *
 * Restores v3's zero clamp (`Math.max(0, …)`) in the point mapper — v4 dropped it, so a
 * negative sample (never a real one here, but worth guarding structurally) would escape
 * the viewBox instead of flattening to the axis.
 */
export function Sparkline({ values, width = 120, height = 34, color = 'var(--accent)', strokeWidth = 1.4, fill = false }: SparklineProps) {
  const gradientId = `sparkline-gradient-${useId()}`;
  if (values.length === 0) return null;

  const max = Math.max(...values, 1);
  const coords = values.map((v, i) => ({
    x: (i / Math.max(values.length - 1, 1)) * width,
    y: height - (Math.max(0, v) / max) * height,
  }));
  const points = coords.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPoints = `0,${height} ${points} ${width},${height}`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height: fill ? '100%' : height, display: 'block' }} aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor={color} stopOpacity={0.35} />
          <stop offset="95%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill={`url(#${gradientId})`} stroke="none" />
      <polyline points={points} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
    </svg>
  );
}
