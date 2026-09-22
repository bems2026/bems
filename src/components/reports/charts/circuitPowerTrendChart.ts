import { linearScale, niceScale, pathFromRuns, plotBox, runsOf } from './chartFrame';
import type { ChartSpec, Hit, Mark, Scene } from './types';
import { SERIES_DASH } from './palette';

/**
 * Power through the week or month, one line per circuit — RM-095.
 *
 * This is the report's form of Analytics' multi-line power chart, for a stored period rather than for
 * "now": each branch meter's average power hour by hour, from `readings_archive`. A scene, so the PDF
 * carries the same picture.
 *
 * THE LINE BREAKS AT AN HOUR WITH NO READING and is never drawn through it — EX-102's rule, which
 * `runsOf` expresses once. Joining the hours either side of an outage draws a confident line through a
 * stretch nobody recorded.
 *
 * ONE AXIS, in watts, for every circuit: they are the same measure, so they share a scale and a lighting
 * circuit's 40 W sits visibly beneath an aircon's 600 W, which is the comparison the chart is for.
 *
 * Read a day at a time: an hour of a month is a column less than a pixel wide, and a target that small
 * is one nobody lands on.
 *
 * EACH LINE IS ITS CIRCUIT BEFORE IT IS ITS COLOUR — RM-139. Four lines that cross, told apart by hue
 * alone, left a reader who cannot see two of the hues guessing. Each wears its circuit's pattern
 * (`SERIES_DASH`), and the legend shows the same pattern beside the name. RM-139 also named each line at its
 * end; RM-142 took that out — a second legend, stacked at the edge wherever the lines ended together.
 */

export interface TrendSeries {
  id: string;
  label: string;
  /** Index into the palette's series, fixed per circuit. */
  colourIndex: number;
  /** Average watts per hour slot; `null` for an hour with no reading. Every series is the same length. */
  points: readonly (number | null)[];
}

export interface TrendDay {
  /** The slot index this local day starts at. */
  index: number;
  /** Under the axis — the day of the month. */
  label: string;
  /** ISO local date; the hit's label. */
  key: string;
}

const MARGINS = { top: 20, right: 10, bottom: 46, left: 48 };
const TARGET_LABELS = 10;
const CHAR_W = 4.9;

const watts = (w: number) => `${Math.round(w).toLocaleString(undefined)} W`;

export function circuitPowerTrendChart(series: readonly TrendSeries[], days: readonly TrendDay[], spec: ChartSpec): Scene {
  const { width, height, palette, idPrefix, title } = spec;
  const box = plotBox(width, height, MARGINS);
  const marks: Mark[] = [];
  const colour = (s: TrendSeries) => palette.series[s.colourIndex % palette.series.length];
  const dash = (s: TrendSeries) => SERIES_DASH[s.colourIndex % SERIES_DASH.length];
  const n = Math.max(0, ...series.map((s) => s.points.length));

  const scale = niceScale(series.flatMap((s) => s.points), { zeroBased: true });
  if (scale === null || n === 0) {
    marks.push({ kind: 'text', x: width / 2, y: box.y + box.h / 2, text: 'Nothing was recorded in this period', fill: palette.textMuted, size: 12, anchor: 'middle' });
    return { width, height, idPrefix, title, desc: 'No circuit recorded any power in this period, so there is nothing to draw.', defs: [], marks };
  }

  const missingHours = series.reduce((a, s) => a + s.points.filter((p) => p === null).length, 0);
  const desc = `Average power per hour for ${series.length} circuit${series.length === 1 ? '' : 's'}, on one scale in watts. ${
    missingHours > 0 ? 'Lines break where an hour had no reading.' : 'Every hour had a reading.'
  }`;

  const y = linearScale([scale.min, scale.max], [box.bottom, box.y]);
  const slotW = box.w / n;
  const cx = (i: number) => box.x + (i + 0.5) * slotW;

  for (const tick of scale.ticks) {
    marks.push({ kind: 'line', x1: box.x, y1: y(tick), x2: box.right, y2: y(tick), stroke: palette.grid, width: 1 });
    marks.push({ kind: 'text', x: box.x - 6, y: y(tick), dy: 3.5, text: Math.round(tick).toLocaleString(undefined), fill: palette.textMuted, size: 9, anchor: 'end' });
  }

  // --- day boundaries and labels ---
  const every = Math.max(1, Math.ceil(days.length / TARGET_LABELS));
  days.forEach((d, k) => {
    const x = box.x + d.index * slotW;
    if (d.index > 0) marks.push({ kind: 'line', x1: x, y1: box.y, x2: x, y2: box.bottom, stroke: palette.grid, width: 1, opacity: 0.6 });
    const next = days[k + 1]?.index ?? n;
    if (k % every === 0) {
      marks.push({ kind: 'text', x: box.x + ((d.index + next) / 2) * slotW, y: box.bottom + 13, text: d.label, fill: palette.textMuted, size: 9, anchor: 'middle' });
    }
  });

  // --- one line per circuit, broken at every hour without a reading ---
  for (const s of series) {
    const runs = runsOf(
      s.points.map((w, i) => ({ w, i })),
      ({ w }) => w !== null && Number.isFinite(w)
    );
    if (runs.length === 0) continue;
    marks.push({
      kind: 'path',
      d: pathFromRuns(runs.map((run) => run.map(({ w, i }) => ({ x: cx(i), y: y(w as number) })))),
      fill: 'none',
      stroke: colour(s),
      width: 2,
      dash: dash(s),
    });
  }


  marks.push({ kind: 'line', x1: box.x, y1: box.bottom, x2: box.right, y2: box.bottom, stroke: palette.ink, width: 1 });

  // --- legend ---
  const ly = height - 8;
  let lx = box.x;
  for (const s of series) {
    marks.push({ kind: 'line', x1: lx, y1: ly, x2: lx + 17, y2: ly, stroke: colour(s), width: 2, dash: dash(s) });
    marks.push({ kind: 'text', x: lx + 22, y: ly, dy: 3, text: s.label, fill: palette.textMuted, size: 9, anchor: 'start' });
    lx += 22 + s.label.length * CHAR_W + 14;
  }

  // --- one hit per day ---
  const hits: Hit[] = days.map((d, k) => {
    const from = d.index;
    const to = days[k + 1]?.index ?? n;
    const base = { x: box.x + from * slotW, y: box.y, w: (to - from) * slotW, h: box.h, label: d.key };
    let highest: number | null = null;
    const parts: string[] = [];
    for (const s of series) {
      const values = s.points.slice(from, to).filter((w): w is number => w !== null && Number.isFinite(w));
      if (values.length === 0) {
        parts.push(`${s.label} no reading`);
        continue;
      }
      const avg = values.reduce((a, w) => a + w, 0) / values.length;
      const max = Math.max(...values);
      highest = highest === null ? max : Math.max(highest, max);
      parts.push(`${s.label} average ${watts(avg)}, highest ${watts(max)}`);
    }
    return highest === null ? { ...base, value: 'No data' } : { ...base, value: `Highest ${watts(highest)}`, note: parts.join(' · ') };
  });

  return { width, height, idPrefix, title, desc, defs: [], marks, hits };
}
