import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DevicesView } from './DevicesView';
import { useDeviceStore } from '@/stores/deviceStore';
import type { Device } from '@/lib/types';

const device = (id: string, display_name: string, deviceClass: Device['class'], extra: Partial<Device> = {}): Device => ({
  id,
  display_name,
  class: deviceClass,
  room: null,
  dps_map: null,
  status: 'active',
  ...extra,
});

afterEach(() => {
  cleanup();
  useDeviceStore.setState({ devices: [], latestReadings: {}, totals: null, history: {} });
});

describe('DevicesView', () => {
  it('shows skeletons before the catalogue loads', () => {
    render(<DevicesView />);
    expect(document.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
    expect(screen.queryByText('Outlets')).not.toBeInTheDocument();
  });

  it('groups devices into class sections with correct labels and counts', () => {
    useDeviceStore.setState({
      devices: [device('co1', 'Outlet 1', 'outlet_dual'), device('co2', 'Outlet 2', 'outlet_dual'), device('l1', 'Light 1', 'switch')],
    });
    render(<DevicesView />);
    expect(screen.getByText('Outlets')).toBeInTheDocument();
    expect(screen.getByText('Lighting Switches')).toBeInTheDocument();
    expect(screen.queryByText('Branch Meters')).not.toBeInTheDocument();
    const outletsSection = screen.getByText('Outlets').closest('.devices-group');
    expect(outletsSection?.querySelector('.devices-group__count')?.textContent).toBe('2');
  });

  it('only shows metric rows the reading actually has — no fabricated 0s for unsupported fields', () => {
    useDeviceStore.setState({
      devices: [device('l1', 'Light 1', 'switch')],
      latestReadings: { l1: { device_id: 'l1', ts: new Date().toISOString(), online: true, state: 'on' } },
    });
    render(<DevicesView />);
    // A switch has no voltage/current/power concept at all — none of those rows appear.
    expect(screen.queryByText('Voltage')).not.toBeInTheDocument();
    expect(screen.queryByText('Power')).not.toBeInTheDocument();
  });

  it('renders real metric values for a metered device', () => {
    useDeviceStore.setState({
      devices: [device('mtr_lo_red', 'L.O Red', 'meter', { branch_circuit: 'L.O Red' })],
      latestReadings: {
        mtr_lo_red: { device_id: 'mtr_lo_red', ts: new Date().toISOString(), online: true, state: null, voltage: 220.5, current: 3.7, power_w: 815, energy_kwh_today: 4.2 },
      },
    });
    render(<DevicesView />);
    expect(screen.getByText('Voltage')).toBeInTheDocument();
    expect(screen.getByText('815')).toBeInTheDocument();
  });

  it('gives meters a "metering" pill, not an "unknown" state badge', () => {
    useDeviceStore.setState({
      devices: [device('mtr_lo_red', 'L.O Red', 'meter')],
      latestReadings: { mtr_lo_red: { device_id: 'mtr_lo_red', ts: new Date().toISOString(), online: true, state: null, power_w: 800 } },
    });
    render(<DevicesView />);
    expect(screen.getByText('metering')).toBeInTheDocument();
    expect(screen.queryByText('unknown')).not.toBeInTheDocument();
  });

  it('gives a switchable device with no reading yet an "unknown" badge, not "metering"', () => {
    useDeviceStore.setState({ devices: [device('l3', 'Light 3', 'switch')] });
    render(<DevicesView />);
    expect(screen.getByText('unknown')).toBeInTheDocument();
  });

  it('renders both socket pills for a dual-socket outlet with independent states', () => {
    useDeviceStore.setState({
      devices: [device('co1', 'Outlet 1', 'outlet_dual', { sockets: ['CO1_1', 'CO1_2'] })],
      latestReadings: {
        co1: { device_id: 'co1', ts: new Date().toISOString(), online: true, state: 'on', socket_states: { 1: 'on', 2: 'off' } },
      },
    });
    render(<DevicesView />);
    // Shortened to S1/S2 (Phase L, matching the old dashboard's own labels) — the prior
    // "Socket 1"/"Socket 2" text was wrapping to two lines inside the pill, since the
    // bare label span had no white-space: nowrap and "Socket" alone was its min-content.
    expect(screen.getByText('S1')).toBeInTheDocument();
    expect(screen.getByText('S2')).toBeInTheDocument();
  });
});
