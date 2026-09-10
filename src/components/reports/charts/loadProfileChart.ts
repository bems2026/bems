import {
  areaFromRuns,
  bandScale,
  linearScale,
  niceScale,
  pathFromRuns,
  plotBox,
  runsOf,
  type Pt,
} from './chartFrame';
import type { ChartSpec, Def, Mark, Scene } from './types';

/**
 * Demand by hour of the building's own day — median, spread, and peak.
 *
 * WHY THREE SERIES AND NOT ONE. A median alone cannot distinguish an hour that sat steadily at
 * 800 W from one that idled at 100 W and spiked to 4 kW twice; they can share a median. The
 * p50–p95 band is what says which, and the peak line is a separate series because a peak is a
 * single sample rather than a percentile — folding it into the band would smooth away exactly
 * the excursion a load-shedding threshold is set against.
 *
 * THE LINE BREAKS AT AN UNOBSERVED HOUR. It does not interpolate across. This is EX-102's rule
 * for the live 24h chart carried into the report: joining the points either side of a gap draws
 * a confident curve through hours nobody watched, and nothing on the page would say which part
 * was measured. `runsOf` in `chartFrame.ts` is that rule, expressed once.
 */

export interface HourProfilePoint {
  /** 0–23, in the building's own timezone. The SQL already bucketed it there. */
  hour: number;
  /** Samples behind this hour. Zero means nobody was watching, not that demand was zero. */
  n: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
}

const observedAt = (p: HourProfilePoint) => p.n > 0 && p.p50 !== null;

/** Room under the hour labels for the key. Three series and no legend is a puzzle, not a chart:
 *  the description names them in prose, but prose cannot say which one is the blue line. */
const MARGINS = { top: 20, right: 10, bottom: 46, left: 44 };
const CHAR_W = 4.9;

export function loadProfileChart(points: readonly HourProfilePoint[], spec: ChartSpec): Scene {
  const { width, height, palette, idPrefix, title } = spec;
  const box = plotBox(width, height, MARGINS);
  const marks: Mark[] = [];
  const defs: Def[] = [];
  const gapId = `${idPrefix}-gap`;

  const missing = points.filter((p) => !observedAt(p)).length;
  const scale = niceScale(
    points.flatMap((p) => [p.p95, p.max]),
    { zeroBased: true }
  );

  const desc =
    scale === null
      ? 'No hour in this period carried a reading, so there is nothing to draw.'
      : `Demand by hour of the day: median, the p50–p95 spread, and the peak. ${
          missing > 0 ? `${missing} of ${points.length} hours were never observed and are left blank.` : 'Every hour was observed.'
        }`;

  if (scale === null) {
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
  // Zero padding: the hours are contiguous, so the hatch of an unobserved one must meet its
  // neighbours rather than leaving a lit stripe between them.
  const band = bandScale(points.length, [box.x, box.right], 0);
  const cx = (i: number) => band(i).cx;

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

  // --- unobserved hours, merged into runs and hatched ---
  const dark = runsOf(
    points.map((p, i) => ({ p, i })),
    ({ p }) => !observedAt(p)
  );
  if (dark.length > 0) defs.push({ kind: 'hatch', id: gapId, stroke: palette.gap });
  for (const run of dark) {
    const x = band(run[0].i).x;
    const w = band(run[run.length - 1].i).x + band(run[run.length - 1].i).w - x;
    marks.push({ kind: 'rect', x, y: box.y, w, h: box.h, fill: `url(#${gapId})`, opacity: 0.4 });
  }

  // --- the three series, each broken at the same gaps ---
  const lit = runsOf(
    points.map((p, i) => ({ p, i })),
    ({ p }) => observedAt(p)
  );

  const bandRuns = lit.map((run) =>
    run.map(({ p, i }) => ({
      top: { x: cx(i), y: y(p.p95 ?? p.p50 ?? 0) } as Pt,
      bottom: { x: cx(i), y: y(p.p50 ?? 0) } as Pt,
    }))
  );
  marks.push({ kind: 'path', d: areaFromRuns(bandRuns), fill: palette.series[1], opacity: 0.18 });

  const peakRuns = lit.map((run) => run.filter(({ p }) => p.max !== null).map(({ p, i }) => ({ x: cx(i), y: y(p.max as number) })));
  if (peakRuns.some((r) => r.length > 0)) {
    marks.push({
      kind: 'path',
      d: pathFromRuns(peakRuns.filter((r) => r.length > 0)),
      fill: 'none',
      stroke: palette.series[1],
      width: 1,
      opacity: 0.75,
    });
  }

  // Median last, so it sits over the band it describes.
  marks.push({
    kind: 'path',
    d: pathFromRuns(lit.map((run) => run.map(({ p, i }) => ({ x: cx(i), y: y(p.p50 as number) })))),
    fill: 'none',
    stroke: palette.series[0],
    width: 2,
  });

  // --- hour labels, every third so 24 of them do not collide ---
  points.forEach((p, i) => {
    if (i % 3 !== 0) return;
    marks.push({
      kind: 'text',
      x: cx(i),
      y: box.bottom + 13,
      text: String(p.hour).padStart(2, '0'),
      fill: palette.textMuted,
      size: 9,
      anchor: 'middle',
    });
  });

  marks.push({ kind: 'line', x1: box.x, y1: box.bottom, x2: box.right, y2: box.bottom, stroke: palette.ink, width: 1 });

  // --- the key ---
  const ly = height - 8;
  let lx = box.x;
  const key = (draw: (x: number) => Mark[], label: string) => {
    marks.push(...draw(lx));
    marks.push({ kind: 'text', x: lx + 22, y: ly, dy: 3, text: label, fill: palette.textMuted, size: 9, anchor: 'start' });
    lx += 22 + label.length * CHAR_W + 14;
  };

  key((x) => [{ kind: 'line', x1: x, y1: ly, x2: x + 17, y2: ly, stroke: palette.series[0], width: 2 }], 'median');
  key((x) => [{ kind: 'rect', x, y: ly - 5, w: 17, h: 10, fill: palette.series[1], opacity: 0.18 }], 'p50–p95');
  key((x) => [{ kind: 'line', x1: x, y1: ly, x2: x + 17, y2: ly, stroke: palette.series[1], width: 1, opacity: 0.75 }], 'peak');
  if (missing > 0) {
    key((x) => [{ kind: 'rect', x, y: ly - 5, w: 17, h: 10, fill: `url(#${gapId})`, opacity: 0.4 }], 'no data');
  }

  return { width, height, idPrefix, title, desc, defs, marks };
}
