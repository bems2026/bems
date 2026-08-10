import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { EnergyTotals } from './EnergyTotals';
import { useDeviceStore } from '@/stores/deviceStore';

afterEach(() => {
  cleanup();
  useDeviceStore.setState({ devices: [], latestReadings: {}, totals: null, history: {} });
});

describe('EnergyTotals', () => {
  it('shows placeholders and the branch-meters-only caption before data arrives', () => {
    render(<EnergyTotals />);
    expect(screen.getAllByText('—')).toHaveLength(3);
    expect(screen.getByText(/individual outlet energy isn't included/)).toBeInTheDocument();
  });

  it('renders today/week/month once totals arrive', () => {
    useDeviceStore.setState({
      totals: {
        device_id: '_totals',
        ts: new Date().toISOString(),
        energy_kwh_today: 12.41,
        energy_kwh_week: 61.88,
        energy_kwh_month: 204.3,
        total_power_w: 2951,
        avg_voltage: 223.1,
        phase_current: { red: 6.1, yellow: 4.9, blue: null },
      },
    });
    render(<EnergyTotals />);
    expect(screen.getByText('12.41 kWh')).toBeInTheDocument();
    expect(screen.getByText('61.88 kWh')).toBeInTheDocument();
    expect(screen.getByText('204.30 kWh')).toBeInTheDocument();
  });
});
