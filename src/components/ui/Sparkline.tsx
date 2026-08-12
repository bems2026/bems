interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  strokeWidth?: number;
}

/**
 * A plain SVG polyline — not a Recharts instance. Analytics mounts up to 11 of these
 * (4 branch cards + 7 outlet cards) at once; a hand-rolled polyline is real frame-cost
 * savings there for no loss of fidelity, since the design itself is a plain line with no
 * axes or tooltip. Decorative only (`aria-hidden`) — the real accessible value is the
 * numeric stat rendered next to it, same division of labour `MetricValue` + a chart share
 * everywhere else in this app.
 *
 * Restores v3's zero clamp (`Math.max(0, …)`) in the point mapper — v4 dropped it, so a
 * negative sample (never a real one here, but worth guarding structurally) would escape
 * the viewBox instead of flattening to the axis.
 */
export function Sparkline({ values, width = 120, height = 34, color = 'var(--accent)', strokeWidth = 1.8 }: SparklineProps) {
  if (values.length === 0) return null;

  const max = Math.max(...values, 1);
  const points = values
    .map((v, i) => {
      const x = (i / Math.max(values.length - 1, 1)) * width;
      const y = height - (Math.max(0, v) / max) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block' }} aria-hidden="true">
      <polyline points={points} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
    </svg>
  );
}
