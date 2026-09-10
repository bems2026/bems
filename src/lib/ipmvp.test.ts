import { describe, it, expect } from 'vitest';
import { compare, describeDifference, type Comparison } from './ipmvp';
import type { PeriodBuildingReport, ReportPeriod } from './supabaseReports';

/**
 * The gate is the feature. Everything else in this module is subtraction.
 *
 * With today's live data the refusal is not hypothetical: the week of 2026-08-31 is 100% covered
 * and August 2026 is 48%. An ungated comparison prints something like "−52%" as the most
 * quotable number in a document going to a university, and every part of it is an artefact of
 * the meters being off rather than of the building using less.
 */

const period = (over: Partial<PeriodBuildingReport> = {}): PeriodBuildingReport =>
  ({
    period: 'month' as ReportPeriod,
    period_start: '2026-08-01',
    energy_kwh: 100,
    peak_total_power_w: 4000,
    avg_voltage: 230,
    phase_current_red_avg: 1,
    phase_current_yellow_avg: 1,
    phase_current_blue_avg: null,
    command_count: 0,
    command_count_manual: 0,
    command_count_schedule: 0,
    command_count_autoshed: 0,
    anomaly_count: 0,
    online_sample_count: 44640,
    expected_sample_count: 44640,
    generated_at: '2026-09-01T00:00:00Z',
    ...over,
  }) as PeriodBuildingReport;

describe('compare — the refusals', () => {
  it('refuses a week against a month', () => {
    // Different numbers of hours. The page's period switcher is two clicks from either, which
    // is exactly why this cannot be left to the reader to notice.
    const r = compare({
      baseline: period({ period: 'month' }),
      reporting: period({ period: 'week', period_start: '2026-08-31' }),
    });
    expect(r.comparable).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/different numbers of hours/i);
  });

  it('refuses a period against itself', () => {
    const r = compare({ baseline: period(), reporting: period() });
    expect(r.comparable).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/same one/i);
  });

  it('refuses when the baseline was not fully observed', () => {
    // August 2026 exactly: 21,421 of 44,640.
    const r = compare({
      baseline: period({ online_sample_count: 21421 }),
      reporting: period({ period_start: '2026-09-01' }),
    });
    expect(r.comparable).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/baseline/);
    expect((r as { reason: string }).reason).toMatch(/48%/);
    expect((r as { reason: string }).reason).toMatch(/how much was watched, not in how much was used/i);
  });

  it('refuses when the reporting period was not fully observed', () => {
    const r = compare({
      baseline: period(),
      reporting: period({ period_start: '2026-09-01', online_sample_count: 21421 }),
    });
    expect(r.comparable).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/reporting/);
  });

  it('names both when both are thin', () => {
    const r = compare({
      baseline: period({ online_sample_count: 20000 }),
      reporting: period({ period_start: '2026-09-01', online_sample_count: 30000 }),
    });
    expect((r as { reason: string }).reason).toMatch(/baseline and reporting/);
  });

  it('refuses when a period reports no energy at all', () => {
    const r = compare({
      baseline: period({ energy_kwh: null }),
      reporting: period({ period_start: '2026-09-01' }),
    });
    expect(r.comparable).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/nothing to difference/i);
  });

  it('still reports the coverage it refused on, so the reader can see why', () => {
    const r = compare({
      baseline: period({ online_sample_count: 21421 }),
      reporting: period({ period_start: '2026-09-01' }),
    }) as { baselineCoverage: { band: string } };
    expect(r.baselineCoverage.band).toBe('sparse');
  });
});

describe('compare — the arithmetic, once it is allowed', () => {
  it('differences two fully observed periods', () => {
    const r = compare({
      baseline: period({ energy_kwh: 100 }),
      reporting: period({ period_start: '2026-09-01', energy_kwh: 80 }),
    }) as Comparison;
    expect(r.comparable).toBe(true);
    expect(r.differenceKwh).toBe(-20);
    expect(r.differencePct).toBeCloseTo(-20, 6);
  });

  it('allows a 95% period through, because that is where coverageOf draws complete', () => {
    // The threshold lives in one place. A second one here would drift from the one the figures
    // beside the comparison are qualified by.
    const r = compare({
      baseline: period({ online_sample_count: Math.ceil(44640 * 0.95) }),
      reporting: period({ period_start: '2026-09-01' }),
    });
    expect(r.comparable).toBe(true);
  });

  it('returns null rather than a percentage of zero', () => {
    // Not 0%, not infinity: a percentage of nothing is undefined, and both alternatives are
    // inventions a reader would quote.
    const r = compare({
      baseline: period({ energy_kwh: 0 }),
      reporting: period({ period_start: '2026-09-01', energy_kwh: 5 }),
    }) as Comparison;
    expect(r.differenceKwh).toBe(5);
    expect(r.differencePct).toBeNull();
  });
});

describe('describeDifference', () => {
  const c = (kwh: number, pct: number | null): Comparison =>
    ({
      comparable: true,
      baselineKwh: 100,
      reportingKwh: 100 + kwh,
      differenceKwh: kwh,
      differencePct: pct,
      baselineCoverage: { ratio: 1, band: 'complete' },
      reportingCoverage: { ratio: 1, band: 'complete' },
    }) as Comparison;

  it('says the direction in words, not with a sign', () => {
    // A minus sign in front of a number a reader wants to be good is read as whichever they
    // were hoping for. "less" and "more" cannot be misread.
    expect(describeDifference(c(-20, -20), 'month')).toMatch(/20\.00 kWh \(20\.0%\) less/);
    expect(describeDifference(c(20, 20), 'month')).toMatch(/20\.00 kWh \(20\.0%\) more/);
  });

  it('omits the percentage when there is not one', () => {
    expect(describeDifference(c(5, null), 'week')).not.toMatch(/%/);
  });

  it('says so when nothing changed', () => {
    expect(describeDifference(c(0, 0), 'month')).toMatch(/same energy/i);
  });

  it('never calls a difference a saving', () => {
    // A saving is a claim about cause. This is arithmetic, and the period was not adjusted for
    // weather, occupancy or operating hours — none of which this system records.
    const words = describeDifference(c(-20, -20), 'month');
    expect(words).not.toMatch(/saving|saved|efficien/i);
  });
});
