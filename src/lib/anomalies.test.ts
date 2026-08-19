import { describe, it, expect } from 'vitest';
import { latestAnomalyPerDevice, isAnomalyCurrent, ANOMALY_RECENT_MS } from './anomalies';
import type { AnomalyRow } from './supabaseAnomalies';

const row = (overrides: Partial<AnomalyRow>): AnomalyRow => ({
  device_id: 'co3', ts: '2026-08-19T09:00:00Z', metric: 'power_w', value: 400,
  baseline_mean: 100, baseline_stddev: 10, z_score: 30, iqr_lower: 70, iqr_upper: 130,
  method: 'both', sample_count: 20, ...overrides,
});

describe('latestAnomalyPerDevice', () => {
  it('keeps only the most recent row per device', () => {
    const rows = [
      row({ device_id: 'co3', ts: '2026-08-19T09:00:00Z', value: 400 }),
      row({ device_id: 'co3', ts: '2026-08-19T09:05:00Z', value: 420 }),
      row({ device_id: 'mtr_lo_red', ts: '2026-08-19T09:02:00Z', value: 90 }),
    ];
    const latest = latestAnomalyPerDevice(rows);
    expect(Object.keys(latest).sort()).toEqual(['co3', 'mtr_lo_red']);
    expect(latest.co3.value).toBe(420);
    expect(latest.mtr_lo_red.value).toBe(90);
  });

  it('does not depend on input order', () => {
    const rows = [
      row({ device_id: 'co3', ts: '2026-08-19T09:05:00Z', value: 420 }),
      row({ device_id: 'co3', ts: '2026-08-19T09:00:00Z', value: 400 }),
    ];
    expect(latestAnomalyPerDevice(rows).co3.value).toBe(420);
  });

  it('returns an empty object for no rows', () => {
    expect(latestAnomalyPerDevice([])).toEqual({});
  });
});

describe('isAnomalyCurrent', () => {
  const now = Date.parse('2026-08-19T09:10:00Z');

  it('is current just inside the recency window', () => {
    const r = row({ ts: new Date(now - (ANOMALY_RECENT_MS - 1000)).toISOString() });
    expect(isAnomalyCurrent(r, now)).toBe(true);
  });

  it('is not current once the recency window has elapsed', () => {
    const r = row({ ts: new Date(now - (ANOMALY_RECENT_MS + 1000)).toISOString() });
    expect(isAnomalyCurrent(r, now)).toBe(false);
  });
});
