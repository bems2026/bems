import { describe, it, expect } from 'vitest';
import { apportionedEstimates, estimateDayPoints, estimateHourPoints, shareWords } from './apportionment';
import type { PeriodDeviceReport } from './supabaseReports';

/**
 * RM-130 / FI-035 — a load nobody metered, shown as the estimate it is. C.O Yellow feeds the CARE
 * office's outlets and, in another room, the director's office aircon at about two thirds of the
 * branch (operator, 2026-09-22). The figure is the branch's MEASURED energy times a DECLARED share,
 * and everything about it must say so: where the share came from, what it leaves for the outlets,
 * and every caveat the branch's own figure carries.
 */

const FULL = 31 * 24 * 60;
const row = (o: Partial<PeriodDeviceReport> = {}): PeriodDeviceReport => ({
  period: 'month',
  period_start: '2026-08-01',
  device_id: 'mtr_co_yellow',
  energy_kwh: 9,
  peak_power_w: 1268,
  avg_power_w: 300,
  online_sample_count: FULL,
  expected_sample_count: FULL,
  ...o,
});

describe('apportionedEstimates', () => {
  it('names the director\'s aircon, its branch, and its share, from the site file and nothing else', () => {
    const [ac] = apportionedEstimates([row()]);
    expect(ac.id).toBe('directors_aircon');
    expect(ac.label).toMatch(/director/i);
    expect(ac.branchLabel).toBe('C.O Yellow');
    expect(ac.meterId).toBe('mtr_co_yellow');
    expect(ac.share).toBeCloseTo(2 / 3, 9);
    expect(ac.basis).toMatch(/operator/i);
    expect(ac.load).toBe('aircon');
  });

  it('is the branch\'s measured energy times the share, with the remainder for the outlets', () => {
    const [ac] = apportionedEstimates([row({ energy_kwh: 9 })]);
    expect(ac.branchKwh).toBe(9);
    expect(ac.estimatedKwh).toBeCloseTo(6, 9);
    expect(ac.remainderKwh).toBeCloseTo(3, 9);
  });

  it('carries the branch\'s coverage, so a partly recorded branch gives a partly recorded estimate', () => {
    const [ac] = apportionedEstimates([row({ online_sample_count: Math.round(FULL * 0.6) })]);
    expect(ac.coverage?.band).not.toBe('complete');
  });

  it('refuses when the branch\'s own figure is refused — an estimate of an impossible number is still impossible', () => {
    // RM-090's rule: 251 W all month cannot reach 81 kWh. The branch figure is refused, so is its share.
    const week = 7 * 24 * 60;
    const [ac] = apportionedEstimates([row({ energy_kwh: 81.406, peak_power_w: 251.2, period: 'week', online_sample_count: week, expected_sample_count: week })]);
    expect(ac.estimatedKwh).toBeNull();
    expect(ac.remainderKwh).toBeNull();
    expect(ac.flag?.kind).toBe('impossible');
  });

  it('has nothing to say when the branch was not stored, but still names the load', () => {
    const [ac] = apportionedEstimates([]);
    expect(ac.label).toMatch(/director/i);
    expect(ac.branchKwh).toBeNull();
    expect(ac.estimatedKwh).toBeNull();
    expect(ac.coverage).toBeNull();
  });

  it('never invents a figure from a branch that recorded nothing', () => {
    const [ac] = apportionedEstimates([row({ energy_kwh: null, online_sample_count: 0 })]);
    expect(ac.estimatedKwh).toBeNull();
  });
});

describe('shareWords', () => {
  it('says the share the way the operator said it', () => {
    expect(shareWords(2 / 3)).toBe('about two thirds');
    expect(shareWords(0.5)).toBe('about half');
    expect(shareWords(0.4)).toBe('about 40%');
  });
});

describe('the estimate, charted — RM-130', () => {
  const [ac] = apportionedEstimates([row({ energy_kwh: 9 })]);
  const dayRow = (local_day: string, energy_kwh: number | null, online_minutes = 1440) => ({
    device_id: 'mtr_co_yellow', local_day, energy_kwh, counter_kwh: energy_kwh, removed_kwh: null, clipped_hours: 0,
    peak_power_w: 800, avg_power_w: 300, online_minutes, expected_minutes: 1440, resolution: 'minute',
  });

  it('scales each of the branch\'s days by the share, and carries observed and complete', () => {
    const pts = estimateDayPoints([dayRow('2026-08-01', 3), dayRow('2026-08-02', null, 0), dayRow('2026-08-03', 6, 700), { ...dayRow('2026-08-04', 1), device_id: 'mtr_lo_red' }], ac);
    expect(pts.map((p) => p.day)).toEqual(['2026-08-01', '2026-08-02', '2026-08-03']);
    expect(pts[0]).toMatchObject({ label: '1', kwh: 2, observed: true, complete: true });
    expect(pts[1]).toMatchObject({ kwh: null, observed: false });
    expect(pts[2].kwh).toBeCloseTo(4, 9);
    expect(pts[2].complete).toBe(false);
  });

  it('scales a day\'s hours by the share, power included, and keeps the gaps', () => {
    const hour = (h: number, kwh: number | null) => ({
      device_id: 'mtr_co_yellow', local_day: '2026-09-19', local_hour: h, energy_kwh: kwh, clipped: false,
      avg_power_w: kwh === null ? null : kwh * 1000, max_power_w: kwh === null ? null : kwh * 1500, online_minutes: kwh === null ? 0 : 60, resolution: kwh === null ? null : 'minute',
    });
    const pts = estimateHourPoints([hour(9, 0.6), hour(10, null), { ...hour(10, 0.3), device_id: 'mtr_lo_red' }], ac);
    expect(pts).toHaveLength(24);
    expect(pts[9].kwh).toBeCloseTo(0.4, 9);
    expect(pts[9].avgW).toBeCloseTo(400, 6);
    expect(pts[9].maxW).toBeCloseTo(600, 6);
    expect(pts[10]).toMatchObject({ kwh: null, observed: false });
  });
});
