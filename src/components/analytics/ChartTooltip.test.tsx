import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ChartTooltip } from './ChartTooltip';
import type { ChartRow, SlotMeta } from './analyticsMath';
import type { SyncStatus } from '@/lib/dataQuality';

/*
 * RM-076 — a tooltip that says exactly when, exactly what, what kind of point, and from where. The
 * fixture is CARE ACU's 12:46 health flicker on 2026-09-13 beside a measured C.O Yellow.
 */

const T = Date.parse('2026-09-13T12:46:00+08:00');
const rows: ChartRow[] = [{ t: T, a: undefined, 'a:interpolated': 15.15, 'a:frozen': undefined, b: 402.1, 'b:interpolated': undefined, 'b:frozen': undefined }];
const meta: Record<string, SlotMeta>[] = [
  {
    a: { quality: 'interpolated', imputedFrom: 'offline', raw: 15.7, readingTs: '2026-09-13T12:46:05+08:00' },
    b: { quality: 'measured', raw: 402.1, readingTs: '2026-09-13T12:46:17+08:00' },
  },
];
const series = [
  { key: 'a', name: 'CARE ACU', color: 'var(--accent)' },
  { key: 'b', name: 'C.O Yellow', color: 'var(--blue-bright)' },
];
const sync: SyncStatus = { settled: true, fetchedAt: Date.now(), failures: 0, lastError: null, refetchMs: 60_000, source: 'bridge' };

afterEach(cleanup);

describe('ChartTooltip', () => {
  it('draws nothing while the chart is not being hovered', () => {
    const { container } = render(<ChartTooltip active={false} label={T} rows={rows} meta={meta} series={series} param="power" sync={sync} stepMs={60_000} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names the exact moment, each value, what kind of point it is, what the device carried, and where it came from', () => {
    render(<ChartTooltip active label={T} rows={rows} meta={meta} series={series} param="power" sync={sync} stepMs={60_000} />);
    expect(screen.getByText(/12:46:00/)).toBeInTheDocument();
    expect(screen.getByText('CARE ACU')).toBeInTheDocument();
    expect(screen.getByText('15.15 W')).toBeInTheDocument();
    expect(screen.getByText('Interpolated across a brief offline flicker (the device carried 15.7 W)')).toBeInTheDocument();
    expect(screen.getByText('402.1 W')).toBeInTheDocument();
    expect(screen.getByText('Reading at 12:46:17')).toBeInTheDocument();
    expect(screen.getByText(/^Bridge buffer · fetched/)).toBeInTheDocument();
  });

  it('shows the span a stored bucket stands for, not just its start', () => {
    render(<ChartTooltip active label={T} rows={rows} meta={meta} series={series} param="power" sync={{ ...sync, source: 'stored' }} stepMs={900_000} />);
    expect(screen.getByText(/12:46:00 – 13:01/)).toBeInTheDocument();
  });

  it('draws nothing for a moment it has no row for', () => {
    const { container } = render(<ChartTooltip active label={T + 60_000} rows={rows} meta={meta} series={series} param="power" sync={sync} stepMs={60_000} />);
    expect(container).toBeEmptyDOMElement();
  });
});
