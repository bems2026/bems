import { describe, it, expect } from 'vitest';
import { isReadingStale, isReadingExpired, measured } from './staleness';
import type { Reading, Totals } from './types';

const now = 1_786_000_000_000;
const fresh = new Date(now - 1000).toISOString();
const old = new Date(now - 31_000).toISOString();

describe('isReadingStale', () => {
  it('is stale when there is no reading yet', () => {
    expect(isReadingStale(null, now)).toBe(true);
    expect(isReadingStale(undefined, now)).toBe(true);
  });

  it('is stale when the bridge reports the device offline, even with a fresh timestamp', () => {
    const r: Reading = { device_id: 'co3', ts: fresh, online: false, state: 'off' };
    expect(isReadingStale(r, now)).toBe(true);
  });

  it('is not stale when online and recently updated', () => {
    const r: Reading = { device_id: 'co3', ts: fresh, online: true, state: 'on' };
    expect(isReadingStale(r, now)).toBe(false);
  });

  it('is stale when online but the timestamp stopped advancing 30s+ ago', () => {
    const r: Reading = { device_id: 'co3', ts: old, online: true, state: 'on' };
    expect(isReadingStale(r, now)).toBe(true);
  });

  it('checks only the timestamp for the _totals row, which has no online field', () => {
    const freshTotals: Totals = {
      device_id: '_totals',
      ts: fresh,
      energy_kwh_today: 1,
      energy_kwh_week: 1,
      energy_kwh_month: 1,
      total_power_w: 1,
      avg_voltage: 220,
      phase_current: { red: 1, yellow: 1, blue: null },
    };
    const staleTotals: Totals = { ...freshTotals, ts: old };
    expect(isReadingStale(freshTotals, now)).toBe(false);
    expect(isReadingStale(staleTotals, now)).toBe(true);
  });
});

/**
 * Regression: outlets observed on site 2026-08-24 carrying a four-day-old voltage under a
 * timestamp stamped minutes earlier. The Outlet tab's parser refreshes `_last_time` on the
 * device's *connection* event while leaving the measurements untouched, so `online` stays
 * true, `ts` looks recent, and the numbers are memories. `isReadingStale` dims them;
 * nothing stopped them being rendered as figures.
 */
describe('isReadingExpired', () => {
  const minutes = (n: number) => new Date(now - n * 60_000).toISOString();

  it('has not expired while the reading is merely stale', () => {
    const r: Reading = { device_id: 'co1', ts: old, online: true, voltage: 235.9, state: 'off' };
    expect(isReadingStale(r, now)).toBe(true);
    expect(isReadingExpired(r, now)).toBe(false);
  });

  it('expires a reading whose timestamp stopped advancing long ago', () => {
    const r: Reading = { device_id: 'co1', ts: minutes(15), online: true, voltage: 235.9, state: 'off' };
    expect(isReadingExpired(r, now)).toBe(true);
  });

  it('expires a missing reading', () => {
    expect(isReadingExpired(null, now)).toBe(true);
    expect(isReadingExpired(undefined, now)).toBe(true);
  });

  it('does not expire on `online: false` alone — an offline device that reported a second ago still has a real last reading', () => {
    const r: Reading = { device_id: 'co1', ts: fresh, online: false, voltage: 224.9, state: 'off' };
    expect(isReadingExpired(r, now)).toBe(false);
  });
});

describe('measured', () => {
  const minutes = (n: number) => new Date(now - n * 60_000).toISOString();

  it('passes the value through while the reading is still a measurement', () => {
    const r: Reading = { device_id: 'co1', ts: fresh, online: true, voltage: 224.9, state: 'off' };
    expect(measured(r.voltage, r, now)).toBe(224.9);
  });

  it('withholds the value once the reading has expired, so it formats as — and not as a figure', () => {
    const r: Reading = { device_id: 'co1', ts: minutes(15), online: true, voltage: 235.9, state: 'off' };
    expect(measured(r.voltage, r, now)).toBeUndefined();
  });

  it('withholds a zero just as readily as a number — a stale 0 W is the exact reading that looks idle', () => {
    const r: Reading = { device_id: 'co1', ts: minutes(15), online: true, power_w: 0, state: 'off' };
    expect(measured(r.power_w, r, now)).toBeUndefined();
  });
});
