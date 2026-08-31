import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { LiveDemandCard } from './LiveDemandCard';
import { useDeviceStore } from '@/stores/deviceStore';
import { useConnectionStore } from '@/stores/connectionStore';
import type { Totals } from '@/lib/types';

const NOW = Date.parse('2026-08-31T10:00:00Z');

const totalsAt = (iso: string): Totals => ({
  device_id: '_totals',
  ts: iso,
  energy_kwh_today: 12.5,
  energy_kwh_week: 60.25,
  energy_kwh_month: 240.75,
  total_power_w: 1234,
  avg_voltage: 231,
  phase_current: { red: 3.2, yellow: 2.1, blue: null },
});

const draw = () =>
  render(<LiveDemandCard />);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  useDeviceStore.setState({ devices: [], latestReadings: {}, totals: null, history: {} });
  useConnectionStore.setState({ wsStatus: 'connected', lastMessageAt: null });
});

describe('LiveDemandCard', () => {
  it('shows a fresh total as the figure it is', () => {
    useDeviceStore.setState({ totals: totalsAt('2026-08-31T09:59:50Z') });
    useConnectionStore.setState({ wsStatus: 'connected', lastMessageAt: '2026-08-31T09:59:50Z' });
    draw();
    expect(screen.getByText('1.23')).toBeInTheDocument();
    expect(screen.getByText('12.50')).toBeInTheDocument();
  });

  it('stops showing the demand figure once the totals row has expired', () => {
    // The co5 incident at building scale. The feed goes quiet, the store keeps the last row,
    // and the largest number on the dashboard carries on reading like a measurement. The
    // connection pill changing to RECONNECTING is not the same statement: it describes the
    // link, and a reader looking at "1.23 kW" is reading the building.
    useDeviceStore.setState({ totals: totalsAt('2026-08-31T09:50:00Z') }); // ten minutes old
    useConnectionStore.setState({ wsStatus: 'connected', lastMessageAt: '2026-08-31T09:50:00Z' });
    draw();
    expect(screen.queryByText('1.23')).not.toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('expires the energy counters with it, rather than leaving three live-looking figures', () => {
    useDeviceStore.setState({ totals: totalsAt('2026-08-31T09:50:00Z') });
    draw();
    expect(screen.queryByText('12.50')).not.toBeInTheDocument();
    expect(screen.queryByText('60.2')).not.toBeInTheDocument();
    expect(screen.queryByText('240.8')).not.toBeInTheDocument();
  });

  it('calls a stale reading stale even while the link is healthy', () => {
    // FI-006. The pill described the *link*: messages were arriving, so it said LIVE, while the
    // totals row underneath it had stopped advancing. Those are different facts, and the one a
    // reader looking at "1.23 kW" needs is the second.
    useDeviceStore.setState({ totals: totalsAt('2026-08-31T09:59:00Z') }); // 60s — stale, not expired
    useConnectionStore.setState({ wsStatus: 'connected', lastMessageAt: '2026-08-31T09:59:55Z' });
    draw();
    expect(screen.getByText('STALE')).toBeInTheDocument();
    expect(screen.getByText('1.23')).toBeInTheDocument(); // still a measurement, just a late one
  });

  it('says LIVE only when both the link and the reading are fresh', () => {
    useDeviceStore.setState({ totals: totalsAt('2026-08-31T09:59:50Z') });
    useConnectionStore.setState({ wsStatus: 'connected', lastMessageAt: '2026-08-31T09:59:55Z' });
    draw();
    expect(screen.getByText('LIVE')).toBeInTheDocument();
  });

  it('announces the change rather than only recolouring it', () => {
    // A figure going stale is the most important state change on a monitoring dashboard, and a
    // span that silently swaps its text announces nothing at all.
    useDeviceStore.setState({ totals: totalsAt('2026-08-31T09:59:50Z') });
    useConnectionStore.setState({ wsStatus: 'connected', lastMessageAt: '2026-08-31T09:59:55Z' });
    draw();
    expect(screen.getByRole('status')).toHaveTextContent('LIVE');
  });
});
