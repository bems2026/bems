import { DEFAULT_MARGINS, bandScale, linearScale, niceScale, plotBox } from './chartFrame';
import type { ChartSpec, Def, Hit, Mark, Scene } from './types';

/**
 * Energy per hour of one day — RM-124 — the daily chart's rules one day wide.
 *
 * The axis is always the twenty-four hours of the building's own day, 00 to 23, whatever the
 * data covers: an hour nobody watched is a hatched gap in its place, never a bar of any height
 * and never a missing column that would slide the afternoon left. `dailyEnergyChart.ts` says why
 * at length; the short version is that a zero-height bar and a genuine zero are the same picture,
 * and only one of them is a fact.
 *
 * One state is new here. phase42 credits an hour its measured power when the counter's rise was
 * more than the circuit could have drawn — the register acquired an offset, not electricity. Such
 * an hour is a real figure with a caveat, and it wears the same open, dashed cap the daily chart
 * gives a partly observed day: the bar is right as far as it goes, and its top edge says so.
 *
 * The caller resolves every state; `observed` and `clipped` arrive decided. Whether a day's bars
 * sum to its headline is phase46's promise, not this file's.
 */

export interface HourlyEnergyPoint {
  /** 0–23, in the building's own timezone. The SQL already bucketed it there. */
  hour: number;
  /** Credited energy; null when no meter carried a counter for this hour. */
  kwh: number | null;
  /** Did any meter record a minute in this hour? Rows alone do not count. */
  observed: boolean;
  /** Was the counter's rise refused and the measured power credited instead? */
  clipped: boolean;
  avgW: number | null;
  maxW: number | null;
  minutes: number;
}

const HOURS = 24;
const CHAR_W = 4.9;

export function hourlyEnergyChart(points: readonly HourlyEnergyPoint[], spec: ChartSpec): Scene {
  const { width, height, palette, idPrefix, title } = spec;
  const box = plotBox(width, height, DEFAULT_MARGINS);
  const marks: Mark[] = [];
  const defs: Def[] = [];
  const gapId = `${idPrefix}-gap`;

  // Every hour has a column, even when the caller left it out.
  const byHour = new Map(points.map((p) => [p.hour, p]));
  const cols: HourlyEnergyPoint[] = Array.from({ length: HOURS }, (_, h) =>
    byHour.get(h) ?? { hour: h, kwh: null, observed: false, clipped: false, avgW: null, maxW: null, minutes: 0 }
  );

  const observed = cols.filter((p) => p.observed);
  const missing = HOURS - observed.length;

  // Only observed hours may set the scale — a frozen hour reporting nothing is not evidence about
  // how much this building uses in an hour.
  const scale = niceScale(observed.map((p) => p.kwh), { zeroBased: true });

  const desc = scale === null
    ? 'No hour of this day carried a reading, so there is nothing to draw.'
    : `Energy per hour, 00:00 to 23:59. ${missing > 0 ? `${missing} of 24 hours were not recorded and are drawn as gaps.` : 'All 24 hours were recorded.'}`;

  if (scale === null) {
    marks.push({
      kind: 'text',
      x: width / 2,
      y: box.y + box.h / 2,
      text: 'Nothing was recorded on this day',
      fill: palette.textMuted,
      size: 12,
      anchor: 'middle',
    });
    return { width, height, idPrefix, title, desc, defs, marks };
  }

  const y = linearScale([scale.min, scale.max], [box.bottom, box.y]);
  const band = bandScale(HOURS, [box.x, box.right], 0.32);

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

  // Gaps per outage, not per hour — the daily chart's reasoning, at a finer grain: a night the
  // meter was dark is one event, labelled once.
  const runs: { from: number; to: number }[] = [];
  cols.forEach((p, i) => {
    if (p.observed) return;
    const last = runs[runs.length - 1];
    if (last && last.to === i - 1) last.to = i;
    else runs.push({ from: i, to: i });
  });

  if (runs.length > 0) defs.push({ kind: 'hatch', id: gapId, stroke: palette.gap });
  for (const run of runs) {
    const startBand = band(run.from);
    const endBand = band(run.to);
    const x = startBand.x - (startBand.w / 0.68) * 0.16;
    const right = endBand.x + endBand.w + (endBand.w / 0.68) * 0.16;
    const w = right - x;
    marks.push({ kind: 'rect', x, y: box.y, w, h: box.h, fill: `url(#${gapId})`, opacity: 0.45 });

    const hours = run.to - run.from + 1;
    const text = hours > 1 ? `${hours} h, no data` : 'no data';
    if (w >= text.length * CHAR_W) {
      marks.push({ kind: 'text', x: x + w / 2, y: box.y + box.h / 2, text, fill: palette.textMuted, size: 9, anchor: 'middle' });
    }
  }

  // Hour labels: every hour when the columns are wide enough for two digits, else every second or
  // third — always from 00, so the thinning never hides the start of the day.
  const slot = box.w / HOURS;
  const every = slot >= 2 * CHAR_W + 4 ? 1 : slot >= CHAR_W + 2 ? 2 : 3;

  cols.forEach((p, i) => {
    const { x, w, cx } = band(i);

    if (p.observed) {
      const value = p.kwh ?? 0;
      const top = y(value);
      // An hour that was watched and drew nothing still gets a mark — a hairline, not nothing.
      const h = Math.max(box.bottom - top, 0.8);
      marks.push({ kind: 'rect', x, y: box.bottom - h, w, h, fill: palette.series[0] });
      if (p.clipped) {
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
        text: String(i).padStart(2, '0'),
        fill: palette.textMuted,
        size: 9,
        anchor: 'middle',
      });
    }
  });

  marks.push({ kind: 'line', x1: box.x, y1: box.bottom, x2: box.right, y2: box.bottom, stroke: palette.ink, width: 1 });

  const hits: Hit[] = cols.map((p, i) => {
    const hh = String(i).padStart(2, '0');
    const measured = p.observed && p.kwh !== null;
    const notes: string[] = [];
    if (measured && p.avgW !== null) notes.push(`${Math.round(p.avgW).toLocaleString(undefined)} W on average`);
    if (measured && p.maxW !== null) notes.push(`${Math.round(p.maxW).toLocaleString(undefined)} W at most`);
    if (p.observed && p.minutes > 0 && p.minutes < 60) notes.push(`${p.minutes} of 60 minutes recorded`);
    if (p.clipped) notes.push('The counter jumped; credited from measured power');
    return {
      x: band(i).cx - slot / 2,
      y: box.y,
      w: slot,
      h: box.h,
      label: `${hh}:00–${hh}:59`,
      value: measured ? `${(p.kwh as number).toFixed(2)} kWh` : 'No data',
      ...(notes.length ? { note: notes.join(' · ') } : {}),
    };
  });

  return { width, height, idPrefix, title, desc, defs, marks, hits };
}

function formatTick(tick: number, max: number): string {
  if (max >= 10) return String(Math.round(tick));
  return Number.isInteger(tick) ? String(tick) : tick.toFixed(1);
}
