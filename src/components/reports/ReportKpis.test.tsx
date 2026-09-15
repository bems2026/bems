import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ReportKpis } from './ReportKpis';
import type { PeriodBuildingReport } from '@/lib/supabaseReports';
import type { DemandSummary } from '@/lib/reportSeries';
import type { Carboned, Costed } from '@/lib/energyCost';

/**
 * RM-082. The report's headline figures were eight equal cells of a `<dl>`, the energy at the same
 * 14px as the command count. These pin the hierarchy — energy first and largest — and the rules
 * each figure must still keep when it is made prominent: a zero from nothing observed is not
 * printed, a thin period is qualified in its own word, and a comparison with the previous period is
 * shown only when it would mean something.
 */

afterEach(cleanup);

const FULL_MONTH = 31 * 24 * 60;

const building = (o: Partial<PeriodBuildingReport> = {}): PeriodBuildingReport => ({
  period: 'month',
  period_start: '2026-07-01',
  energy_kwh: 100,
  peak_total_power_w: 2140,
  avg_voltage: 220,
  phase_current_red_avg: 2,
  phase_current_yellow_avg: 2,
  phase_current_blue_avg: null,
  command_count: 0,
  command_count_manual: 0,
  command_count_schedule: 0,
  command_count_autoshed: 0,
  anomaly_count: 0,
  online_sample_count: FULL_MONTH,
  expected_sample_count: FULL_MONTH,
  generated_at: '2026-08-03T00:00:00Z',
  ...o,
});

const summary = (o: Partial<DemandSummary> = {}): DemandSummary => ({
  n: 12006,
  p50_w: 800,
  p95_w: 1900,
  p99_w: 2100,
  max_w: 2140,
  min_w: 90,
  observed_minutes: 21421,
  usable_minutes: 12006,
  expected_minutes: 44640,
  longest_gap_minutes: 23549,
  resolution: 'minute',
  ...o,
});

const noCost: Costed = { total: null, currency: null, byRate: [], unpricedKwh: 0, unobservedDays: 0, mixedCurrency: false };
const noCarbon: Carboned = { total: null, byFactor: [], unpricedKwh: 0, unobservedDays: 0 };
const ready = { status: 'ready' as const, error: null, retry: vi.fn() };

type Props = Parameters<typeof ReportKpis>[0];
const draw = (o: Partial<Props> = {}) =>
  render(
    <ReportKpis
      period="month"
      building={building()}
      summary={summary({ usable_minutes: FULL_MONTH, observed_minutes: FULL_MONTH, expected_minutes: FULL_MONTH })}
      notObserved={false}
      cost={noCost}
      carbon={noCarbon}
      pricing={ready}
      previous={null}
      {...o}
    />
  );

describe('ReportKpis', () => {
  it('leads with the energy, in the headline slot, before any other figure', () => {
    draw();
    const terms = screen.getAllByRole('term');
    expect(terms[0]).toHaveTextContent('Energy');
    const figure = screen.getByText(/100\.00 kWh/);
    expect(figure.closest('dd')).toHaveClass('report-kpi__hero-value');
  });

  it('gives peak demand in kilowatts, and a missing peak as an em dash rather than 0 kW', () => {
    const { unmount } = draw();
    expect(screen.getByText(/2\.14 kW/)).toBeInTheDocument();
    unmount();

    // `null / 1000` is 0 in JavaScript, which is exactly how a missing peak becomes "0.00 kW".
    // Scoped to the peak's own tile: "100.00 kWh" beside it contains "0.00 kW" as a substring.
    draw({ building: building({ peak_total_power_w: null }) });
    // By text, not by role name: a `<dt>` (role "term") takes its name from author attributes only,
    // never from its content, so `getByRole('term', { name })` cannot match anything.
    const peak = screen.getByText('Peak demand').nextElementSibling as HTMLElement;
    expect(peak).toHaveTextContent('—');
    expect(peak).not.toHaveTextContent(/0\.00/);
  });

  it('qualifies a thin period’s figures in the period’s own word', () => {
    draw({
      period: 'week',
      building: building({ period: 'week', period_start: '2026-07-06', online_sample_count: 4 * 1440, expected_sample_count: 7 * 1440 }),
    });
    expect(screen.getAllByText(/partial week/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/partial month/)).toBeNull();
  });

  it('says "not observed" instead of printing a zero nobody measured', () => {
    draw({ building: building({ energy_kwh: 0, peak_total_power_w: 0, online_sample_count: 10 }), notObserved: true });
    expect(screen.getAllByText(/not observed/).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/^0\.00 kWh/)).toBeNull();
  });

  it('states coverage as the share of minutes that carried a real reading', () => {
    // August 2026: 48% as rows, 27% as readings. The tile says the second, which is the true one.
    draw({ summary: summary() });
    expect(screen.getByText('27%')).toBeInTheDocument();
  });

  it('compares with the previous period when both were fully observed, and says the direction in words', () => {
    draw({ previous: building({ period_start: '2026-06-01', energy_kwh: 120 }) });
    expect(screen.getByText(/^vs June 2026$/).tagName).toBe('DT');
    expect(screen.getByText(/-20\.00 kWh/)).toBeInTheDocument();
    expect(screen.getByText(/16\.7%.*less/)).toBeInTheDocument();
  });

  it('refuses the comparison when either period was thin, and says how thin', () => {
    // Live: a 100%-covered week beside a 48%-covered month. Ungated, that difference is the most
    // quotable number on the page and entirely an artefact of the meters being off.
    draw({ previous: building({ period_start: '2026-06-01', energy_kwh: 120, online_sample_count: Math.round(FULL_MONTH * 0.48) }) });
    expect(screen.getByText(/not comparable/i)).toBeInTheDocument();
    expect(screen.getByText(/48%/)).toBeInTheDocument();
    expect(screen.queryByText(/-20\.00 kWh/)).toBeNull();
  });

  it('offers no comparison at all when there is no earlier period', () => {
    // The test above is this one's positive control: the same query finds the tile when there is
    // a previous period, so its absence here is not a query that could never match.
    draw();
    expect(screen.queryByText(/^vs /)).toBeNull();
  });
});
