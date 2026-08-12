import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
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
    expect(screen.queryByText('Fleet Status')).not.toBeInTheDocument();
  });

  it('lists every device with its id and class pill', () => {
    useDeviceStore.setState({ devices: [device('co1', 'Outlet 1', 'outlet_dual'), device('l1', 'Light Switch 1', 'switch')] });
    render(<DevicesView />);
    expect(screen.getByText('Outlet 1')).toBeInTheDocument();
    expect(screen.getByText('co1')).toBeInTheDocument();
    expect(screen.getByText('Light Switch 1')).toBeInTheDocument();
  });

  it('never fabricates a 0 for a class that reports no such field — a switch shows — for volt/current/power', () => {
    useDeviceStore.setState({
      devices: [device('l1', 'Light Switch 1', 'switch')],
      latestReadings: { l1: { device_id: 'l1', ts: new Date().toISOString(), online: true, state: 'on' } },
    });
    render(<DevicesView />);
    const row = screen.getByText('Light Switch 1').closest('.devices-table__row');
    expect(row?.textContent).toContain('—');
    expect(row?.textContent).not.toMatch(/\b0V\b|\b0A\b|\b0W\b/);
  });

  it('renders real volt/current/power for a metered device', () => {
    useDeviceStore.setState({
      devices: [device('mtr_lo_red', 'L.O Red', 'meter', { branch_circuit: 'L.O Red' })],
      latestReadings: {
        mtr_lo_red: { device_id: 'mtr_lo_red', ts: new Date().toISOString(), online: true, state: null, voltage: 220.5, current: 3.7, power_w: 815 },
      },
    });
    render(<DevicesView />);
    expect(screen.getByText('220.5V')).toBeInTheDocument();
    expect(screen.getByText('3.70A')).toBeInTheDocument();
    expect(screen.getByText('815W')).toBeInTheDocument();
  });

  it('gives a meter a "metering" state, not an "unknown" badge', () => {
    useDeviceStore.setState({
      devices: [device('mtr_lo_red', 'L.O Red', 'meter')],
      latestReadings: { mtr_lo_red: { device_id: 'mtr_lo_red', ts: new Date().toISOString(), online: true, state: null, power_w: 800 } },
    });
    render(<DevicesView />);
    expect(screen.getByText('metering')).toBeInTheDocument();
  });

  it('gives a switchable device with no reading yet an "unknown" state', () => {
    useDeviceStore.setState({ devices: [device('l3', 'Light 3', 'switch')] });
    render(<DevicesView />);
    expect(screen.getByText('unknown')).toBeInTheDocument();
    expect(screen.getByText('NO DATA')).toBeInTheDocument();
  });

  it('flags a device the bridge reports offline as OFFLINE in the comm column', () => {
    useDeviceStore.setState({
      devices: [device('l1', 'Light Switch 1', 'switch')],
      latestReadings: { l1: { device_id: 'l1', ts: new Date().toISOString(), online: false, state: 'off' } },
    });
    render(<DevicesView />);
    expect(screen.getByText('OFFLINE')).toBeInTheDocument();
  });

  it('a class filter chip narrows the table to that class only', () => {
    useDeviceStore.setState({ devices: [device('co1', 'Outlet 1', 'outlet_dual'), device('l1', 'Light Switch 1', 'switch')] });
    render(<DevicesView />);
    fireEvent.click(screen.getByRole('button', { name: 'Outlets' }));
    expect(screen.getByText('Outlet 1')).toBeInTheDocument();
    expect(screen.queryByText('Light Switch 1')).not.toBeInTheDocument();
  });

  it('the fleet summary states a real online/total count, not a fabricated one', () => {
    useDeviceStore.setState({
      devices: [device('co1', 'Outlet 1', 'outlet_dual'), device('l1', 'Light Switch 1', 'switch')],
      latestReadings: { co1: { device_id: 'co1', ts: new Date().toISOString(), online: true, state: 'on' } },
    });
    render(<DevicesView />);
    expect(screen.getByText(/2 devices in the registry · 1\/2 reporting online right now/)).toBeInTheDocument();
  });
});
