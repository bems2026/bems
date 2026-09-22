import type { ChartPalette, Mark } from './types';

/**
 * Pure. Names beside the plot, level with what they name — RM-139.
 *
 * The circuit charts told their series apart by colour and a legend under the plot: to read a line,
 * the eye went down to the legend, matched a hue, and came back up — and for a reader who cannot tell
 * two of the hues apart, the match was a guess. A name at the line's end, or level with a stack's
 * segment, is read where the eye already is. Each name carries a swatch in its series' own pattern, so
 * the name, the shape and the colour say the same thing three ways. The legend stays: it is the PDF's
 * key, and it names a series whose segment is too thin to carry a name here.
 *
 * NAMES NEVER OVERLAP. Two circuits ending on the same value would print one name on top of the other;
 * `spread` moves them apart by one line of text, as little as it can, and keeps them beside the plot.
 */

export interface DirectLabel {
  text: string;
  /** Where the eye already is: a line's last reading, a segment's middle. */
  y: number;
  colour: string;
  /** The series' line pattern; solid when absent. */
  dash?: string;
  /** A short stroke for a line chart, a small block for bars. */
  swatch: 'line' | 'block';
}

/** Between two names' baselines: the 9 px text and a little air. */
export const LABEL_GAP = 11;

const PAD = 6;
const SWATCH_W = 12;
const CHAR_W = 4.9;

/** How much right margin these names need, or 0 when there are none. */
export function directLabelWidth(texts: readonly string[]): number {
  if (texts.length === 0) return 0;
  return PAD + SWATCH_W + 4 + Math.max(...texts.map((t) => t.length)) * CHAR_W;
}

/**
 * Each y moved as little as it takes for no two to be closer than `gap`, all within `[top, bottom]`,
 * in the input's order. Down from the top first; if that runs past the bottom, back up from it.
 */
export function spread(ys: readonly number[], top: number, bottom: number, gap = LABEL_GAP): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const placed = order.map((o) => Math.min(Math.max(o.y, top), bottom));
  for (let k = 1; k < placed.length; k++) placed[k] = Math.max(placed[k], placed[k - 1] + gap);
  if (placed.length > 0 && placed[placed.length - 1] > bottom) {
    placed[placed.length - 1] = bottom;
    for (let k = placed.length - 2; k >= 0; k--) placed[k] = Math.min(placed[k], placed[k + 1] - gap);
  }
  const out = new Array<number>(ys.length);
  order.forEach((o, k) => (out[o.i] = placed[k]));
  return out;
}

/** The marks for `labels`, starting at `x` (the plot's right edge), top first as they are read. */
export function directLabelMarks(labels: readonly DirectLabel[], x: number, top: number, bottom: number, palette: ChartPalette): Mark[] {
  const ys = spread(
    labels.map((l) => l.y),
    top,
    bottom
  );
  return labels
    .map((label, i) => ({ label, y: ys[i] }))
    .sort((a, b) => a.y - b.y)
    .flatMap(({ label, y }): Mark[] => [
      label.swatch === 'line'
        ? { kind: 'line', x1: x + PAD, y1: y, x2: x + PAD + SWATCH_W, y2: y, stroke: label.colour, width: 2, dash: label.dash }
        : { kind: 'rect', x: x + PAD + 2, y: y - 4, w: 8, h: 8, fill: label.colour, rx: 2 },
      { kind: 'text', x: x + PAD + SWATCH_W + 4, y, dy: 3, text: label.text, fill: palette.textMuted, size: 9, anchor: 'start' },
    ]);
}
