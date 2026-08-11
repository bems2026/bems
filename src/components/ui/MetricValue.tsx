import { useEffect, useRef, useState } from 'react';

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
 * Three rules it exists to enforce everywhere at once:
 *   - a missing reading renders `—`, never `0` — "no data" and "zero watts" are different
 *     facts about a building, and conflating them is how a dead sensor reads as an idle one;
 *   - numerals are tabular (see `.metric-value`), so a value updating every 2s doesn't make
 *     the surrounding layout twitch;
 *   - a value that actually changes gets a brief pulse (Stage L4) — a live dashboard
 *     re-rendering the same number every 2s with no visual acknowledgment reads as inert;
 *     one that visibly updates reads as live.
 */
export function MetricValue({ value, unit, digits = 1, size = 'md', muted }: MetricValueProps) {
  const missing = value === null || value === undefined;
  const text = missing ? '—' : typeof value === 'number' ? value.toFixed(digits) : value;

  const [pulse, setPulse] = useState(false);
  const prevText = useRef(text);
  const mounted = useRef(false);

  useEffect(() => {
    // Skip the pulse on mount — there's no prior value to have "changed" from, and the
    // card's own entrance animation already marks this as new.
    if (!mounted.current) {
      mounted.current = true;
      prevText.current = text;
      return;
    }
    if (prevText.current === text) return;
    prevText.current = text;
    setPulse(true);
    const id = setTimeout(() => setPulse(false), 350);
    return () => clearTimeout(id);
  }, [text]);

  const classes = `metric-value${SIZE_CLASS[size]}${muted || missing ? ' metric-value--muted' : ''}${pulse ? ' metric-value--pulse' : ''}`;

  return (
    <span className={classes}>
      {text}
      {unit && !missing && <span className="metric-unit">{unit}</span>}
    </span>
  );
}
