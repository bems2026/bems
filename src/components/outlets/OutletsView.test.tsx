import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { OutletsView } from './OutletsView';
import { useDeviceStore } from '@/stores/deviceStore';
import { useCommandStore } from '@/stores/commandStore';
import * as bridgeClient from '@/lib/bridgeClient';
import type { CommandAck, Device } from '@/lib/types';

vi.mock('@/lib/bridgeClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/bridgeClient')>();
  return { ...actual, sendCommand: vi.fn() };
});

const outlet = (n: number, extra: Partial<Device> = {}): Device => ({
  id: `co${n}`,
  display_name: `Outlet ${n}`,
  class: 'outlet_dual',
  room: null,
  dps_map: 'type_b',
  status: 'active',
  sockets: [`CO${n}_1`, `CO${n}_2`],
  branch_circuit: 'C.O Yellow',
  ...extra,
});

const light = (): Device => ({ id: 'l1', display_name: 'Light Switch 1', class: 'switch', room: null, dps_map: null, status: 'active' });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // restoreAllMocks only resets spies back to their original impl; the mocked
  // sendCommand here is a vi.fn() with no original impl to restore to, so its call
  // history survives restoreAllMocks and leaks into the next test without this.
  vi.clearAllMocks();
  useDeviceStore.setState({ devices: [], latestReadings: {}, totals: null, history: {} });
  useCommandStore.setState({ pending: {} });
});

describe('OutletsView', () => {
  it('shows skeletons before the catalogue loads', () => {
    render(<OutletsView />);
    expect(document.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
  });

  it('shows only outlet_dual devices, not other classes', () => {
    useDeviceStore.setState({ devices: [outlet(1), light()] });
    render(<OutletsView />);
    expect(screen.getByText('Outlet 1')).toBeInTheDocument();
    expect(screen.queryByText('Light Switch 1')).not.toBeInTheDocument();
  });

  it('renders S1/S2 toggles reflecting the feed state', () => {
    useDeviceStore.setState({
      devices: [outlet(1)],
      latestReadings: { co1: { device_id: 'co1', ts: new Date().toISOString(), online: true, state: 'on', socket_states: { 1: 'on', 2: 'off' } } },
    });
    render(<OutletsView />);
    const s1 = screen.getByRole('button', { name: /S1/ });
    const s2 = screen.getByRole('button', { name: /S2/ });
    expect(s1).toHaveAttribute('aria-pressed', 'true');
    expect(s2).toHaveAttribute('aria-pressed', 'false');
  });

  it('clicking a toggle sends the opposite of its current state and shows a busy pill while pending', async () => {
    let resolveSend!: (v: CommandAck) => void;
    vi.mocked(bridgeClient.sendCommand).mockImplementation(() => new Promise((resolve) => { resolveSend = resolve; }));

    useDeviceStore.setState({
      devices: [outlet(1)],
      latestReadings: { co1: { device_id: 'co1', ts: new Date().toISOString(), online: true, state: 'off', socket_states: { 1: 'off', 2: 'off' } } },
    });
    render(<OutletsView />);

    const s1 = screen.getByRole('button', { name: /S1/ });
    fireEvent.click(s1);

    expect(bridgeClient.sendCommand).toHaveBeenCalledWith(expect.objectContaining({ device_id: 'co1', socket: 1, action: 'on' }));
    await waitFor(() => expect(s1).toHaveAttribute('aria-busy', 'true'));
    expect(s1).toBeDisabled();

    resolveSend({ command_id: 'x', device_id: 'co1', socket: 1, action: 'on', target: 'CO1_1', accepted_at: '', confirmed: false, confirmation: 'none', note: '' });
  });

  it('shows a corroboration warning when both sockets are commanded off but the meter reads real power', () => {
    useDeviceStore.setState({
      devices: [outlet(1)],
      latestReadings: { co1: { device_id: 'co1', ts: new Date().toISOString(), online: true, state: 'off', power_w: 120, socket_states: { 1: 'off', 2: 'off' } } },
    });
    render(<OutletsView />);
    expect(screen.getByText(/check the physical relay/)).toBeInTheDocument();
  });

  it('shows no warning when commanded off and drawing ~0 — that is the expected case, not an error', () => {
    useDeviceStore.setState({
      devices: [outlet(1)],
      latestReadings: { co1: { device_id: 'co1', ts: new Date().toISOString(), online: true, state: 'off', power_w: 0, socket_states: { 1: 'off', 2: 'off' } } },
    });
    render(<OutletsView />);
    expect(screen.queryByText(/check the physical relay/)).not.toBeInTheDocument();
  });

  it('every card states the commanded-not-measured footnote', () => {
    useDeviceStore.setState({ devices: [outlet(1), outlet(2)] });
    render(<OutletsView />);
    expect(screen.getAllByText(/Relay state: commanded, not measured/).length).toBe(2);
  });

  it('"All Outlets Off" fans out to two commands per outlet', () => {
    vi.mocked(bridgeClient.sendCommand).mockResolvedValue({
      command_id: 'x', device_id: 'co1', socket: 1, action: 'off', target: 'CO1_1', accepted_at: '', confirmed: false, confirmation: 'none', note: '',
    });
    useDeviceStore.setState({ devices: [outlet(1), outlet(2), outlet(3)] });
    render(<OutletsView />);
    fireEvent.click(screen.getByRole('button', { name: /All Outlets Off/ }));
    expect(bridgeClient.sendCommand).toHaveBeenCalledTimes(6); // 3 outlets x 2 sockets
  });
});
