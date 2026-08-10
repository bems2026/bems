import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SystemGauges } from './SystemGauges';
import { useDeviceStore } from '@/stores/deviceStore';

afterEach(() => {
  cleanup();
  useDeviceStore.setState({ devices: [], latestReadings: {}, totals: null, history: {} });
});

describe('SystemGauges', () => {
  it('shows placeholders before the first reading arrives, and always "Not metered" for Blue', () => {
    render(<SystemGauges />);
    expect(screen.getByText('Phase Blue')).toBeInTheDocument();
    expect(screen.getByText('Not metered')).toBeInTheDocument();
    // Every other metric is an em dash until data arrives — never a fabricated 0.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4);
  });

  it('renders real totals once available, and still never a number for Blue', () => {
    useDeviceStore.setState({
      totals: {
        device_id: '_totals',
        ts: new Date().toISOString(),
        energy_kwh_today: 1,
        energy_kwh_week: 1,
        energy_kwh_month: 1,
        total_power_w: 2951,
        avg_voltage: 223.1,
        phase_current: { red: 6.1, yellow: 4.9, blue: null },
      },
    });
    render(<SystemGauges />);
    expect(screen.getByText('223.1 V')).toBeInTheDocument();
    expect(screen.getByText('2951 W')).toBeInTheDocument();
    expect(screen.getByText('6.1 A')).toBeInTheDocument();
    expect(screen.getByText('4.9 A')).toBeInTheDocument();
    // Blue is never rendered as "0.0 A" — that would misrepresent an unmetered phase
    // as a real zero reading.
    expect(screen.queryByText('0.0 A')).not.toBeInTheDocument();
    expect(screen.getByText('Not metered')).toBeInTheDocument();
  });
});
