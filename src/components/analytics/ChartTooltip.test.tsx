import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ChartTooltip } from './ChartTooltip';
import type { ChartRow, SlotMeta } from './analyticsMath';
import type { SyncStatus } from '@/lib/dataQuality';

/*
 * RM-076 — the chart tooltip, kept minimal at the operator's request (2026-09-15): the time, each
 * device's value, and a short tag only where a point is not a plain reading. The fixture is CARE ACU's
 * 12:46 flicker on 2026-09-13 beside a measured C.O Yellow.
 */

const T = Date.parse('2026-09-13T12:46:00+08:00');
const rows: ChartRow[] = [{ t: T, a: undefined, 'a:interpolated': 15.15, 'a:frozen': undefined, b: 402.1, 'b:interpolated': undefined, 'b:frozen': undefined }];
const meta: Record<string, SlotMeta>[] = [
  {
    a: { quality: 'interpolated', imputedFrom: 'offline', raw: 15.7, readingTs: '2026-09-13T12:46:05+08:00' },
    b: { quality: 'measured', raw: 402.1, readingTs: '2026-09-13T12:46:17+08:00', samples: 11, of: 11 },
  },
];
const series = [
  { key: 'a', name: 'CARE ACU', color: 'var(--accent)' },
  { key: 'b', name: 'C.O Yellow', color: 'var(--blue-bright)' },
];
const fresh = (): SyncStatus => ({ settled: true, fetchedAt: Date.now(), failures: 0, lastError: null, refetchMs: 60_000, source: 'bridge' });
const mount = (over: { label?: number; stepMs?: number; sync?: SyncStatus; active?: boolean } = {}) =>
  render(
    <ChartTooltip
      active={over.active ?? true}
      label={over.label ?? T}
      rows={rows}
      meta={meta}
      series={series}
      param="power"
      sync={over.sync ?? fresh()}
      stepMs={over.stepMs ?? 60_000}
    />,
  );

afterEach(cleanup);

describe('ChartTooltip', () => {
  it('draws nothing while the chart is not being hovered', () => {
    expect(mount({ active: false }).container).toBeEmptyDOMElement();
  });

  it('shows the time, each value, and a tag only where a point is not a plain reading', () => {
    mount();
    expect(screen.getByText('Sep 13 · 12:46')).toBeInTheDocument();
    expect(screen.getByText('CARE ACU')).toBeInTheDocument();
    expect(screen.getByText('15 W')).toBeInTheDocument();
    expect(screen.getByText('C.O Yellow')).toBeInTheDocument();
    expect(screen.getByText('402 W')).toBeInTheDocument();
    expect(screen.getAllByText('Estimated')).toHaveLength(1);
  });

  it('leaves out everything that is not the time, a value or a tag', () => {
    const { container } = mount();
    expect(container).not.toHaveTextContent(/Average|samples|Reading at|Bridge buffer|fetched|Interpolated/);
  });

  it('shows the span a longer point stands for', () => {
    mount({ stepMs: 900_000 });
    expect(screen.getByText('Sep 13 · 12:46–13:01')).toBeInTheDocument();
  });

  it('adds one note only when the data has stopped arriving', () => {
    mount({ sync: { ...fresh(), fetchedAt: Date.now() - 330_000, failures: 2 } });
    expect(screen.getByText(/^Cached · \d+ min old$/)).toBeInTheDocument();
    cleanup();
    mount();
    expect(screen.queryByText(/Cached/)).not.toBeInTheDocument();
  });

  it('draws nothing for a moment it has no row for', () => {
    expect(mount({ label: T + 60_000 }).container).toBeEmptyDOMElement();
  });
});
