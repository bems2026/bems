import { describe, it, expect } from 'vitest';
import { BUILDING_METER_IDS } from '@shared/registry.mjs';
import { branchEnergySplit, describeFrozen, siteDayStartMs } from './branchEnergy';
import type { Device, HistoryPoint, Reading } from './types';

/*
 * RM-077 and RM-078. The fixtures are L.O Red's own readings from the `readings` table, read back
 * on 2026-09-14 — see ROADMAP §0 for the day-by-day table they come from.
 */

const MIN = 60_000;
const local = (s: string) => Date.parse(`${s}+08:00`);

const device = (id: string, name: string, cls: Device['class'] = 'meter'): Device => ({ id, display_name: name, class: cls, room: null, dps_map: 'type_a', status: 'active' });
const DEVICES: Device[] = [
  device('mtr_co_yellow', 'C.O Yellow'),
  device('mtr_lo_red', 'L.O Red'),
  device('mtr_arec_acu', 'CARE ACU'),
  device('mtr_lo_yellow', 'L.O Yellow'),
];

const reading = (id: string, kwh: number | undefined, over: Partial<Reading> = {}, ts = new Date().toISOString()): Reading => ({
  device_id: id,
  ts,
  online: true,
  state: null,
  ...(kwh === undefined ? {} : { energy_kwh_today: kwh }),
  ...over,
});

/** One sample a minute from `fromLocal` for `minutes`, each built by `at(i)`. */
function samples(fromLocal: string, minutes: number, at: (i: number) => Partial<HistoryPoint>): HistoryPoint[] {
  const start = local(fromLocal);
  return Array.from({ length: minutes }, (_, i) => ({
    ts: new Date(start + i * MIN + 5000).toISOString(),
    power_w: 0,
    online: true,
    ...at(i),
  }));
}
const live = (i: number, watts: number) => ({ power_w: watts + ((i % 5) - 2) * 0.1, voltage: 226 + (i % 7) * 0.3, current: watts / 226 });
const held = { power_w: 19.1, voltage: 228.2, current: 0.576 };

describe('siteDayStartMs', () => {
  it("is the building's local midnight, not the reader's", () => {
    expect(siteDayStartMs(local('2026-09-12T22:00:00'))).toBe(local('2026-09-12T00:00:00'));
    expect(siteDayStartMs(local('2026-09-13T00:00:30'))).toBe(local('2026-09-13T00:00:00'));
  });
});

describe('branchEnergySplit — a meter that froze is not a meter that lost energy', () => {
  /*
   * 2026-09-12, L.O Red. 06:00 to 20:59 its power, voltage and current repeated 19.1 W / 228.2 V /
   * 0.576 A exactly, while its own daily AND lifetime registers both moved 0.007 kWh. The legacy
   * integrator multiplied the held 19.1 W by fifteen hours. The page said "0.00 kWh against 0.30 kWh
   * of its own power (100 % missing) … energy going missing between the meter and this page". It was
   * not: the bridge published exactly what the meter's register said.
   */
  const sept12 = () => {
    const now = local('2026-09-12T22:00:00');
    const history: Record<string, HistoryPoint[]> = {
      mtr_lo_red: [
        ...samples('2026-09-12T00:00:00', 360, (i) => ({ power_w: 0, voltage: 227 + (i % 9) * 0.2, current: 0 })),
        ...samples('2026-09-12T06:00:00', 900, () => held),
        ...samples('2026-09-12T21:00:00', 60, (i) => live(i, 13.3)),
      ],
    };
    const readings = { mtr_lo_red: reading('mtr_lo_red', 0.008, { energy_kwh_today_integrated: 0.3 }, new Date(now - 30_000).toISOString()) };
    return branchEnergySplit({ devices: DEVICES, readings, totals: null, historyByDevice: history, period: 'today', nowMs: now });
  };

  it('does not report the frozen stretch as energy missing between the meter and the page', () => {
    expect(sept12().shortfalls).toEqual([]);
  });

  it('names the freeze instead, with when it started and stopped and what it repeated', () => {
    const { frozen } = sept12();
    expect(frozen).toHaveLength(1);
    expect(frozen[0]).toMatchObject({ id: 'mtr_lo_red', name: 'L.O Red', heldW: 19.1, heldV: 228.2, ongoing: false });
    expect(frozen[0].fromMs).toBe(local('2026-09-12T06:00:05'));
    expect(frozen[0].toMs).toBe(local('2026-09-12T20:59:05'));
    // What the integrator counted from a number that was not being measured.
    expect(frozen[0].phantomKwh).toBeCloseTo((19.1 * 899) / 60 / 1000, 4);
  });

  it('still names a real shortfall — RM-056, where nothing froze and the bridge was losing energy', () => {
    const now = local('2026-09-08T13:32:00');
    const readings = {
      mtr_arec_acu: reading('mtr_arec_acu', 2.652, { energy_kwh_today_integrated: 2.993 }, new Date(now).toISOString()),
      mtr_co_yellow: reading('mtr_co_yellow', 1.653, { energy_kwh_today_integrated: 1.656 }, new Date(now).toISOString()),
    };
    const history = {
      mtr_arec_acu: samples('2026-09-08T12:00:00', 90, (i) => live(i, 700)),
    };
    const split = branchEnergySplit({ devices: DEVICES, readings, totals: null, historyByDevice: history, period: 'today', nowMs: now });
    expect(split.frozen).toEqual([]);
    expect(split.shortfalls.map((s) => s.id)).toEqual(['mtr_arec_acu']);
  });

  it('counts a freeze that is still going on up to now, and says it is ongoing', () => {
    // 2026-09-13, 00:00 onward: 13.3 W held, register at 0. Read at 08:53 the same morning.
    const now = local('2026-09-13T08:53:30');
    const history = { mtr_lo_red: samples('2026-09-13T00:00:00', 533, () => ({ power_w: 13.3, voltage: 229.4, current: 0.416 })) };
    const readings = { mtr_lo_red: reading('mtr_lo_red', 0, { energy_kwh_today_integrated: 0.118 }, new Date(now - 20_000).toISOString()) };
    const split = branchEnergySplit({ devices: DEVICES, readings, totals: null, historyByDevice: history, period: 'today', nowMs: now });
    expect(split.frozen[0]).toMatchObject({ ongoing: true, heldW: 13.3 });
    expect(split.frozen[0].phantomKwh).toBeCloseTo((13.3 * (now - local('2026-09-13T00:00:05'))) / 3.6e9, 4);
    expect(split.shortfalls).toEqual([]);
  });

  /*
   * RM-079 — the bridge flags a freeze on the reading itself, so a card can name it without the 24h
   * history loaded, and withholds the integrated figure while it holds.
   */
  it('names a freeze the bridge flags even when no history is loaded to find it in', () => {
    const now = local('2026-09-12T20:00:00');
    const readings = {
      mtr_lo_red: reading(
        'mtr_lo_red',
        0.008,
        { power_w: 19.1, voltage: 228.2, measurement_frozen: true, frozen_since: '2026-09-12T06:00:05+08:00' },
        new Date(now - 20_000).toISOString(),
      ),
    };
    const split = branchEnergySplit({ devices: DEVICES, readings, totals: null, historyByDevice: {}, period: 'today', nowMs: now });
    expect(split.frozen).toHaveLength(1);
    expect(split.frozen[0]).toMatchObject({ id: 'mtr_lo_red', ongoing: true, heldW: 19.1, heldV: 228.2, fromMs: local('2026-09-12T06:00:05'), toMs: now });
    expect(split.shortfalls).toEqual([]);
  });

  it('does not name one freeze twice when both its history and the bridge see it', () => {
    const now = local('2026-09-12T21:00:30');
    const history = { mtr_lo_red: samples('2026-09-12T06:00:00', 900, () => held) };
    const readings = {
      mtr_lo_red: reading('mtr_lo_red', 0.008, { power_w: 19.1, voltage: 228.2, measurement_frozen: true, frozen_since: '2026-09-12T06:00:05+08:00' }, new Date(now - 20_000).toISOString()),
    };
    const split = branchEnergySplit({ devices: DEVICES, readings, totals: null, historyByDevice: history, period: 'today', nowMs: now });
    expect(split.frozen).toHaveLength(1);
  });

  it('does not count the part of a freeze that fell before local midnight against today', () => {
    const now = local('2026-09-13T03:00:00');
    const history = {
      mtr_lo_red: [
        ...samples('2026-09-12T22:00:00', 240, () => held),
        ...samples('2026-09-13T02:00:00', 60, (i) => live(i, 13)),
      ],
    };
    const split = branchEnergySplit({ devices: DEVICES, readings: { mtr_lo_red: reading('mtr_lo_red', 0.01) }, totals: null, historyByDevice: history, period: 'today', nowMs: now });
    expect(split.frozen[0].phantomKwh).toBeCloseTo((19.1 * (local('2026-09-13T01:59:05') - local('2026-09-13T00:00:00'))) / 3.6e9, 4);
  });
});

describe('branchEnergySplit — one derivation for Overview and Analytics', () => {
  it('splits the building meters the bridge sums, whatever else is class meter', () => {
    const devices = [...DEVICES, device('mtr_submeter', 'A future sub-meter')];
    const readings = Object.fromEntries([...devices.map((d) => [d.id, reading(d.id, 1)])]);
    const split = branchEnergySplit({ devices, readings, totals: null, historyByDevice: {}, period: 'today', nowMs: Date.now() });
    expect(split.rows.map((r) => r.id).sort()).toEqual([...BUILDING_METER_IDS].sort());
  });

  it('rounds the branch total exactly as the bridge rounds the building total', () => {
    const readings = {
      mtr_co_yellow: reading('mtr_co_yellow', 0.1),
      mtr_lo_red: reading('mtr_lo_red', 0.2),
      mtr_arec_acu: reading('mtr_arec_acu', 0.3),
      mtr_lo_yellow: reading('mtr_lo_yellow', 0),
    };
    const split = branchEnergySplit({ devices: DEVICES, readings, totals: null, historyByDevice: {}, period: 'today', nowMs: Date.now() });
    // `shared/buildLatest.mjs` branchSum: Math.round(sum * 1000) / 1000.
    expect(split.totalKwh).toBe(Math.round((0.1 + 0.2 + 0.3 + 0) * 1000) / 1000);
    expect(split.totalKwh).toBe(0.6);
  });

  it('orders largest first and computes each share against the rounded total', () => {
    const readings = { mtr_co_yellow: reading('mtr_co_yellow', 3), mtr_lo_red: reading('mtr_lo_red', 1) };
    const split = branchEnergySplit({ devices: DEVICES, readings, totals: null, historyByDevice: {}, period: 'today', nowMs: Date.now() });
    expect(split.rows.map((r) => [r.name, r.share])).toEqual([
      ['C.O Yellow', 75],
      ['L.O Red', 25],
    ]);
  });

  it('keeps a branch whose reading has expired, because a register is still a count, and marks it stale', () => {
    const now = Date.now();
    const readings = { mtr_lo_red: reading('mtr_lo_red', 0.2, {}, new Date(now - 20 * MIN).toISOString()) };
    const split = branchEnergySplit({ devices: DEVICES, readings, totals: null, historyByDevice: {}, period: 'today', nowMs: now });
    expect(split.rows[0]).toMatchObject({ id: 'mtr_lo_red', kwh: 0.2, stale: true });
  });

  it('has no total rather than a zero one when no branch has a figure', () => {
    const split = branchEnergySplit({ devices: DEVICES, readings: {}, totals: null, historyByDevice: {}, period: 'week', nowMs: Date.now() });
    expect(split.rows).toEqual([]);
    expect(split.totalKwh).toBeNull();
  });
});

describe('describeFrozen', () => {
  it('says what froze and that the energy in that window was not measured, and accuses nobody', () => {
    const text = describeFrozen({
      id: 'mtr_lo_red',
      name: 'L.O Red',
      fromMs: local('2026-09-12T06:00:05'),
      toMs: local('2026-09-12T20:59:05'),
      ongoing: false,
      heldW: 19.1,
      heldV: 228.2,
      phantomKwh: 0.286,
    });
    expect(text).toContain('L.O Red');
    expect(text).toContain('06:00');
    expect(text).toContain('20:59');
    expect(text).toContain('19.1 W');
    expect(text).toContain('14 h 59 min');
    expect(text).toMatch(/not measured/);
    expect(text).not.toMatch(/missing between the meter and this page/);
  });

  it('describes an ongoing freeze in the present tense', () => {
    const text = describeFrozen({ id: 'a', name: 'L.O Red', fromMs: local('2026-09-13T00:00:05'), toMs: local('2026-09-13T08:53:05'), ongoing: true, heldW: 13.3, phantomKwh: 0.118 });
    expect(text).toMatch(/since 00:00/);
    expect(text).toContain('8 h 53 min');
  });
});
