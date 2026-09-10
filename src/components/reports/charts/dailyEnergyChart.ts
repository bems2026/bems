import { DEFAULT_MARGINS, bandScale, linearScale, niceScale, plotBox } from './chartFrame';
import type { ChartSpec, Def, Mark, Scene } from './types';

/**
 * Energy per day, with the days nobody watched drawn as gaps rather than as zeroes.
 *
 * THE RULE THIS CHART EXISTS TO KEEP. August 2026 on the live project holds five days where
 * `building_totals` carries a full complement of rows and not one of them contains a reading —
 * the meters wrote on schedule while observing nothing, and the energy counter sat frozen, so
 * the series reports 0 kWh for each. Drawn naively those are five confident zero bars, and a
 * reader concludes the building was quiet. It was not. Nobody was watching.
 *
 * Three states, three treatments, and no two of them look alike:
 *
 *   observed and complete   a bar. Its length is its value, which is why the axis starts at zero.
 *   observed but partial    a bar at reduced weight, carrying a `≥` above it. 2026-08-19 recorded
 *                           0.89 kWh from 166 usable minutes of 1,440; that is a floor, and on a
 *                           shared axis an unmarked floor reads as a comparison.
 *   not observed            a hatched block the full height of the plot, labelled "no data".
 *                           Never a bar, at any height — a zero-height bar and a genuine zero are
 *                           the same picture, and only one of them is a fact.
 *
 * The caller decides which state a day is in; `observed` and `complete` arrive already resolved.
 * Coverage policy lives in one place (`coverageOf`) and it is not here.
 */

export interface DailyEnergyPoint {
  /** ISO date, the building's own day. Used for identity, not drawn. */
  day: string;
  /** What goes under the bar — the day of the month, usually. */
  label: string;
  kwh: number | null;
  /** Did this day carry any real reading at all? Rows alone do not count. */
  observed: boolean;
  /** Was it observed enough for its total to be a total rather than a floor? */
  complete: boolean;
}

/** Roughly this many day labels, thinned evenly. A month of 31 at 9px overlaps below ~500px. */
const TARGET_LABELS = 10;

export function dailyEnergyChart(points: readonly DailyEnergyPoint[], spec: ChartSpec): Scene {
  const { width, height, palette, idPrefix, title } = spec;
  const box = plotBox(width, height, DEFAULT_MARGINS);
  const marks: Mark[] = [];
  const defs: Def[] = [];

  const gapId = `${idPrefix}-gap`;
  const observed = points.filter((p) => p.observed);
  const missing = points.length - observed.length;

  // Only observed days may set the scale. A frozen day reporting 0 kWh is not evidence about
  // how much this building uses, so it must not compress the axis for the days that are.
  const scale = niceScale(observed.map((p) => p.kwh), { zeroBased: true });

  const desc = scale === null
    ? `No day in this period carried a reading, so there is nothing to draw.`
    : `Energy per day. ${missing > 0 ? `${missing} of ${points.length} days were not observed and are drawn as gaps.` : `All ${points.length} days were observed.`}`;

  if (scale === null) {
    // No axis, no grid, no bars. A confident empty grid over a period nobody watched reads as a
    // period of zero consumption, which is the failure this whole file is written against.
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

  const y = linearScale([scale.min, scale.max], [box.bottom, box.y]);
  const band = bandScale(points.length, [box.x, box.right], 0.32);

  // --- grid and y axis ---
  for (const tick of scale.ticks) {
    marks.push({ kind: 'line', x1: box.x, y1: y(tick), x2: box.right, y2: y(tick), stroke: palette.grid, width: 1 });
    marks.push({
      kind: 'text',
      x: box.x - 6,
      y: y(tick),
      dy: 3.5,
      text: formatTick(tick, scale.max),
      fill: palette.textMuted,
      size: 9,
      anchor: 'end',
    });
  }

  /**
   * GAPS ARE DRAWN PER OUTAGE, NOT PER DAY.
   *
   * August 2026 has twenty unobserved days. One hatched block and one "no data" label each gives
   * twenty 8px labels in nine-pixel bands — an unreadable smear that is worse than no label, and
   * it makes the chart look broken rather than the month. An outage is one event; drawing it as
   * one block, labelled once in the middle, is both legible and a truer description.
   *
   * Runs are merged before anything is drawn, so this is a property of the geometry rather than
   * a rendering trick: `gaps(marks).length` is the number of outages.
   */
  const runs: { from: number; to: number }[] = [];
  points.forEach((p, i) => {
    if (p.observed) return;
    const last = runs[runs.length - 1];
    if (last && last.to === i - 1) last.to = i;
    else runs.push({ from: i, to: i });
  });

  if (runs.length > 0) defs.push({ kind: 'hatch', id: gapId, stroke: palette.gap });
  for (const run of runs) {
    // Edge to edge across the run, including the padding between its bands: the whole stretch
    // was dark, not just the parts a bar would have covered.
    const startBand = band(run.from);
    const endBand = band(run.to);
    const x = startBand.x - (startBand.w / 0.68) * 0.16;
    const right = endBand.x + endBand.w + (endBand.w / 0.68) * 0.16;
    const w = right - x;
    marks.push({ kind: 'rect', x, y: box.y, w, h: box.h, fill: `url(#${gapId})`, opacity: 0.45 });

    // The hatch is a legend nobody has been given, so it gets words — but only where they fit.
    // A clipped or overlapping label is worse than the hatch alone.
    const days = run.to - run.from + 1;
    const text = days > 1 ? `${days} days, no data` : 'no data';
    if (w >= text.length * 4.6) {
      marks.push({
        kind: 'text',
        x: x + w / 2,
        y: box.y + box.h / 2,
        text,
        fill: palette.textMuted,
        size: 9,
        anchor: 'middle',
      });
    }
  }

  // --- bars and day labels ---
  const every = Math.max(1, Math.ceil(points.length / TARGET_LABELS));
  points.forEach((p, i) => {
    const { x, w, cx } = band(i);

    if (!p.observed) {
      // Its block was drawn with its run, above.
    } else {
      const value = p.kwh ?? 0;
      const top = y(value);
      // A day that was watched and drew nothing still gets a mark. Zero height would erase a
      // real observation, and an erased observation is indistinguishable from an absent one.
      const h = Math.max(box.bottom - top, 0.8);
      marks.push({
        kind: 'rect',
        x,
        y: box.bottom - h,
        w,
        h,
        fill: palette.series[0],
        opacity: p.complete ? undefined : 0.5,
      });
      if (!p.complete) {
        /**
         * AN OPEN, DASHED CAP — the bar is not finished, so neither is its top edge.
         *
         * The first version put a `≥` above the bar. At 9px in a font the document may not
         * embed it renders as an ambiguous smudge — and even drawn perfectly, a reader has no
         * reason to know what a mathematical operator floating above a bar means. A broken top
         * edge is the conventional "at least this much" and needs no legend.
         *
         * It is also a second channel: opacity alone is decoration, invisible in a monochrome
         * print and unreliable for a reader with low contrast sensitivity.
         */
        marks.push({
          kind: 'line',
          x1: x,
          y1: box.bottom - h,
          x2: x + w,
          y2: box.bottom - h,
          stroke: palette.series[0],
          width: 1.6,
          dash: '3 2',
        });
      }
    }

    if (i % every === 0) {
      marks.push({
        kind: 'text',
        x: cx,
        y: box.bottom + 13,
        text: p.label,
        fill: palette.textMuted,
        size: 9,
        anchor: 'middle',
      });
    }
  });

  // The baseline last, so it sits over the gap hatching rather than under it.
  marks.push({ kind: 'line', x1: box.x, y1: box.bottom, x2: box.right, y2: box.bottom, stroke: palette.ink, width: 1 });

  return { width, height, idPrefix, title, desc, defs, marks };
}

/** Ticks carry a decimal only when the axis is small enough to need one — `0.5` on a 2 kWh
 *  axis, `12` on a 24 kWh one. A month of "14.00" down the side is noise. */
function formatTick(tick: number, max: number): string {
  if (max >= 10) return String(Math.round(tick));
  return Number.isInteger(tick) ? String(tick) : tick.toFixed(1);
}
