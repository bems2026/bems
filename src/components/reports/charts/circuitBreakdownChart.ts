import type { ChartSpec, Def, Hit, Mark, Scene } from './types';

/**
 * Where the building's energy went, as a share of its own total.
 *
 * A 100% STACKED BAR IS THE HONEST FORM HERE, and not merely a stylistic preference. Since
 * RM-057 the building total IS the sum of these four branch meters, so the parts really do make
 * the whole and a share really is a share. A chart of figures that did not sum would be a lie
 * about arithmetic; this one is exact by construction, which is worth having and rare.
 *
 * AN UNMETERED CIRCUIT IS NOT A ZERO-WIDTH SEGMENT. The seven light switches carry no metering
 * at all, and a sliver of nothing beside four real segments says the lights used no electricity.
 * They are excluded from the bar and named in the description instead — the same rule that makes
 * an unobserved hour an em dash rather than 0 W.
 */

export interface CircuitSegment {
  label: string;
  /** `null` means unmetered — not zero, and not drawn. */
  kwh: number | null;
  /**
   * Why a metered circuit is left out of the split — RM-090, when its stored figure is impossible.
   * Not drawn, and not called unmetered: the description says what it is instead.
   */
  excluded?: string;
  /** RM-095: the palette index this segment's circuit or category always takes. Position when absent. */
  colourIndex?: number;
}

export interface BreakdownOptions {
  /**
   * Energy on a branch that its own sub-meters do not account for. Deliberately NOT
   * "building minus branches", which is structurally zero since RM-057 and would draw as a
   * broken chart rather than a finding.
   */
  untracked?: { label: string; kwh: number | null };
  /**
   * What a segment is. The Overview's and Circuits tab's "Energy by use" bars are Lighting, Aircon and
   * Others — three uses over four circuits — and a label counting them as "3 circuits" was wrong.
   */
  of?: 'circuits' | 'uses';
}

const BAR_H = 34;
const SWATCH = 9;
/** Roughly the width one character of the 9px label font occupies. */
const CHAR_W = 4.9;

export function circuitBreakdownChart(
  segments: readonly CircuitSegment[],
  spec: ChartSpec,
  options: BreakdownOptions = {}
): Scene {
  const { width, height, palette, idPrefix, title } = spec;
  const marks: Mark[] = [];
  const defs: Def[] = [];
  const padX = 10;
  const barW = width - padX * 2;

  const metered = segments.filter((s): s is CircuitSegment & { kwh: number } => typeof s.kwh === 'number' && Number.isFinite(s.kwh));
  const excluded = segments.filter((s) => s.excluded);
  const unmetered = segments.filter((s) => !s.excluded && (typeof s.kwh !== 'number' || !Number.isFinite(s.kwh)));
  const total = metered.reduce((a, s) => a + s.kwh, 0);

  const notes: string[] = [];
  if (unmetered.length > 0) {
    notes.push(`${unmetered.map((s) => s.label).join(', ')} ${unmetered.length === 1 ? 'is' : 'are'} not metered, so ${unmetered.length === 1 ? 'it is' : 'they are'} not in this split.`);
  }
  for (const s of excluded) notes.push(`${s.label} is left out: ${s.excluded}.`);
  const untracked = options.untracked;
  if (untracked && typeof untracked.kwh === 'number' && Number.isFinite(untracked.kwh)) {
    notes.push(`${fmt(untracked.kwh)} kWh on ${untracked.label} is not attributable to a sub-meter beneath it.`);
  }

  if (metered.length === 0 || total <= 0) {
    const desc = `Nothing on this building is metered for the period. ${notes.join(' ')}`.trim();
    marks.push({
      kind: 'text',
      x: width / 2,
      y: height / 2,
      text: 'Nothing was metered in this period',
      fill: palette.textMuted,
      size: 12,
      anchor: 'middle',
    });
    return { width, height, idPrefix, title, desc, defs, marks };
  }

  const parts = partsLabel(metered.length, options.of ?? 'circuits');
  const desc = `Share of ${fmt(total)} kWh across ${options.of === 'uses' ? parts : parts.replace(/ (circuits?)$/, ' metered $1')}. ${notes.join(' ')}`.trim();

  const barY = 22;
  let x = padX;
  const unlabelled: { label: string; colour: string; pct: number }[] = [];
  // Exactly the segment: the bar is one row, so there is no taller column to widen it into.
  const hits: Hit[] = [];

  metered.forEach((s, i) => {
    const w = (s.kwh / total) * barW;
    const colour = palette.series[(s.colourIndex ?? i) % palette.series.length];
    const pct = (s.kwh / total) * 100;
    marks.push({ kind: 'rect', x, y: barY, w, h: BAR_H, fill: colour });
    hits.push({ x, y: barY, w, h: BAR_H, label: s.label, value: `${fmt(s.kwh)} kWh`, note: `${pct.toFixed(1)}% of the metered total` });

    // In place when it fits, in the legend when it does not. A clipped label is worse than a
    // swatch, and a label that spills into its neighbour is worse than both.
    const inline = `${s.label} ${pct.toFixed(1)}%`;
    if (w >= inline.length * CHAR_W + 10) {
      marks.push({
        kind: 'text',
        x: x + w / 2,
        y: barY + BAR_H / 2,
        dy: 3.5,
        text: inline,
        fill: palette.surface,
        size: 9,
        weight: 500,
        anchor: 'middle',
      });
    } else {
      unlabelled.push({ label: s.label, colour, pct });
    }
    x += w;
  });

  // Percentages above the bar for every segment, so the reader can total them without
  // re-measuring the picture.
  marks.push({
    kind: 'text',
    x: padX,
    y: barY - 6,
    text: `${fmt(total)} kWh across ${parts}`,
    fill: palette.textMuted,
    size: 9,
    anchor: 'start',
  });

  // --- legend for whatever did not fit ---
  let lx = padX;
  const ly = barY + BAR_H + 14;
  for (const item of unlabelled) {
    marks.push({ kind: 'rect', x: lx, y: ly - SWATCH + 1, w: SWATCH, h: SWATCH, fill: item.colour, rx: 1.5 });
    const text = `${item.label} ${item.pct.toFixed(1)}%`;
    marks.push({
      kind: 'text',
      x: lx + SWATCH + 4,
      y: ly,
      text,
      fill: palette.text,
      size: 9,
      anchor: 'start',
    });
    lx += SWATCH + 6 + text.length * CHAR_W + 12;
  }

  return { width, height, idPrefix, title, desc, defs, marks, hits };
}

/** Two decimals below 10 kWh, one above — a month's total does not need hundredths. */
/** "1 circuit", "4 circuits", "3 uses". */
function partsLabel(n: number, of: 'circuits' | 'uses'): string {
  const noun = of === 'uses' ? 'use' : 'circuit';
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function fmt(kwh: number): string {
  return kwh >= 10 ? kwh.toFixed(1) : kwh.toFixed(2);
}
