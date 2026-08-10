import { describe, it, expect } from 'vitest';
import { isReadingStale } from './staleness';
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
