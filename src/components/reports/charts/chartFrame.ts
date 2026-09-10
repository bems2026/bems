/**
 * Scales, ticks and the plot rectangle — the arithmetic every chart generator sits on.
 *
 * Pure, and deliberately small. Two of the decisions here are dataviz correctness rather than
 * geometry, and both are enforced by `chartFrame.test.ts` rather than left to whoever writes
 * the next generator:
 *
 *   - **A bar axis is anchored at zero.** A bar's length IS its value, so an axis starting at
 *     1.2 makes a 1.26 kWh day look like nothing beside a 1.38 kWh day. `zeroBased` is a
 *     required option, not a default, so each generator has to say which kind of chart it is.
 *   - **No data yields no axis.** `niceScale` returns `null` rather than a plausible 0–1 grid,
 *     which forces the caller to draw the "nobody was watching" state instead of a confident
 *     empty chart. It is the same rule as `coverageOf` returning `null` instead of zero.
 */

export interface Scale {
  min: number;
  max: number;
  ticks: number[];
}

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Left is widest because the y-axis labels live there; bottom carries the category labels. */
export const DEFAULT_MARGINS: Margins = { top: 20, right: 10, bottom: 28, left: 44 };

/** The 1-2-5 ladder: the steps people can actually read off an axis without arithmetic. */
function niceStep(rough: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalised = rough / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

export function niceScale(
  values: readonly (number | null | undefined)[],
  { zeroBased, targetTicks = 5 }: { zeroBased: boolean; targetTicks?: number }
): Scale | null {
  const finite = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (finite.length === 0) return null;

  let lo = zeroBased ? Math.min(0, ...finite) : Math.min(...finite);
  let hi = Math.max(...finite);
  if (zeroBased) lo = Math.min(lo, 0);

  if (hi === lo) {
    // A genuinely flat series — a meter reporting the same figure all month is a fact, not a
    // fault. Give it a range rather than dividing by zero two functions later.
    if (zeroBased) hi = hi === 0 ? 1 : hi * 1.25;
    else {
      const pad = Math.abs(hi) > 0 ? Math.abs(hi) * 0.05 : 0.5;
      lo -= pad;
      hi += pad;
    }
  }

  const step = niceStep((hi - lo) / Math.max(targetTicks, 1));
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;

  const ticks: number[] = [];
  // Counted rather than accumulated: repeated += of a fractional step drifts, and the drift
  // shows up as an axis labelled 0.30000000000000004.
  const count = Math.round((max - min) / step);
  for (let i = 0; i <= count; i++) ticks.push(Math.round((min + i * step) * 1e6) / 1e6);

  return { min, max, ticks };
}

/** Domain to range. Pass an inverted range for y, so a bigger number sits higher up the page. */
export function linearScale(domain: readonly [number, number], range: readonly [number, number]) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  return (value: number): number => (span === 0 ? r0 : r0 + ((value - d0) / span) * (r1 - r0));
}

export interface Band {
  x: number;
  w: number;
  /** Centre, for the label that goes under the bar. */
  cx: number;
}

/**
 * `count` evenly spaced bands across `range`, each inset by `padding` (0–1) of its slot.
 * A count of zero returns finite geometry rather than NaN: a NaN width renders as an empty
 * chart rather than an error, which is the quietest possible way to lose a month.
 */
export function bandScale(count: number, range: readonly [number, number], padding = 0.3) {
  const [r0, r1] = range;
  const slot = count > 0 ? (r1 - r0) / count : r1 - r0;
  const w = Math.max(slot * (1 - padding), 0);
  return (index: number): Band => {
    const x = r0 + index * slot + (slot - w) / 2;
    return { x, w, cx: x + w / 2 };
  };
}

export interface PlotBox {
  x: number;
  y: number;
  w: number;
  h: number;
  right: number;
  bottom: number;
}

export function plotBox(width: number, height: number, m: Margins = DEFAULT_MARGINS): PlotBox {
  return {
    x: m.left,
    y: m.top,
    w: width - m.left - m.right,
    h: height - m.top - m.bottom,
    right: width - m.right,
    bottom: height - m.bottom,
  };
}
