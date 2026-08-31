import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MainPanelHealthCard } from './MainPanelHealthCard';
import { useDeviceStore } from '@/stores/deviceStore';
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

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  useDeviceStore.setState({ devices: [], latestReadings: {}, totals: null, history: {} });
});

describe('MainPanelHealthCard', () => {
  it('reports a fresh panel reading', () => {
    useDeviceStore.setState({ totals: totalsAt('2026-08-31T09:59:50Z') });
    render(<MainPanelHealthCard />);
    expect(screen.getByText('231')).toBeInTheDocument();
    expect(screen.getByText('BALANCED')).toBeInTheDocument();
  });

  it('an expired reading stops being volts and amps', () => {
    useDeviceStore.setState({ totals: totalsAt('2026-08-31T09:50:00Z') });
    render(<MainPanelHealthCard />);
    expect(screen.queryByText('231')).not.toBeInTheDocument();
    expect(screen.queryByText('3.2')).not.toBeInTheDocument();
    expect(screen.queryByText('2.1')).not.toBeInTheDocument();
  });

  it('stops claiming the phases are balanced from a reading that has expired', () => {
    // The worst line on this card is not a number, it is the sentence: "Red and Yellow are
    // within a comfortable range of each other" is a statement about the building's electrical
    // state right now, and a ten-minute-old row cannot support it.
    useDeviceStore.setState({ totals: totalsAt('2026-08-31T09:50:00Z') });
    render(<MainPanelHealthCard />);
    expect(screen.queryByText('BALANCED')).not.toBeInTheDocument();
    expect(screen.queryByText(/comfortable range/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Spread is/)).not.toBeInTheDocument();
  });

  it('never draws a phase bar for a reading it will not print', () => {
    // A full-width bar beside an em dash is the same lie told in a different medium.
    useDeviceStore.setState({ totals: totalsAt('2026-08-31T09:50:00Z') });
    const { container } = render(<MainPanelHealthCard />);
    for (const fill of container.querySelectorAll<HTMLElement>('.phase-bar-fill')) {
      expect(fill.style.width).toBe('0%');
    }
  });

  it('still says Blue is not metered, which is a fact about the building and not a reading', () => {
    useDeviceStore.setState({ totals: totalsAt('2026-08-31T09:50:00Z') });
    render(<MainPanelHealthCard />);
    expect(screen.getByText('Not metered')).toBeInTheDocument();
  });
});
