import { DEFAULT_MARGINS, linearScale, niceScale, pathFromRuns, plotBox, runsOf } from './chartFrame';
import type { ChartSpec, Def, Mark, Scene } from './types';

/**
 * The load duration curve: demand sorted high to low across the period.
 *
 * It answers the question a single peak figure cannot — how LONG the building sits near its
 * maximum. A peak touched for twenty minutes a month and one held every afternoon are the same
 * number and completely different problems, and a load-shedding tier is an answer to the second.
 * Drawing the DSM threshold across it, with the share of the period spent above it, is what
 * turns the picture into that argument.
 *
 * A THRESHOLD THAT IS NEVER REACHED IS STILL DRAWN, above the curve, because "the building never
 * came near it" is the finding rather than the absence of one — and a threshold set far above
 * anything the building does is the commonest way for auto-shedding to be armed and inert. The
 * axis stretches to include it for the same reason: a rule clipped off the top of the plot is a
 * rule nobody can see is wrong.
 */

export interface DurationPoint {
  /** Share of the period, 0–100, at or above this demand. */
  pct: number;
  w: number | null;
}

export interface DurationOptions {
  /** The DSM ceiling in force, if one is set. Absent means unset — never draw a zero rule. */
  thresholdW?: number | null;
}

export function durationCurveChart(
  points: readonly DurationPoint[],
  spec: ChartSpec,
  options: DurationOptions = {}
): Scene {
  const { width, height, palette, idPrefix, title } = spec;
  const box = plotBox(width, height, DEFAULT_MARGINS);
  const marks: Mark[] = [];
  const defs: Def[] = [];
  const threshold = typeof options.thresholdW === 'number' && Number.isFinite(options.thresholdW)
    ? options.thresholdW
    : null;

  const observed = points.filter((p) => typeof p.w === 'number' && Number.isFinite(p.w));
  // The threshold joins the domain so an unreached one still lands inside the plot.
  const scale = niceScale([...observed.map((p) => p.w), threshold], { zeroBased: true });

  let desc: string;
  if (scale === null) {
    desc = 'No sample in this period, so there is no curve to draw.';
    marks.push({
      kind: 'text',
      x: width / 2,
      y: box.y + box.h / 2,
      text: 'Nothing was observed in this period',
      fill: palette.textMuted,
      size: 12,
      anchor: 'middle',
    });
    return { width, height, idPrefix, title, desc, defs, marks };
  }

  const x = linearScale([0, 100], [box.x, box.right]);
  const y = linearScale([scale.min, scale.max], [box.bottom, box.y]);

  for (const tick of scale.ticks) {
    marks.push({ kind: 'line', x1: box.x, y1: y(tick), x2: box.right, y2: y(tick), stroke: palette.grid, width: 1 });
    marks.push({
      kind: 'text',
      x: box.x - 6,
      y: y(tick),
      dy: 3.5,
      text: String(Math.round(tick)),
      fill: palette.textMuted,
      size: 9,
      anchor: 'end',
    });
  }

  for (const pct of [0, 25, 50, 75, 100]) {
    marks.push({
      kind: 'text',
      x: x(pct),
      y: box.bottom + 13,
      text: `${pct}%`,
      fill: palette.textMuted,
      size: 9,
      anchor: pct === 0 ? 'start' : pct === 100 ? 'end' : 'middle',
    });
  }

  // The curve, broken wherever the series could not compute a percentile.
  const runs = runsOf(points, (p) => typeof p.w === 'number' && Number.isFinite(p.w)).map((run) =>
    run.map((p) => ({ x: x(p.pct), y: y(p.w as number) }))
  );

  // Area under it first: the area IS energy, which is why the axis is anchored at zero.
  const area = runs
    .map((run) => {
      const line = run.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
      return `${line} L ${run[run.length - 1].x.toFixed(2)} ${box.bottom.toFixed(2)} L ${run[0].x.toFixed(2)} ${box.bottom.toFixed(2)} Z`;
    })
    .join(' ');
  marks.push({ kind: 'path', d: area, fill: palette.series[0], opacity: 0.15 });
  marks.push({ kind: 'path', d: pathFromRuns(runs), fill: 'none', stroke: palette.series[0], width: 2 });

  if (threshold !== null) {
    const ty = y(threshold);
    marks.push({
      kind: 'line',
      x1: box.x,
      y1: ty,
      x2: box.right,
      y2: ty,
      stroke: palette.threshold,
      width: 1.5,
      dash: '5 3',
    });
    marks.push({
      kind: 'text',
      x: box.right,
      // Above the rule when there is room, below it when the rule is near the top.
      y: ty - 4 < box.y + 10 ? ty + 12 : ty - 4,
      text: `DSM ceiling ${formatW(threshold)}`,
      fill: palette.threshold,
      size: 9,
      anchor: 'end',
    });

    const share = shareAbove(points, threshold);
    desc =
      share === null || share <= 0
        ? `Load sorted high to low. The building never reached the ${formatW(threshold)} DSM ceiling in this period.`
        : `Load sorted high to low. The building was at or above the ${formatW(threshold)} DSM ceiling for ${share.toFixed(1)}% of the period.`;
  } else {
    desc = 'Load sorted high to low across the period. No DSM ceiling is set, so none is drawn.';
  }

  marks.push({ kind: 'line', x1: box.x, y1: box.bottom, x2: box.right, y2: box.bottom, stroke: palette.ink, width: 1 });

  return { width, height, idPrefix, title, desc, defs, marks };
}

/**
 * The share of the period at or above `threshold`, interpolated between the two points that
 * straddle it — the curve is 101 samples of a continuous thing, and reporting the nearest of
 * them would quantise the answer to 1% for no reason.
 */
function shareAbove(points: readonly DurationPoint[], threshold: number): number | null {
  const usable = points.filter((p): p is { pct: number; w: number } => typeof p.w === 'number' && Number.isFinite(p.w));
  if (usable.length === 0) return null;
  if (usable[0].w < threshold) return 0;

  for (let i = 1; i < usable.length; i++) {
    const prev = usable[i - 1];
    const here = usable[i];
    if (here.w < threshold) {
      const span = prev.w - here.w;
      const t = span === 0 ? 0 : (prev.w - threshold) / span;
      return prev.pct + (here.pct - prev.pct) * t;
    }
  }
  return usable[usable.length - 1].pct;
}

/**
 * `4,551 W` — grouped, because a bare four-digit wattage is read as a year often enough.
 *
 * `undefined` locale, not `'en-US'`. `test/site-naming.test.mjs` caught the hardcoded one, and
 * it is right to: the replication framework has to stand this up for another institution, and a
 * grouping separator baked in here is one of the thirteen call sites RM-033 already had to go
 * back and unpick. The reader owns formatting.
 */
function formatW(w: number): string {
  return `${Math.round(w).toLocaleString(undefined)} W`;
}
