import type { ChartSpec, Def, Mark, Scene } from './types';

/**
 * Demand as a calendar: one cell per hour, days down, hours across.
 *
 * The fastest way to see that the aircon ran through a weekend, and the only chart in this
 * folder where a coverage gap is visible as a SHAPE rather than as a footnote — a dark fortnight
 * is a dark block, and no percentage conveys that as directly.
 *
 * AN UNOBSERVED CELL IS NOT THE LIGHTEST STEP OF THE RAMP. The ramp runs least to most, so its
 * lightest step means "this hour drew almost nothing" — and 153 of August 2026's 744 cells hold
 * rows carrying no reading at all. Painting those the same colour as a genuinely quiet hour
 * turns two weeks of blindness into a picture of a calm building. They get the hatch instead:
 * outside the ramp entirely, and legended in words.
 */

export interface HeatCell {
  /** ISO date in the building's own timezone. */
  day: string;
  hour: number;
  value: number | null;
}

const PAD_LEFT = 26;
const PAD_TOP = 16;
const PAD_RIGHT = 8;
const LEGEND_H = 26;
const SWATCH = 10;
const CHAR_W = 4.9;

export function demandHeatmapChart(cells: readonly HeatCell[], spec: ChartSpec): Scene {
  const { width, height, palette, idPrefix, title } = spec;
  const marks: Mark[] = [];
  const defs: Def[] = [];
  const gapId = `${idPrefix}-gap`;

  const days = [...new Set(cells.map((c) => c.day))].sort();
  const observed = cells.filter((c): c is HeatCell & { value: number } => typeof c.value === 'number' && Number.isFinite(c.value));
  const missing = cells.length - observed.length;

  if (observed.length === 0) {
    marks.push({
      kind: 'text',
      x: width / 2,
      y: height / 2,
      text: 'Nothing was observed in this period',
      fill: palette.textMuted,
      size: 12,
      anchor: 'middle',
    });
    return {
      width,
      height,
      idPrefix,
      title,
      desc: 'No hour in this period carried a reading, so there is nothing to shade.',
      defs,
      marks,
    };
  }

  const lo = Math.min(...observed.map((c) => c.value));
  const hi = Math.max(...observed.map((c) => c.value));
  const steps = palette.heat.length;
  /** A flat period is real — every cell equal must not divide by a zero span. */
  const bin = (v: number) => (hi === lo ? 0 : Math.min(steps - 1, Math.floor(((v - lo) / (hi - lo)) * steps)));

  const gridW = width - PAD_LEFT - PAD_RIGHT;
  const gridH = height - PAD_TOP - LEGEND_H;
  const cellW = gridW / 24;
  const cellH = gridH / Math.max(days.length, 1);
  const dayIndex = new Map(days.map((d, i) => [d, i]));

  if (missing > 0) defs.push({ kind: 'hatch', id: gapId, stroke: palette.gap, gap: 4, width: 1 });

  for (const cell of cells) {
    const row = dayIndex.get(cell.day);
    if (row === undefined) continue;
    const x = PAD_LEFT + cell.hour * cellW;
    const y = PAD_TOP + row * cellH;
    const fill = typeof cell.value === 'number' && Number.isFinite(cell.value)
      ? palette.heat[bin(cell.value)]
      : `url(#${gapId})`;
    marks.push({ kind: 'rect', x, y, w: cellW, h: cellH, fill });
  }

  // --- hour labels across the top, every third ---
  for (let h = 0; h < 24; h += 3) {
    marks.push({
      kind: 'text',
      x: PAD_LEFT + h * cellW + cellW / 2,
      y: PAD_TOP - 5,
      text: String(h).padStart(2, '0'),
      fill: palette.textMuted,
      size: 8,
      anchor: 'middle',
    });
  }

  // --- day labels down the side, thinned so a month does not overlap ---
  const everyDay = Math.max(1, Math.ceil(days.length / 10));
  days.forEach((d, i) => {
    if (i % everyDay !== 0) return;
    marks.push({
      kind: 'text',
      x: PAD_LEFT - 5,
      y: PAD_TOP + i * cellH + cellH / 2,
      dy: 3,
      text: String(Number(d.slice(8, 10))),
      fill: palette.textMuted,
      size: 8,
      anchor: 'end',
    });
  });

  // --- legend: the ramp, its two ends in watts, and the hatch in words ---
  const ly = height - LEGEND_H + 12;
  let lx = PAD_LEFT;
  marks.push({ kind: 'text', x: lx, y: ly + 7, text: `${Math.round(lo)} W`, fill: palette.textMuted, size: 8, anchor: 'start' });
  lx += String(Math.round(lo)).length * CHAR_W + 14;
  palette.heat.forEach((colour) => {
    marks.push({ kind: 'rect', x: lx, y: ly, w: SWATCH * 2, h: SWATCH, fill: colour });
    lx += SWATCH * 2;
  });
  lx += 5;
  marks.push({ kind: 'text', x: lx, y: ly + 7, text: `${Math.round(hi)} W`, fill: palette.textMuted, size: 8, anchor: 'start' });
  lx += String(Math.round(hi)).length * CHAR_W + 22;

  if (missing > 0) {
    marks.push({ kind: 'rect', x: lx, y: ly, w: SWATCH * 2, h: SWATCH, fill: `url(#${gapId})` });
    marks.push({
      kind: 'text',
      x: lx + SWATCH * 2 + 5,
      y: ly + 7,
      text: 'no data',
      fill: palette.textMuted,
      size: 8,
      anchor: 'start',
    });
  }

  const desc = `Demand by day and hour, ${Math.round(lo)}–${Math.round(hi)} W across ${days.length} days. ${
    missing > 0 ? `${missing} of ${cells.length} hours were never observed and are hatched.` : 'Every hour was observed.'
  }`;

  return { width, height, idPrefix, title, desc, defs, marks };
}
