import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { KpiRow } from './KpiRow';
import { useDeviceStore } from '@/stores/deviceStore';
import type { Device } from '@/lib/types';

afterEach(() => {
  cleanup();
  useDeviceStore.setState({ devices: [], latestReadings: {}, totals: null, history: {} });
});

const device = (id: string): Device => ({ id, display_name: id, class: 'outlet_dual', room: null, dps_map: null, status: 'active' });

describe('KpiRow', () => {
  it('shows placeholders before any data arrives, including Devices Online', () => {
    render(<KpiRow />);
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText(/\//)).not.toBeInTheDocument();
  });

  it('shows an online/total count once the catalogue and readings arrive', () => {
    useDeviceStore.setState({
      devices: [device('co1'), device('co2'), device('co3')],
      latestReadings: {
        co1: { device_id: 'co1', ts: new Date().toISOString(), online: true, state: 'on' },
        co2: { device_id: 'co2', ts: new Date().toISOString(), online: false, state: 'off' },
      },
      totals: {
        device_id: '_totals',
        ts: new Date().toISOString(),
        energy_kwh_today: 12.4,
        energy_kwh_week: 60,
        energy_kwh_month: 200,
        total_power_w: 2951,
        avg_voltage: 223.1,
        phase_current: { red: 6.1, yellow: 4.9, blue: null },
      },
    });
    render(<KpiRow />);
    expect(screen.getByText('1/3')).toBeInTheDocument();
    expect(screen.getByText('2951')).toBeInTheDocument();
  });
});
