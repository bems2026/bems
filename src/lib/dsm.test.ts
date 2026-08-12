import { describe, it, expect } from 'vitest';
import { readDsmThresholds, checkDsmBreach, maxPhaseNow, totalKwNow } from './dsm';
import type { Totals } from './types';

const totals = (over: Partial<Totals> = {}): Totals => ({
  device_id: '_totals',
  ts: new Date().toISOString(),
  energy_kwh_today: null,
  energy_kwh_week: null,
  energy_kwh_month: null,
  total_power_w: 5000,
  avg_voltage: 220,
  phase_current: { red: 10, yellow: 10, blue: null },
  ...over,
});

describe('readDsmThresholds', () => {
  it('parses unset keys as null, not a fabricated 0', () => {
    expect(readDsmThresholds({})).toEqual({ maxPhaseA: null, maxTotalKw: null, autoShed: false });
  });

  it('parses real string values written by the context store', () => {
    expect(readDsmThresholds({ 'global.dsm.max_phase_a': '22', 'global.dsm.max_total_kw': '9', 'global.dsm.auto_shed': 'true' })).toEqual({
      maxPhaseA: 22,
      maxTotalKw: 9,
      autoShed: true,
    });
  });

  it('a non-numeric value parses to null rather than NaN', () => {
    expect(readDsmThresholds({ 'global.dsm.max_phase_a': 'not-a-number' }).maxPhaseA).toBeNull();
  });
});

describe('checkDsmBreach', () => {
  it('never breaches when no threshold is configured, even under a huge real reading', () => {
    const r = checkDsmBreach({ maxPhaseA: null, maxTotalKw: null, autoShed: false }, totals({ phase_current: { red: 99, yellow: 99, blue: null } }));
    expect(r.breached).toBe(false);
  });

  it('never breaches when there is no _totals reading yet', () => {
    const r = checkDsmBreach({ maxPhaseA: 5, maxTotalKw: 1, autoShed: false }, null);
    expect(r.breached).toBe(false);
  });

  it('breaches on the heavier of the two real phases exceeding the configured max current', () => {
    const r = checkDsmBreach({ maxPhaseA: 15, maxTotalKw: null, autoShed: false }, totals({ phase_current: { red: 20, yellow: 8, blue: null } }));
    expect(r.breached).toBe(true);
    expect(r.reason).toMatch(/20\.0 A/);
  });

  it('does not breach when both phases sit under the configured max', () => {
    const r = checkDsmBreach({ maxPhaseA: 15, maxTotalKw: null, autoShed: false }, totals({ phase_current: { red: 10, yellow: 12, blue: null } }));
    expect(r.breached).toBe(false);
  });

  it('breaches on total draw exceeding the configured max kW', () => {
    const r = checkDsmBreach({ maxPhaseA: null, maxTotalKw: 4, autoShed: false }, totals({ total_power_w: 5000 }));
    expect(r.breached).toBe(true);
    expect(r.reason).toMatch(/5\.00 kW/);
  });

  it('does not breach exactly at the threshold — only strictly over', () => {
    const r = checkDsmBreach({ maxPhaseA: 10, maxTotalKw: null, autoShed: false }, totals({ phase_current: { red: 10, yellow: 10, blue: null } }));
    expect(r.breached).toBe(false);
  });
});

describe('maxPhaseNow / totalKwNow', () => {
  it('null with no _totals reading', () => {
    expect(maxPhaseNow(null)).toBeNull();
    expect(totalKwNow(null)).toBeNull();
  });

  it('the heavier of red/yellow, never blue', () => {
    expect(maxPhaseNow(totals({ phase_current: { red: 4, yellow: 9, blue: null } }))).toBe(9);
  });

  it('total_power_w converted to kW', () => {
    expect(totalKwNow(totals({ total_power_w: 4200 }))).toBeCloseTo(4.2);
  });
});
