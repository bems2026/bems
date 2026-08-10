import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PhaseBalance } from './PhaseBalance';
import { useDeviceStore } from '@/stores/deviceStore';

afterEach(() => {
  cleanup();
  useDeviceStore.setState({ devices: [], latestReadings: {}, totals: null, history: {} });
});

describe('PhaseBalance', () => {
  it('shows "Not metered" for Blue even with real red/yellow current present', () => {
    useDeviceStore.setState({
      totals: {
        device_id: '_totals',
        ts: new Date().toISOString(),
        energy_kwh_today: 1,
        energy_kwh_week: 1,
        energy_kwh_month: 1,
        total_power_w: 1,
        avg_voltage: 220,
        phase_current: { red: 6.1, yellow: 4.9, blue: null },
      },
    });
    render(<PhaseBalance />);
    expect(screen.getByText('Not metered')).toBeInTheDocument();
  });

  it('shows "Not metered" for Blue even with no totals at all yet', () => {
    render(<PhaseBalance />);
    expect(screen.getByText('Not metered')).toBeInTheDocument();
  });

  it('renders real red/yellow amperage values', () => {
    useDeviceStore.setState({
      totals: {
        device_id: '_totals',
        ts: new Date().toISOString(),
        energy_kwh_today: 1,
        energy_kwh_week: 1,
        energy_kwh_month: 1,
        total_power_w: 1,
        avg_voltage: 220,
        phase_current: { red: 6.1, yellow: 4.9, blue: null },
      },
    });
    render(<PhaseBalance />);
    const values = [...document.querySelectorAll('.phase-balance__value')].map((el) => el.textContent);
    expect(values).toEqual(['6.1A', '4.9A', '—']);
  });
});
