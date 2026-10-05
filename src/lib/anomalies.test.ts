import { describe, it, expect } from 'vitest';
import { latestAnomalyPerDevice, isAnomalyCurrent, ANOMALY_RECENT_MS, unusualEventsCaveat, UNUSUAL_EVENTS_FROM } from './anomalies';
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

describe('unusualEventsCaveat — RM-160', () => {
  // Before the change, every switch of a cycling load was a row or two: about 220 a day, against about 4 after.
  // The date is spelled in the reader's locale; what must hold is the sentence and the day it names.
  const isCaveat = (text: string | null) => /^every switch of a cycling load was counted before \S.*2026$/.test(text ?? '') && /6/.test(text ?? '');

  it('qualifies a period that began before the change, whether or not it ended before it', () => {
    expect(isCaveat(unusualEventsCaveat('2026-07-01'))).toBe(true);
    expect(isCaveat(unusualEventsCaveat('2026-10-05'))).toBe(true);
  });

  it('says nothing for a period that began on or after the change', () => {
    expect(unusualEventsCaveat(UNUSUAL_EVENTS_FROM)).toBeNull();
    expect(unusualEventsCaveat('2026-11-01')).toBeNull();
  });

  it('reads only the date of a start that carries a time', () => {
    expect(unusualEventsCaveat(`${UNUSUAL_EVENTS_FROM}T00:00:00Z`)).toBeNull();
    expect(isCaveat(unusualEventsCaveat('2026-10-05T23:59:59Z'))).toBe(true);
  });
});
