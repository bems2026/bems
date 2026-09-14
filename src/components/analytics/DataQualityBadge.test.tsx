import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DataQualityBadge } from './DataQualityBadge';
import { useConnectionStore } from '@/stores/connectionStore';
import { summarizeQuality } from '@/lib/timeseries';
import type { SyncStatus } from '@/lib/dataQuality';

/*
 * RM-076 — one line above a chart saying whether what it draws is current and how much of it was
 * measured. The sentences themselves are pinned in `lib/dataQuality.test.ts`; this pins which of them
 * appear, and when.
 */

const fresh = (): SyncStatus => ({ settled: true, fetchedAt: Date.now() - 5_000, failures: 0, lastError: null, refetchMs: 60_000, source: 'bridge' });

afterEach(() => {
  cleanup();
  useConnectionStore.setState({ wsStatus: 'reconnecting', lastMessageAt: null });
});

describe('DataQualityBadge', () => {
  it('says Live when the history is current and the live feed is open', () => {
    useConnectionStore.setState({ wsStatus: 'connected' });
    render(<DataQualityBadge sync={fresh()} stepMs={60_000} />);
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('says how long was bridged, how many windows were offline, and which meters froze', () => {
    useConnectionStore.setState({ wsStatus: 'connected' });
    render(<DataQualityBadge sync={fresh()} quality={{ ...summarizeQuality([]), interpolated: 3 }} gapCount={2} frozenNames={['L.O Red']} stepMs={60_000} />);
    expect(screen.getByText('Interpolated · 3 min')).toBeInTheDocument();
    expect(screen.getByText('Offline · 2 windows')).toBeInTheDocument();
    expect(screen.getByText('Frozen · L.O Red')).toBeInTheDocument();
  });

  it('adds nothing about quality when every point on the chart was measured', () => {
    useConnectionStore.setState({ wsStatus: 'connected' });
    render(<DataQualityBadge sync={fresh()} quality={summarizeQuality([])} gapCount={0} frozenNames={[]} stepMs={60_000} />);
    expect(screen.queryByText(/Interpolated|Offline ·|Frozen ·/)).not.toBeInTheDocument();
  });

  it('says Cached, with its age, once history stops arriving — and gives the reason to a screen reader', () => {
    useConnectionStore.setState({ wsStatus: 'connected' });
    render(<DataQualityBadge sync={{ ...fresh(), fetchedAt: Date.now() - 200_000, failures: 3, lastError: 'bridge unreachable' }} stepMs={60_000} />);
    expect(screen.getByText('Cached · 3 min old')).toBeInTheDocument();
    expect(screen.getByText(/bridge unreachable/)).toBeInTheDocument();
  });
});
