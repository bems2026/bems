import { describe, it, expect } from 'vitest';
import { dailyEnergyChart, type DailyEnergyPoint } from './dailyEnergyChart';
import { PRINT_PALETTE } from './palette';
import type { ChartSpec, Mark } from './types';

/**
 * The rule this chart exists to keep is not a drawing rule, it is an honesty rule, and August
 * 2026 on the live project is what it looks like when it is broken.
 *
 * That month holds five days where `building_totals` carries a full complement of rows and every
 * one of them has no reading in it — the meters wrote on schedule while observing nothing. The
 * 19th recorded 0.89 kWh from 166 usable minutes of 1,440. Drawn naively, the first five are
 * confident zero bars and the sixth is a short one, and a reader concludes the building was
 * quiet. It was not; nobody was watching.
 *
 * So: an unobserved day is a hatched gap and never a bar of any height, a day that was observed
 * and genuinely used nothing is a hairline bar that is NOT the gap, and a partly observed day is
 * drawn as a floor rather than a total.
 */

const SPEC: ChartSpec = {
  width: 520,
  height: 220,
  palette: PRINT_PALETTE,
  idPrefix: 'de',
  title: 'Energy per day, August 2026',
  desc: 'Thirty-one days, five of them unobserved.',
};

const day = (n: number, over: Partial<DailyEnergyPoint> = {}): DailyEnergyPoint => ({
  day: `2026-08-${String(n).padStart(2, '0')}`,
  label: String(n),
  kwh: 10,
  observed: true,
  complete: true,
  ...over,
});

const rects = (marks: Mark[]) => marks.filter((m): m is Extract<Mark, { kind: 'rect' }> => m.kind === 'rect');
const texts = (marks: Mark[]) => marks.filter((m): m is Extract<Mark, { kind: 'text' }> => m.kind === 'text');
const lines = (marks: Mark[]) => marks.filter((m): m is Extract<Mark, { kind: 'line' }> => m.kind === 'line');
/** Bars are filled with a series colour; gaps are filled with the hatch pattern. */
const bars = (marks: Mark[]) => rects(marks).filter((r) => !r.fill.startsWith('url('));
const gaps = (marks: Mark[]) => rects(marks).filter((r) => r.fill.startsWith('url('));

describe('dailyEnergyChart', () => {
  it('draws one bar per observed day and no bar for an unobserved one', () => {
    const scene = dailyEnergyChart([day(1), day(2, { observed: false, kwh: null }), day(3)], SPEC);
    expect(bars(scene.marks)).toHaveLength(2);
    expect(gaps(scene.marks)).toHaveLength(1);
  });

  it('draws a hatched gap for a day that carried rows but no readings', () => {
    // 2026-08-18: 1,414 rows, none of them a reading, and the energy counter frozen — so the
    // series reports 0 kWh. A bar of height zero here is a claim the building used nothing.
    //
    // Paired with the 17th deliberately: on its own the 18th is a period nobody observed at all,
    // which is a different state with its own treatment (see the empty-period test below). The
    // shape that matters is the real one — a dark day sitting among watched ones.
    const scene = dailyEnergyChart([day(17, { kwh: 14.68 }), day(18, { observed: false, kwh: 0 })], SPEC);
    expect(bars(scene.marks)).toHaveLength(1);
    expect(gaps(scene.marks)).toHaveLength(1);
  });

  it('distinguishes a genuine zero from an unobserved day', () => {
    // A day that WAS watched and drew nothing is a real, quotable fact, and it must not look
    // like the day nobody watched. The gap is hatched and full height; the zero is a hairline.
    const scene = dailyEnergyChart([day(1, { kwh: 0 }), day(2, { observed: false, kwh: null })], SPEC);
    const [zero] = bars(scene.marks);
    const [gap] = gaps(scene.marks);
    expect(zero).toBeDefined();
    expect(gap).toBeDefined();
    expect(zero.h).toBeGreaterThan(0);
    expect(gap.h).toBeGreaterThan(zero.h * 10);
    expect(zero.fill).not.toBe(gap.fill);
  });

  it('labels the gap in words, because a hatch alone is a legend nobody has', () => {
    const scene = dailyEnergyChart([day(1), day(2, { observed: false, kwh: null })], SPEC);
    expect(texts(scene.marks).some((t) => /no data/i.test(t.text))).toBe(true);
  });

  it('draws one block per outage, not one per dark day', () => {
    // August 2026 has twenty unobserved days. Twenty blocks and twenty 8px labels in nine-pixel
    // bands is an unreadable smear that makes the chart look broken rather than the month. An
    // outage is one event, and merging the run before anything is drawn makes that a property
    // of the geometry rather than a rendering trick.
    const points = [
      day(1),
      day(2, { observed: false, kwh: null }),
      day(3, { observed: false, kwh: null }),
      day(4, { observed: false, kwh: null }),
      day(5),
      day(6, { observed: false, kwh: null }),
      day(7),
    ];
    const scene = dailyEnergyChart(points, SPEC);
    expect(gaps(scene.marks)).toHaveLength(2);
    expect(texts(scene.marks).filter((t) => /no data/i.test(t.text))).toHaveLength(2);
  });

  it('says how long an outage was, when it was longer than a day', () => {
    const points = [day(1), ...[2, 3, 4].map((n) => day(n, { observed: false, kwh: null })), day(5)];
    const scene = dailyEnergyChart(points, SPEC);
    expect(texts(scene.marks).some((t) => t.text === '3 days, no data')).toBe(true);
  });

  it('drops a gap label that will not fit rather than letting it overlap', () => {
    // A clipped or colliding label is worse than the hatch on its own.
    const points = Array.from({ length: 31 }, (_, i) =>
      day(i + 1, i % 2 === 1 ? { observed: false, kwh: null } : {})
    );
    const scene = dailyEnergyChart(points, SPEC);
    expect(gaps(scene.marks).length).toBeGreaterThan(10);
    expect(texts(scene.marks).filter((t) => /no data/i.test(t.text))).toHaveLength(0);
  });

  it('covers a dark day edge to edge, not just the width a bar would have had', () => {
    // Bars are inset within their slot so they do not touch. Darkness is not: the building was
    // unobserved through the spacing too, and a block drawn only as wide as a bar leaves lit
    // stripes down both sides of an outage.
    const scene = dailyEnergyChart([day(1), day(2, { observed: false, kwh: null }), day(3)], SPEC);
    const [gap] = gaps(scene.marks);
    const [firstBar] = bars(scene.marks);
    expect(gap.w).toBeGreaterThan(firstBar.w);
    // One slot wide: the bar's width plus the padding on either side of it.
    expect(gap.w).toBeCloseTo(firstBar.w / 0.68, 1);
  });

  it('draws a multi-day outage as one unbroken block', () => {
    // Three separate blocks with the inter-slot spacing showing between them would read as three
    // outages with the lights on in between.
    const points = [day(1), ...[2, 3, 4].map((n) => day(n, { observed: false, kwh: null })), day(5)];
    const scene = dailyEnergyChart(points, SPEC);
    const [gap] = gaps(scene.marks);
    const [firstBar] = bars(scene.marks);
    expect(gaps(scene.marks)).toHaveLength(1);
    expect(gap.w).toBeCloseTo((firstBar.w / 0.68) * 3, 1);
  });

  it('draws a partly observed day as a floor rather than a total', () => {
    // 2026-08-19: 0.89 kWh from 166 usable minutes. That figure is a floor, and the chart has to
    // say so — otherwise it sits on the same axis as a full day and reads as a comparison.
    const scene = dailyEnergyChart([day(1), day(2, { complete: false, kwh: 0.89 })], SPEC);
    const partial = bars(scene.marks).find((b) => b.opacity !== undefined && b.opacity < 1);
    expect(partial).toBeDefined();

    // Marked in a second channel, not merely faded: opacity is decoration, invisible in a
    // monochrome print. The cap is dashed — an unfinished bar with an unfinished top edge,
    // which is the conventional "at least this much" and needs no legend.
    const caps = lines(scene.marks).filter((l) => l.dash !== undefined);
    expect(caps).toHaveLength(1);
    expect(caps[0].y1).toBeCloseTo(partial!.y, 5);
    expect(caps[0].x1).toBeCloseTo(partial!.x, 5);
    expect(caps[0].x2).toBeCloseTo(partial!.x + partial!.w, 5);
  });

  it('leaves a fully observed bar with a solid top', () => {
    const scene = dailyEnergyChart([day(1), day(2)], SPEC);
    expect(lines(scene.marks).filter((l) => l.dash !== undefined)).toHaveLength(0);
  });

  it('anchors the axis at zero, so a bar length is its value', () => {
    const scene = dailyEnergyChart([day(1, { kwh: 14.01 }), day(2, { kwh: 14.02 })], SPEC);
    // Two nearly equal days must not become one tall bar and one short one.
    const [a, b] = bars(scene.marks);
    expect(Math.abs(a.h - b.h)).toBeLessThan(2);
  });

  it('says how many days it could not draw, in the description', () => {
    const scene = dailyEnergyChart([day(1), day(2, { observed: false, kwh: null }), day(3, { observed: false, kwh: null })], SPEC);
    expect(scene.desc).toMatch(/2 of 3/);
  });

  it('namespaces every id it mints', () => {
    const scene = dailyEnergyChart([day(1, { observed: false, kwh: null })], SPEC);
    scene.defs.forEach((d) => expect(d.id.startsWith(`${SPEC.idPrefix}-`)).toBe(true));
    scene.marks.forEach((m) => {
      const ref = m.kind === 'rect' ? m.fill : undefined;
      if (ref?.startsWith('url(')) expect(ref).toContain(`${SPEC.idPrefix}-`);
    });
  });

  it('is deterministic', () => {
    const points = [day(1), day(2, { observed: false, kwh: null }), day(3, { complete: false, kwh: 2 })];
    expect(dailyEnergyChart(points, SPEC)).toEqual(dailyEnergyChart(points, SPEC));
  });

  it('draws nothing but a message when no day was observed at all', () => {
    // A whole period of darkness must not render an empty grid with a confident axis — that
    // reads as a month of zero consumption. niceScale returns null here on purpose.
    const scene = dailyEnergyChart([day(1, { observed: false, kwh: null }), day(2, { observed: false, kwh: null })], SPEC);
    expect(bars(scene.marks)).toHaveLength(0);
    expect(texts(scene.marks).some((t) => /nothing was observed/i.test(t.text))).toBe(true);
  });

  it('survives an empty period without producing NaN geometry', () => {
    const scene = dailyEnergyChart([], SPEC);
    scene.marks.forEach((m) => {
      Object.values(m).forEach((v) => {
        if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
      });
    });
  });

  it('thins the axis labels rather than overlapping them on a long month', () => {
    const month = Array.from({ length: 31 }, (_, i) => day(i + 1));
    const scene = dailyEnergyChart(month, SPEC);
    const dayLabels = texts(scene.marks).filter((t) => /^\d+$/.test(t.text));
    expect(dayLabels.length).toBeLessThan(31);
    expect(dayLabels.length).toBeGreaterThan(4);
  });
});
