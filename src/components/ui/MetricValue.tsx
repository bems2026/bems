type Size = 'sm' | 'md' | 'lg';

interface MetricValueProps {
  /** `null`/`undefined` renders an em dash — never a fabricated 0. */
  value: number | string | null | undefined;
  unit?: string;
  /** Decimal places. Ignored when `value` is already a string. */
  digits?: number;
  size?: Size;
  /** Renders muted — for values that are deliberately not applicable (e.g. an unmetered phase). */
  muted?: boolean;
}

const SIZE_CLASS: Record<Size, string> = {
  sm: ' metric-value--sm',
  md: '',
  lg: ' metric-value--lg',
};

/**
 * A single numeric readout.
 *
 * Two rules it exists to enforce everywhere at once:
 *   - a missing reading renders `—`, never `0` — "no data" and "zero watts" are different
 *     facts about a building, and conflating them is how a dead sensor reads as an idle one;
 *   - numerals are tabular (see `.metric-value`), so a value updating every 2s doesn't make
 *     the surrounding layout twitch.
 */
export function MetricValue({ value, unit, digits = 1, size = 'md', muted }: MetricValueProps) {
  const missing = value === null || value === undefined;
  const text = missing ? '—' : typeof value === 'number' ? value.toFixed(digits) : value;

  const classes = `metric-value${SIZE_CLASS[size]}${muted || missing ? ' metric-value--muted' : ''}`;

  return (
    <span className={classes}>
      {text}
      {unit && !missing && <span className="metric-unit">{unit}</span>}
    </span>
  );
}
