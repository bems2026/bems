import { describe, it, expect } from 'vitest';
import {
  GRID_STEP_MS,
  MAX_IMPUTE_MS,
  FROZEN_MIN_SAMPLES,
  alignToGrid,
  appendLiveTail,
  buildSeries,
  coarsen,
  detectFrozenRuns,
  gapWindows,
  imputeShortGaps,
  sumSlotSeries,
  summarizeQuality,
  type Slot,
} from './timeseries';
import type { HistoryPoint } from './types';
import { FROZEN_AFTER_MS } from '@shared/measurementFreeze.mjs';

/*
 * Every fixture below is shaped from a measurement on this building, not invented — the arrival
 * stamps, the freeze, the flicker and the restart are all from the bridge ring buffer and the
 * `readings` table read back on 2026-09-14. See ROADMAP RM-076/RM-077.
 */

const MIN = 60_000;
const BOUNDS = { power_w: { min: 0, max: 25000 }, voltage: { min: 0, max: 300 }, current: { min: 0, max: 100 } };
/** 15:00 local (+08:00) on 2026-09-13. */
const T0 = Date.parse('2026-09-13T15:00:00+08:00');
const iso = (ms: number) => new Date(ms).toISOString();
const at = (minute: number, second = 5) => iso(T0 + minute * MIN + second * 1000);
const pt = (minute: number, power_w: number, over: Partial<HistoryPoint> = {}, second = 5): HistoryPoint => ({
  ts: at(minute, second),
  power_w,
  voltage: 228 + (minute % 3) * 0.1,
  current: Math.round((power_w / 228) * 1000) / 1000,
  online: true,
  ...over,
});
const grid = (points: HistoryPoint[], slots = 10, param: 'power' | 'voltage' | 'current' = 'power') =>
  alignToGrid(points, { stepMs: MIN, startMs: T0, endMs: T0 + slots * MIN, param, bounds: BOUNDS });
const qualities = (slots: Slot[]) => slots.map((s) => s.quality);

describe('GRID_STEP_MS', () => {
  it('matches the bucket widths the stored-history RPCs already use, so a slot IS a bucket', () => {
    expect(GRID_STEP_MS).toEqual({ '24h': 60_000, '7d': 900_000, '30d': 3_600_000, '1y': 86_400_000 });
  });
});

describe('FROZEN_MIN_SAMPLES', () => {
  it("matches the bridge's own threshold, so a chart and a live reading call the same stretch frozen", () => {
    expect(FROZEN_MIN_SAMPLES * GRID_STEP_MS['24h']).toBe(FROZEN_AFTER_MS);
  });
});

describe('alignToGrid', () => {
  /*
   * The ring buffer stamps each sample with the device's ARRIVAL time, not the tick that took it.
   * These nine stamps are consecutive `mtr_lo_red` samples from 2026-09-13 — nine ticks, and
   * binning them by floor(ts / 60 s) collides two into 15:44 and two into 15:50 while inventing
   * holes at 15:46 and 15:49 that were never missing. Measured across the whole day, floor
   * binning invents 466 holes for this meter; one-sample-per-tick slotting invents none.
   */
  it('gives each bridge tick its own slot even when arrival stamps jitter, inventing no holes', () => {
    const stamps = ['15:44:01', '15:44:17', '15:45:18', '15:47:02', '15:47:16', '15:48:17', '15:50:01', '15:50:17', '15:51:18'];
    const points = stamps.map((s, i) => ({ ts: `2026-09-13T${s}+08:00`, power_w: 13 + i * 0.1, voltage: 229.4, current: 0.4, online: true }));
    const slots = alignToGrid(points, { stepMs: MIN, startMs: Date.parse('2026-09-13T15:44:00+08:00'), endMs: Date.parse('2026-09-13T15:53:00+08:00'), param: 'power', bounds: BOUNDS });
    expect(slots).toHaveLength(9);
    expect(qualities(slots).every((q) => q === 'measured')).toBe(true);
    // Order and values survive: the ninth tick's reading is in the ninth slot.
    expect(slots[8].value).toBeCloseTo(13.8, 6);
  });

  it('keeps a stretch where the bridge took no samples at all as missing — the 09-07 restart', () => {
    // Node-RED stopped at 16:25:55 and nothing was sampled until it came back.
    const points = [pt(0, 650), pt(1, 651), pt(2, 649), pt(3, 652), pt(4, 650), pt(9, 648), pt(10, 647)];
    const slots = grid(points, 11);
    expect(qualities(slots).slice(5, 9)).toEqual(['missing', 'missing', 'missing', 'missing']);
    expect(slots[9].quality).toBe('measured');
  });

  it('marks a sample the bridge called offline as offline, keeping what it carried as raw only', () => {
    const slots = grid([pt(0, 14.8), pt(1, 15.7, { online: false }), pt(2, 15.5)], 3);
    expect(slots[1]).toMatchObject({ quality: 'offline', raw: 15.7 });
    expect(slots[1].value).toBeUndefined();
  });

  it('rejects an impossible reading as an outlier and never clamps it into range', () => {
    const slots = grid([pt(0, 400), pt(1, 1_000_000_000), pt(2, Number.NaN), pt(3, -5), pt(4, 410)], 5);
    expect(qualities(slots)).toEqual(['measured', 'outlier', 'outlier', 'outlier', 'measured']);
    expect(slots[1].value).toBeUndefined();
    expect(slots[1].raw).toBe(1_000_000_000);
  });

  it('treats a parameter a point never carried as missing, not zero', () => {
    const points = [pt(0, 100), { ts: at(1), power_w: 110, online: true }];
    const volts = grid(points, 2, 'voltage');
    expect(volts[0].quality).toBe('measured');
    expect(volts[1].quality).toBe('missing');
    expect(volts[1].value).toBeUndefined();
    expect(grid(points, 2, 'power')[1].value).toBe(110);
  });

  it('sorts unordered input and keeps the newest of two identical timestamps', () => {
    const slots = grid([pt(2, 30), pt(0, 10), pt(1, 20), { ...pt(1, 21) }], 3);
    expect(slots.map((s) => s.value)).toEqual([10, 21, 30]);
  });

  /*
   * RM-079. The bridge now writes the tick that took each sample as `sample_ts`. A device that has not
   * reported for a few minutes carries the SAME arrival stamp on every sample, so without the tick
   * those samples collapse into one point; with it, each lands in its own minute.
   */
  it('uses the tick that took a sample when the bridge sends one, so the grid is exact rather than reconstructed', () => {
    const arrived = '2026-09-13T15:41:05+08:00';
    const points = [0, 1, 2].map((m) => ({ ts: arrived, sample_ts: iso(T0 + (45 + m) * MIN + 2000), power_w: 100 + m, online: true }));
    const slots = alignToGrid(points, { stepMs: MIN, startMs: T0 + 45 * MIN, endMs: T0 + 48 * MIN, param: 'power', bounds: BOUNDS });
    expect(slots.map((s) => s.value)).toEqual([100, 101, 102]);
    expect(slots[2].readingTs).toBe(arrived);
  });

  it('places a buffer that switches from arrival stamps to ticks partway without losing or doubling a sample', () => {
    const before = [pt(0, 10), pt(1, 11)];
    const after = [2, 3].map((m) => ({ ts: at(m - 1, 50), sample_ts: iso(T0 + m * MIN + 1000), power_w: 10 + m, online: true }));
    expect(grid([...before, ...after], 4).map((s) => s.value)).toEqual([10, 11, 12, 13]);
  });

  it('treats a sample the bridge flagged frozen as frozen, before any run of it is long enough to detect', () => {
    const slots = grid([pt(0, 19.1, { frozen: true }), pt(1, 20)], 2);
    expect(slots[0].quality).toBe('frozen');
    expect(slots[1].quality).toBe('measured');
  });

  it('ignores points with an unreadable timestamp rather than placing them anywhere', () => {
    const slots = grid([pt(0, 10), { ts: 'not a time', power_w: 999, online: true }, pt(1, 20)], 2);
    expect(slots.map((s) => s.value)).toEqual([10, 20]);
  });

  it("carries a stored bucket's coverage through, so a tooltip can say how much of it was measured", () => {
    const step = GRID_STEP_MS['7d'];
    const slots = alignToGrid([{ ts: iso(T0), power_w: 120, online: true, coverage: { online: 12, samples: 15 } }], {
      stepMs: step,
      startMs: T0,
      endMs: T0 + step,
      param: 'power',
      bounds: BOUNDS,
    });
    expect(slots[0].coverage).toEqual({ online: 12, samples: 15 });
  });
});

describe('detectFrozenRuns', () => {
  const run = (count: number, power_w: number, voltage: number, current: number, startMinute = 0) =>
    Array.from({ length: count }, (_, i) => ({ ts: at(startMinute + i, (i * 7) % 50), power_w, voltage, current, online: true }));

  it('finds L.O Red on 2026-09-12: 19.1 W / 228.2 V / 0.576 A held identical for fourteen hours', () => {
    const before = [pt(0, 12.9), pt(1, 13.4)];
    const frozen = run(840, 19.1, 228.2, 0.576, 2);
    const after = [pt(842, 13.3), pt(843, 13.8)];
    const found = detectFrozenRuns([...before, ...frozen, ...after]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ power_w: 19.1, voltage: 228.2, current: 0.576, samples: 840 });
    expect(found[0].fromMs).toBe(Date.parse(frozen[0].ts));
    expect(found[0].toMs).toBe(Date.parse(frozen[839].ts));
  });

  it('does not call an idle circuit frozen — L.O Yellow sat at 0 W for 690 minutes and was healthy', () => {
    expect(detectFrozenRuns(run(690, 0, 231.2, 0))).toEqual([]);
  });

  it('does not call the longest healthy identical run on record frozen — CARE ACU, 33 minutes at 16.2 W', () => {
    expect(detectFrozenRuns(run(33, 16.2, 225.6, 0.104))).toEqual([]);
    expect(FROZEN_MIN_SAMPLES).toBeGreaterThan(33);
  });

  /*
   * Found on live data after the first deploy, 2026-09-14. A one-hour rule — sized on the four meters
   * alone — flagged co1 (106.8 W, 08:59 to 09:58) and co7 as frozen. They were not: the outlets refresh
   * power, voltage and current about once an hour, and co1's own `add_ele` counter advanced at 09:27 and
   * 09:57 inside that very hour. Over seven days co1 held an identical tuple for 60 minutes or more
   * nineteen times, never 120. The meter faults were 540, 657 and 942 minutes.
   */
  it("does not call an outlet's hourly refresh frozen — co1 held 61 minutes and was metering throughout", () => {
    expect(detectFrozenRuns(run(61, 106.8, 224.4, 0.505))).toEqual([]);
    expect(detectFrozenRuns(run(120, 106.8, 224.4, 0.505))).toEqual([]);
  });

  it('still finds three hours held identical, which no healthy device here has ever produced', () => {
    expect(detectFrozenRuns(run(180, 19.1, 228.2, 0.576))).toHaveLength(1);
  });

  it('does not call an offline stretch a freeze — that is already a different, louder fact', () => {
    const offline = run(240, 19.1, 228.2, 0.576).map((p) => ({ ...p, online: false }));
    expect(detectFrozenRuns(offline)).toEqual([]);
  });

  it('needs the voltage to be held too, since a live mains reading moves', () => {
    const drifting = run(240, 19.1, 228.2, 0.576).map((p, i) => ({ ...p, voltage: 228.2 + (i % 2) * 0.1 }));
    expect(detectFrozenRuns(drifting)).toEqual([]);
  });

  /*
   * RM-134, 2026-09-22. L.O Yellow held 39.8 W / 0.446 A from 07:43 to 14:20 — the lights had gone off
   * during a reboot and nothing re-read the meter — and the page found nothing: the longest identical
   * run in the ring was 164 samples. Three things split it, and none of them was the meter measuring.
   */
  it('carries a held reading through an offline blip — a value that survives a reconnect is still held', () => {
    const held = [...run(100, 39.8, 226.7, 0.446), { ...run(1, 39.8, 226.7, 0.446, 100)[0], online: false }, ...run(100, 39.8, 226.7, 0.446, 101)];
    const found = detectFrozenRuns(held);
    expect(found).toHaveLength(1);
    expect(found[0].samples).toBe(200);
  });

  it('keys a channel whose voltage is shared on its own power and current, so the other clamp\'s mains reading cannot split it', () => {
    // The dual-channel meter measures ONE voltage for both clamps; channel 2's voltage dp followed
    // channel 1's for part of the hold (RM-133). On a single-channel device the default still needs it held.
    const shared = run(240, 39.8, 226.7, 0.446).map((p, i) => ({ ...p, voltage: 213 + (i % 7) * 0.4 }));
    expect(detectFrozenRuns(shared)).toEqual([]);
    const found = detectFrozenRuns(shared, { sharedVoltage: true });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ power_w: 39.8, current: 0.446, samples: 240 });
  });

  it('does not trust a flag on a run shorter than the bridge\'s shortest rule — the 15:38 lights-on (RM-136)', () => {
    // The bridge flagged the first two loaded samples after hours at 0 W (its register clock had been
    // running while the circuit drew nothing). A true flag needs the register still for half an hour first,
    // so it can never sit on a two-minute run of identical readings.
    const blip = [...run(4, 0, 214.2, 0), ...run(2, 41.9, 228.7, 0.427, 4).map((p) => ({ ...p, frozen: true })), ...run(2, 41.2, 228, 0.421, 6)];
    expect(detectFrozenRuns(blip, { sharedVoltage: true })).toEqual([]);
  });

  it('honours the bridge\'s own flag: a run of half an hour or more that holds a flagged sample is frozen', () => {
    // The bridge flags from its own rules (three hours of v/c/p, or a register still for 30 minutes
    // while owed energy). A run it has already called frozen is not the page's to un-call.
    const flagged = run(40, 39.8, 214.2, 0.446).map((p, i) => (i >= 30 ? { ...p, frozen: true } : p));
    const found = detectFrozenRuns(flagged);
    expect(found).toHaveLength(1);
    expect(found[0].samples).toBe(40);
    expect(detectFrozenRuns(run(40, 39.8, 214.2, 0.446))).toEqual([]);
  });
});

describe('imputeShortGaps', () => {
  it("bridges CARE ACU's one-sample health flicker at 12:46 and keeps what the device carried", () => {
    // 14.8 W, then a sample marked offline carrying 15.7, then 15.5 — a flag flicker, not an outage.
    const slots = imputeShortGaps(grid([pt(0, 14.8), pt(1, 15.7, { online: false }), pt(2, 15.5)], 3), MIN);
    expect(slots[1].quality).toBe('interpolated');
    expect(slots[1].value).toBeCloseTo(15.15, 6);
    expect(slots[1].raw).toBe(15.7);
    expect(slots[1].imputedFrom).toBe('offline');
  });

  it('bridges two missing minutes and refuses three', () => {
    const two = imputeShortGaps(grid([pt(0, 100), pt(3, 130)], 4), MIN);
    expect(qualities(two)).toEqual(['measured', 'interpolated', 'interpolated', 'measured']);
    expect(two.map((s) => s.value)).toEqual([100, 110, 120, 130]);

    const three = imputeShortGaps(grid([pt(0, 100), pt(4, 140)], 5), MIN);
    expect(qualities(three)).toEqual(['measured', 'missing', 'missing', 'missing', 'measured']);
  });

  it('never bridges a gap that has no reading on one side', () => {
    const slots = imputeShortGaps(grid([pt(0, 100), pt(1, 110)], 3), MIN);
    expect(slots[2].quality).toBe('missing');
  });

  it('does not bridge into a frozen stretch — a held value is not a measurement to interpolate from', () => {
    const frozen: Slot = { t: T0 + 2 * MIN, raw: 19.1, value: 19.1, quality: 'frozen' };
    const slots = imputeShortGaps([{ t: T0, value: 13, raw: 13, quality: 'measured' }, { t: T0 + MIN, quality: 'missing' }, frozen], MIN);
    expect(slots[1].quality).toBe('missing');
  });

  it('bridges by TIME, not slot count: nothing is imputed on a 15-minute grid', () => {
    const step = GRID_STEP_MS['7d'];
    const slots: Slot[] = [
      { t: 0, value: 100, quality: 'measured' },
      { t: step, quality: 'missing' },
      { t: 2 * step, value: 120, quality: 'measured' },
    ];
    expect(MAX_IMPUTE_MS).toBe(2 * MIN);
    expect(imputeShortGaps(slots, step)[1].quality).toBe('missing');
  });
});

describe('gapWindows', () => {
  it('reports the restart as one window, so the chart can say what the gap is', () => {
    const slots = imputeShortGaps(grid([pt(0, 650), pt(1, 651), pt(6, 648), pt(7, 647)], 8), MIN);
    expect(gapWindows(slots, MIN)).toEqual([{ fromMs: T0 + 2 * MIN, toMs: T0 + 6 * MIN, kind: 'missing', slots: 4 }]);
  });

  it('calls a window offline when the bridge sampled it and said so', () => {
    const points = [pt(0, 5), ...[1, 2, 3].map((m) => pt(m, 5, { online: false })), pt(4, 5)];
    expect(gapWindows(imputeShortGaps(grid(points, 5), MIN), MIN)).toEqual([{ fromMs: T0 + MIN, toMs: T0 + 4 * MIN, kind: 'offline', slots: 3 }]);
  });

  it('reports nothing for a gap that was short enough to bridge', () => {
    const slots = imputeShortGaps(grid([pt(0, 100), pt(2, 120)], 3), MIN);
    expect(gapWindows(slots, MIN)).toEqual([]);
  });
});

describe('coarsen', () => {
  const s = (i: number, quality: Slot['quality'], value?: number): Slot => ({ t: T0 + i * MIN, quality, value, raw: value });

  it('averages only what was measured or bridged, and says how many samples that was', () => {
    const out = coarsen([s(0, 'measured', 10), s(1, 'offline'), s(2, 'measured', 20), s(3, 'frozen', 99)], 4);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ t: T0, value: 15, quality: 'measured', samples: 2 });
  });

  it('keeps a bucket with nothing measured as a gap, naming the most serious reason', () => {
    const gap = coarsen([s(0, 'missing'), s(1, 'offline')], 2)[0];
    expect(gap.quality).toBe('offline');
    expect(gap.value).toBeUndefined();
    expect(coarsen([s(0, 'offline'), s(1, 'frozen', 19.1)], 2)[0]).toMatchObject({ quality: 'frozen' });
  });

  it('marks a bucket interpolated only when more of it was bridged than measured', () => {
    expect(coarsen([s(0, 'measured', 10), s(1, 'interpolated', 12), s(2, 'measured', 14)], 3)[0].quality).toBe('measured');
    expect(coarsen([s(0, 'interpolated', 10), s(1, 'interpolated', 12), s(2, 'measured', 14)], 3)[0].quality).toBe('interpolated');
  });
});

describe('sumSlotSeries', () => {
  /*
   * The defect this replaces: `sumHistories` and `buildChartRows` paired devices BY ARRAY INDEX,
   * so a device with one fewer sample (1,439 against 1,440 on 2026-09-14) was added to its
   * neighbour's reading from a different minute for the whole day.
   */
  it('adds devices minute to minute, not array position to array position', () => {
    const a = grid(Array.from({ length: 10 }, (_, m) => pt(m, 100 + m)), 10);
    const b = grid(Array.from({ length: 9 }, (_, i) => pt(i + 1, 1000 + i + 1)), 10);
    const sum = sumSlotSeries([a, b]);
    expect(sum[0].quality).toBe('missing');
    expect(sum[0].value).toBeUndefined();
    expect(sum[5].value).toBe(105 + 1005);
  });

  it('leaves a gap where any contributor was offline, rather than adding a held number', () => {
    const a = grid([pt(0, 900), pt(1, 910)], 2);
    const b: Slot[] = [
      { t: T0, quality: 'offline', raw: 513.9 },
      { t: T0 + MIN, quality: 'measured', raw: 20, value: 20 },
    ];
    expect(sumSlotSeries([a, b]).map((x) => [x.quality, x.value])).toEqual([
      ['offline', undefined],
      ['measured', 930],
    ]);
  });

  /*
   * Found in the browser on 2026-09-14, against the mock's `--faults=frozen`: Overview's Energy Flow
   * summed four meters, one of them frozen for ninety minutes, and drew those ninety minutes as a
   * blank with no band — the unexplained blank this work exists to remove. A frozen stretch in a sum
   * is drawn the way a frozen stretch on one device is: marked frozen, carrying the held figure, muted.
   */
  it('marks a sum frozen, carrying the held figure, when a contributor froze — so it is drawn muted, not blank', () => {
    const a = grid([pt(0, 900)], 1);
    const b: Slot[] = [{ t: T0, quality: 'frozen', raw: 19.1, value: 19.1 }];
    expect(sumSlotSeries([a, b])[0]).toMatchObject({ quality: 'frozen', value: 919.1 });
  });

  it('still leaves a gap, named offline, when one contributor froze and another was offline', () => {
    const a: Slot[] = [{ t: T0, quality: 'offline' }];
    const b: Slot[] = [{ t: T0, quality: 'frozen', raw: 19.1, value: 19.1 }];
    const sum = sumSlotSeries([a, b])[0];
    expect(sum.quality).toBe('offline');
    expect(sum.value).toBeUndefined();
  });

  it('carries interpolation through, so a summed line admits it was partly bridged', () => {
    const a: Slot[] = [{ t: T0, quality: 'interpolated', value: 10 }];
    const b: Slot[] = [{ t: T0, quality: 'measured', value: 5 }];
    expect(sumSlotSeries([a, b])[0]).toMatchObject({ quality: 'interpolated', value: 15 });
  });

  it('is empty for no series', () => {
    expect(sumSlotSeries([])).toEqual([]);
  });
});

describe('appendLiveTail', () => {
  const base = () => grid([pt(0, 100), pt(1, 101), pt(2, 102)], 4);

  it('puts the live reading into its own minute so the chart ends where the tiles are', () => {
    const slots = appendLiveTail(base(), { ts: at(3, 30), value: 140, online: true }, MIN);
    expect(slots[3]).toMatchObject({ quality: 'live', value: 140, raw: 140 });
    expect(slots[2].quality).toBe('measured');
  });

  it('ignores a live reading the bridge calls offline, or one with no value', () => {
    expect(appendLiveTail(base(), { ts: at(3, 30), value: 140, online: false }, MIN)[3].quality).toBe('missing');
    expect(appendLiveTail(base(), { ts: at(3, 30), value: undefined, online: true }, MIN)[3].quality).toBe('missing');
  });

  it('draws a live reading the bridge calls frozen as frozen, not as live', () => {
    const slots = appendLiveTail(base(), { ts: at(3, 30), value: 19.1, online: true, frozen: true }, MIN);
    expect(slots[3]).toMatchObject({ quality: 'frozen', value: 19.1 });
  });

  it('never replaces a stored sample newer than the live one', () => {
    const slots = appendLiveTail(base(), { ts: at(1, 0), value: 999, online: true }, MIN);
    expect(slots.map((s) => s.value)).toEqual([100, 101, 102, undefined]);
  });
});

describe('buildSeries', () => {
  it('runs the whole pipeline: align, flag the freeze, bridge the flicker, and report both', () => {
    const points = [
      pt(0, 14.8),
      pt(1, 15.7, { online: false }),
      pt(2, 15.5),
      ...Array.from({ length: 200 }, (_, i) => ({ ts: at(3 + i), power_w: 19.1, voltage: 228.2, current: 0.576, online: true })),
      pt(203, 12),
    ];
    const { slots, frozen } = buildSeries(points, { stepMs: MIN, startMs: T0, endMs: T0 + 204 * MIN, param: 'power', bounds: BOUNDS, detectFrozen: true });
    expect(frozen).toHaveLength(1);
    expect(slots[1].quality).toBe('interpolated');
    expect(slots[10].quality).toBe('frozen');
    expect(slots[203].quality).toBe('measured');
    expect(summarizeQuality(slots)).toMatchObject({ measured: 3, interpolated: 1, frozen: 200 });
  });

  it('bridges up to a live tail, so the line reaches the live reading instead of stopping short', () => {
    const { slots } = buildSeries([pt(0, 100), pt(1, 110)], {
      stepMs: MIN,
      startMs: T0,
      endMs: T0 + 4 * MIN,
      param: 'power',
      bounds: BOUNDS,
      live: { ts: at(3, 30), value: 130, online: true },
    });
    expect(qualities(slots)).toEqual(['measured', 'measured', 'interpolated', 'live']);
    expect(slots[2].value).toBe(120);
  });
});
