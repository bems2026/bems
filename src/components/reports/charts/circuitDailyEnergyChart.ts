import { bandScale, linearScale, niceScale, plotBox } from './chartFrame';
import type { ChartSpec, Def, Hit, Mark, Scene } from './types';
import { directLabelMarks, directLabelWidth, LABEL_GAP, type DirectLabel } from './directLabels';

/**
 * Energy per day, circuit by circuit — RM-095.
 *
 * The operator asked for the branch circuits' weekly and monthly graphs on the report, as Analytics
 * draws them for "now". Analytics' charts are live and drawn by a chart library; a report's charts are
 * scenes, so the page and the PDF are two renderings of one picture. This is the report's form of it.
 *
 * STACKED, because on the "all circuits" view the parts are the whole: the branch meters are what the
 * building total is the sum of (RM-057). Narrowed to a category it is that category's circuits.
 *
 * THE RULES dailyEnergyChart keeps, kept here:
 *   - a day no circuit recorded is a hatched gap — merged per outage and labelled once — never a zero
 *     bar, which would say the building used nothing;
 *   - a partly recorded day is drawn lighter with a broken top edge: at least this much;
 *   - a circuit keeps ITS colour (`colourIndex`, from the site's own order) however the figures rank,
 *     so filtering or a different week never repaints one circuit as another.
 *
 * NAMED BESIDE THE LAST COLUMN — RM-139. Colour and a legend under the plot were all that told the
 * circuits apart. Each is now named level with its segment of the last recorded day, top of the stack
 * first, as the stack is read; a segment too thin to carry a name is left to the legend.
 */

export interface CircuitSeriesDef {
  id: string;
  label: string;
  /** Index into the palette's series, fixed per circuit — never the circuit's rank on this chart. */
  colourIndex: number;
}

export interface CircuitDayPoint {
  /** ISO local date; the hit's label. */
  day: string;
  /** Under the bar — the day of the month. */
  label: string;
  /** kWh per series, in `series` order. `null` means that circuit recorded nothing that day. */
  values: readonly (number | null)[];
  /** Did any circuit record anything? */
  observed: boolean;
  /** Was every circuit recorded fully enough for this to be a total rather than a floor? */
  complete: boolean;
  /** Said on hover, such as a counter jump the figure does not count. */
  notes?: readonly string[];
}

const MARGINS = { top: 20, right: 10, bottom: 46, left: 44 };
const TARGET_LABELS = 10;
const CHAR_W = 4.9;

const kwh = (v: number) => `${v.toFixed(2)} kWh`;

export function circuitDailyEnergyChart(points: readonly CircuitDayPoint[], series: readonly CircuitSeriesDef[], spec: ChartSpec): Scene {
  const { width, height, palette, idPrefix, title } = spec;
  const named = series.length > 1;
  const box = plotBox(width, height, { ...MARGINS, right: MARGINS.right + (named ? directLabelWidth(series.map((s) => s.label)) : 0) });
  const marks: Mark[] = [];
  const defs: Def[] = [];
  const gapId = `${idPrefix}-gap`;
  const colour = (s: CircuitSeriesDef) => palette.series[s.colourIndex % palette.series.length];

  const totals = points.map((p) => (p.observed ? p.values.reduce<number>((a, v) => a + (v ?? 0), 0) : null));
  const scale = niceScale(totals, { zeroBased: true });
  const missing = points.filter((p) => !p.observed).length;

  if (scale === null) {
    marks.push({ kind: 'text', x: width / 2, y: box.y + box.h / 2, text: 'Nothing was recorded in this period', fill: palette.textMuted, size: 12, anchor: 'middle' });
    return { width, height, idPrefix, title, desc: 'No circuit recorded anything in this period, so there is nothing to draw.', defs, marks };
  }

  const desc = `Energy per day for ${series.length} circuit${series.length === 1 ? '' : 's'}, stacked. ${
    missing > 0 ? `${missing} of ${points.length} days were not recorded and are drawn as gaps.` : `All ${points.length} days were recorded.`
  }`;

  const y = linearScale([scale.min, scale.max], [box.bottom, box.y]);
  const band = bandScale(points.length, [box.x, box.right], 0.32);

  for (const tick of scale.ticks) {
    marks.push({ kind: 'line', x1: box.x, y1: y(tick), x2: box.right, y2: y(tick), stroke: palette.grid, width: 1 });
    marks.push({ kind: 'text', x: box.x - 6, y: y(tick), dy: 3.5, text: scale.max >= 10 ? String(Math.round(tick)) : String(tick), fill: palette.textMuted, size: 9, anchor: 'end' });
  }

  // --- gaps, one block per outage ---
  const runs: { from: number; to: number }[] = [];
  points.forEach((p, i) => {
    if (p.observed) return;
    const last = runs[runs.length - 1];
    if (last && last.to === i - 1) last.to = i;
    else runs.push({ from: i, to: i });
  });
  if (runs.length > 0) defs.push({ kind: 'hatch', id: gapId, stroke: palette.gap });
  const slot = box.w / Math.max(points.length, 1);
  for (const run of runs) {
    const x = box.x + run.from * slot;
    const w = (run.to - run.from + 1) * slot;
    marks.push({ kind: 'rect', x, y: box.y, w, h: box.h, fill: `url(#${gapId})`, opacity: 0.45 });
    const days = run.to - run.from + 1;
    const text = days > 1 ? `${days} days, no data` : 'no data';
    if (w >= text.length * 4.6) {
      marks.push({ kind: 'text', x: x + w / 2, y: box.y + box.h / 2, text, fill: palette.textMuted, size: 9, anchor: 'middle' });
    }
  }

  // --- stacks ---
  const every = Math.max(1, Math.ceil(points.length / TARGET_LABELS));
  points.forEach((p, i) => {
    const { x, w, cx } = band(i);
    if (p.observed) {
      let acc = 0;
      series.forEach((s, k) => {
        const v = p.values[k];
        if (v === null || v === undefined || !(v > 0)) return;
        const bottom = y(acc);
        const top = y(acc + v);
        // A 1px surface gap between stacked fills, so two neighbours never read as one bar.
        const h = Math.max(bottom - top - (k > 0 ? 1 : 0), 0.8);
        marks.push({ kind: 'rect', x, y: top, w, h, fill: colour(s), opacity: p.complete ? undefined : 0.5 });
        acc += v;
      });
      if (!p.complete) {
        marks.push({ kind: 'line', x1: x, y1: y(acc), x2: x + w, y2: y(acc), stroke: palette.ink, width: 1.4, dash: '3 2' });
      }
    }
    if (i % every === 0) {
      marks.push({ kind: 'text', x: cx, y: box.bottom + 13, text: p.label, fill: palette.textMuted, size: 9, anchor: 'middle' });
    }
  });

  // --- each circuit named level with its segment of the last recorded day ---
  const lastSeen = points.map((p) => p.observed).lastIndexOf(true);
  if (named && lastSeen >= 0) {
    const names: DirectLabel[] = [];
    let acc = 0;
    series.forEach((s, k) => {
      const v = points[lastSeen].values[k];
      if (v === null || v === undefined || !(v > 0)) return;
      const [bottom, top] = [y(acc), y(acc + v)];
      if (bottom - top >= LABEL_GAP) names.push({ text: s.label, y: (bottom + top) / 2, colour: colour(s), swatch: 'block' });
      acc += v;
    });
    marks.push(...directLabelMarks(names, box.right, box.y, box.bottom, palette));
  }

  marks.push({ kind: 'line', x1: box.x, y1: box.bottom, x2: box.right, y2: box.bottom, stroke: palette.ink, width: 1 });

  // --- legend, in the order given — which is the site's, not this period's ranking ---
  const ly = height - 8;
  let lx = box.x;
  for (const s of series) {
    marks.push({ kind: 'rect', x: lx, y: ly - 5, w: 10, h: 10, fill: colour(s), rx: 2 });
    marks.push({ kind: 'text', x: lx + 14, y: ly, dy: 3, text: s.label, fill: palette.textMuted, size: 9, anchor: 'start' });
    lx += 14 + s.label.length * CHAR_W + 14;
  }
  if (runs.length > 0) {
    marks.push({ kind: 'rect', x: lx, y: ly - 5, w: 10, h: 10, fill: `url(#${gapId})`, opacity: 0.45 });
    marks.push({ kind: 'text', x: lx + 14, y: ly, dy: 3, text: 'no data', fill: palette.textMuted, size: 9, anchor: 'start' });
  }

  // --- one hit per day: the total leads, each circuit and any correction follow ---
  const hits: Hit[] = points.map((p, i) => {
    const base = { x: box.x + i * slot, y: box.y, w: slot, h: box.h, label: p.day };
    if (!p.observed) return { ...base, value: 'No data' };
    const parts = series.map((s, k) => {
      const v = p.values[k];
      return `${s.label} ${v === null || v === undefined ? '—' : kwh(v)}`;
    });
    const notes = [...parts, ...(p.complete ? [] : ['partly recorded, so at least this much']), ...(p.notes ?? [])];
    return { ...base, value: kwh(totals[i] as number), note: notes.join(' · ') };
  });

  return { width, height, idPrefix, title, desc, defs, marks, hits };
}
