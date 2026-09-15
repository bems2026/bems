import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ReportFindings } from './ReportFindings';
import type { DailyRow, DemandSummary, HourRow } from '@/lib/reportSeries';

/**
 * RM-084 — the three findings on the page. What matters is that a finding the data cannot support
 * reads as an em dash with the reason beside it, and that a figure from a partial period says so.
 */

afterEach(cleanup);

const day = (local_day: string, o: Partial<DailyRow> = {}): DailyRow => ({
  local_day,
  energy_kwh: 20,
  peak_power_w: 2000,
  avg_power_w: 500,
  sample_count: 1440,
  usable_sample_count: 1440,
  expected_samples: 1440,
  first_seen_minute: 0,
  last_seen_minute: 1439,
  resolution: 'minute',
  ...o,
});

const daily = [
  ...['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07'].map((d) => day(d)),
  ...['2026-08-08', '2026-08-09'].map((d) => day(d, { energy_kwh: 2 })),
];

const hours: HourRow[] = Array.from({ length: 24 }, (_, h) => ({ local_hour: h, n: 30, p50_w: h < 6 ? 100 : 800, p95_w: 1200, max_w: 2000, resolution: 'minute' }));

const summary = (o: Partial<DemandSummary> = {}): DemandSummary => ({
  n: 10080,
  p50_w: 600,
  p95_w: 1500,
  p99_w: 1900,
  max_w: 2000,
  min_w: 50,
  observed_minutes: 10080,
  usable_minutes: 10080,
  expected_minutes: 10080,
  longest_gap_minutes: 0,
  resolution: 'minute',
  ...o,
});

describe('ReportFindings', () => {
  it('gives weekday against weekend energy, the load factor and the overnight base load', () => {
    render(<ReportFindings label="Week of 3 Aug 2026" daily={daily} hours={hours} summary={summary()} />);
    expect(screen.getByText(/20\.0 kWh a weekday/)).toBeInTheDocument();
    expect(screen.getByText(/2\.0 kWh a weekend day/)).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(screen.getByText('100 W')).toBeInTheDocument();
    // The weekend it assumed is stated, not hidden.
    expect(screen.getByText(/Saturday and Sunday/)).toBeInTheDocument();
  });

  it('shows an em dash and the reason when a finding cannot be stated, never a zero', () => {
    render(<ReportFindings label="August 2026" daily={[]} hours={null} summary={null} />);
    expect(screen.getAllByText('—')).toHaveLength(3);
    expect(screen.getByText(/at least 3 complete weekdays/)).toBeInTheDocument();
    expect(screen.getByText(/hour-of-day profile has not loaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/^0/)).toBeNull();
  });

  it('qualifies a load factor from a partly observed period', () => {
    render(<ReportFindings label="August 2026" daily={daily} hours={hours} summary={summary({ usable_minutes: 12006, expected_minutes: 44640 })} />);
    expect(screen.getByText(/partial period/)).toBeInTheDocument();
  });
});
