import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DsmThresholdsCard } from './DsmThresholdsCard';
import { useDeviceStore } from '@/stores/deviceStore';
import { useContextStore } from '@/stores/contextStore';
import type { Totals } from '@/lib/types';

const NOW = Date.parse('2026-08-31T10:00:00Z');

const totalsAt = (iso: string, watts: number, red: number): Totals => ({
  device_id: '_totals',
  ts: iso,
  energy_kwh_today: 12.5,
  energy_kwh_week: 60.25,
  energy_kwh_month: 240.75,
  total_power_w: watts,
  avg_voltage: 231,
  phase_current: { red, yellow: 2.1, blue: null },
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  useContextStore.setState({ saved: { 'global.dsm.max_phase_a': '15.4', 'global.dsm.max_total_kw': '2.21' }, draft: {} });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  useDeviceStore.setState({ devices: [], latestReadings: {}, totals: null, history: {} });
  useContextStore.setState({ saved: {}, draft: {}, status: 'idle', saveStatus: 'idle', saveError: null });
});

describe('DsmThresholdsCard', () => {
  it('reads out a fresh total against the saved thresholds', () => {
    useDeviceStore.setState({ totals: totalsAt('2026-08-31T09:59:50Z', 1234, 3.2) });
    render(<DsmThresholdsCard />);
    expect(screen.getByText(/3\.2 A max phase/)).toBeInTheDocument();
    expect(screen.getByText(/1\.23 kW total/)).toBeInTheDocument();
  });

  it('shows no live figure at all once the reading has expired', () => {
    useDeviceStore.setState({ totals: totalsAt('2026-08-31T09:50:00Z', 1234, 3.2) });
    const { container } = render(<DsmThresholdsCard />);
    // The readout is one sentence assembled from several text nodes, so it is read whole.
    const line = container.querySelector('.card-sub')?.textContent ?? '';
    expect(line).not.toMatch(/3\.2 A/);
    expect(line).toMatch(/—\s*max phase/);
    expect(line).toMatch(/—\s*total/);
  });

  it('does not mark a threshold breached on the strength of an expired reading', () => {
    // The field says the building is over its limit right now. From a ten-minute-old row that is
    // not a warning, it is a guess — and this is the page where someone decides whether to arm a
    // mechanism that cuts power unattended.
    useDeviceStore.setState({ totals: totalsAt('2026-08-31T09:50:00Z', 9000, 25) });
    render(<DsmThresholdsCard />);
    expect(screen.queryAllByText('BREACHED').length).toBe(0);
  });

  it('does not report OK either, because nothing was measured to be OK', () => {
    // "OK" from an expired reading is the same false confidence as a stale figure, in one word.
    // Not breached and not observed are different states and the card has to distinguish them.
    useDeviceStore.setState({ totals: totalsAt('2026-08-31T09:50:00Z', 100, 1) });
    render(<DsmThresholdsCard />);
    expect(screen.queryAllByText('OK').length).toBe(0);
    expect(screen.getAllByText('NO READING').length).toBe(2);
  });

  it('a threshold nobody has set is not OK either — there is no limit to be within', () => {
    // Found by looking at the page rather than at a test: with no saved thresholds the card read
    // "Live: 13.9 A max phase" beside a status of NO READING. The reading was there; the limit
    // was not. Two absences with two different fixes, so they get two different words.
    useContextStore.setState({ saved: {}, draft: {} });
    useDeviceStore.setState({ totals: totalsAt('2026-08-31T09:59:50Z', 1234, 3.2) });
    render(<DsmThresholdsCard />);
    expect(screen.queryAllByText('OK').length).toBe(0);
    expect(screen.queryAllByText('NO READING').length).toBe(0);
    expect(screen.getAllByText('NO LIMIT SET').length).toBe(2);
  });

  it('still marks a breach from a reading that is merely late', () => {
    // Expiry is five minutes; staleness is thirty seconds. A late reading still describes the
    // building, and suppressing a real breach would be the opposite failure.
    useDeviceStore.setState({ totals: totalsAt('2026-08-31T09:58:30Z', 9000, 25) });
    render(<DsmThresholdsCard />);
    expect(screen.queryAllByText('BREACHED').length).toBeGreaterThan(0);
  });
});
