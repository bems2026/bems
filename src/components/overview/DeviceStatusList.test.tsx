import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DeviceStatusList } from './DeviceStatusList';
import { useDeviceStore } from '@/stores/deviceStore';
import type { Device } from '@/lib/types';

const device = (id: string, display_name: string, deviceClass: Device['class']): Device => ({
  id,
  display_name,
  class: deviceClass,
  room: null,
  dps_map: null,
  status: 'active',
});

afterEach(() => {
  cleanup();
  useDeviceStore.setState({ devices: [], latestReadings: {}, totals: null, history: {} });
});

describe('DeviceStatusList', () => {
  it('shows a real on/off badge for switchable devices', () => {
    useDeviceStore.setState({
      devices: [device('co3', 'Outlet 3', 'outlet_dual')],
      latestReadings: { co3: { device_id: 'co3', ts: new Date().toISOString(), online: true, state: 'on', power_w: 100 } },
    });
    render(<DeviceStatusList />);
    expect(screen.getByText('on')).toBeInTheDocument();
    expect(screen.queryByText('metering')).not.toBeInTheDocument();
  });

  it('shows "metering" rather than an "unknown" state badge for meters — they have no state concept at all', () => {
    useDeviceStore.setState({
      devices: [device('mtr_lo_red', 'L.O Red', 'meter')],
      latestReadings: { mtr_lo_red: { device_id: 'mtr_lo_red', ts: new Date().toISOString(), online: true, state: null, power_w: 800 } },
    });
    render(<DeviceStatusList />);
    expect(screen.getByText('metering')).toBeInTheDocument();
    expect(screen.queryByText('unknown')).not.toBeInTheDocument();
  });

  it('shows "unknown" (not "metering") for a switchable device with no reading yet', () => {
    useDeviceStore.setState({ devices: [device('l3', 'Light 3', 'switch')] });
    render(<DeviceStatusList />);
    expect(screen.getByText('unknown')).toBeInTheDocument();
  });

  it('shows skeletons before the catalogue loads', () => {
    render(<DeviceStatusList />);
    expect(document.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
  });

  it('shows a preview of the first 8 devices plus a "View all" link once more than 8 are loaded', () => {
    useDeviceStore.setState({
      devices: Array.from({ length: 12 }, (_, i) => device(`co${i}`, `Outlet ${i}`, 'outlet_dual')),
    });
    render(<DeviceStatusList />);
    expect(screen.getAllByText(/^Outlet/).length).toBe(8);
    expect(screen.getByText('View all 12 devices →')).toBeInTheDocument();
  });

  it('shows no "View all" link when everything already fits in the preview', () => {
    useDeviceStore.setState({ devices: [device('l1', 'Light 1', 'switch')] });
    render(<DeviceStatusList />);
    expect(screen.queryByText(/View all/)).not.toBeInTheDocument();
  });
});
