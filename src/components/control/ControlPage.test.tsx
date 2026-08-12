import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { ControlPage } from './ControlPage';
import { useDeviceStore } from '@/stores/deviceStore';
import { useCommandStore } from '@/stores/commandStore';
import { useControlLog } from './controlLog';
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

const light = (n: number): Device => ({ id: `l${n}`, display_name: `Light Switch ${n}`, class: 'switch', room: null, dps_map: null, status: 'active' });

const acu = (): Device => ({ id: 'acu_main', display_name: 'Aircon', class: 'acu_ir', room: null, dps_map: null, status: 'active' });

const ack = (over: Partial<CommandAck> = {}): CommandAck => ({
  command_id: 'x',
  device_id: 'co1',
  action: 'off',
  target: 'CO1_1',
  accepted_at: '',
  confirmed: false,
  confirmation: 'none',
  note: '',
  ...over,
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  useDeviceStore.setState({ devices: [], latestReadings: {}, totals: null, history: {} });
  useCommandStore.setState({ pending: {} });
  useControlLog.setState({ entries: [] });
});

describe('ControlPage', () => {
  it('renders the real registry devices across the switches and outlets lists', () => {
    useDeviceStore.setState({ devices: [outlet(1), light(1), acu()] });
    render(<ControlPage />);
    expect(screen.getByText('Outlet 1')).toBeInTheDocument();
    expect(screen.getByText('Light Switch 1')).toBeInTheDocument();
    expect(screen.getByText('CARE ACU')).toBeInTheDocument();
  });

  it('a master action is gated behind a confirmation modal, not fired on the first click', () => {
    useDeviceStore.setState({ devices: [light(1)] });
    render(<ControlPage />);
    fireEvent.click(screen.getByRole('button', { name: /Lights off/ }));
    expect(bridgeClient.sendCommand).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('confirming "Outlets off" fans out to both sockets on every outlet', async () => {
    vi.mocked(bridgeClient.sendCommand).mockResolvedValue(ack());
    useDeviceStore.setState({ devices: [outlet(1), outlet(2)] });
    render(<ControlPage />);
    fireEvent.click(screen.getByRole('button', { name: /Outlets off/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Turn outlets off' }));
    await waitFor(() => expect(bridgeClient.sendCommand).toHaveBeenCalledTimes(4)); // 2 outlets x 2 sockets
  });

  it('cancelling the confirmation sends nothing', () => {
    useDeviceStore.setState({ devices: [outlet(1)] });
    render(<ControlPage />);
    fireEvent.click(screen.getByRole('button', { name: /Outlets off/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(bridgeClient.sendCommand).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('the IR command center sends a one-shot command, never a toggle, for the real ACU device', () => {
    vi.mocked(bridgeClient.sendCommand).mockResolvedValue(ack({ device_id: 'acu_main', target: 'AC_POWER' }));
    useDeviceStore.setState({ devices: [acu()] });
    render(<ControlPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Send ON command' }));
    expect(bridgeClient.sendCommand).toHaveBeenCalledWith(expect.objectContaining({ device_id: 'acu_main', action: 'on' }));
  });

  it('a switch toggle in the switches list sends the opposite of its current state', () => {
    vi.mocked(bridgeClient.sendCommand).mockResolvedValue(ack({ device_id: 'l1', target: 'L1', action: 'on' }));
    useDeviceStore.setState({
      devices: [light(1)],
      latestReadings: { l1: { device_id: 'l1', ts: new Date().toISOString(), online: true, state: 'off' } },
    });
    render(<ControlPage />);
    const row = screen.getByText('Light Switch 1').closest('.control-list-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('switch'));
    expect(bridgeClient.sendCommand).toHaveBeenCalledWith(expect.objectContaining({ device_id: 'l1', action: 'on' }));
  });

  it('every dispatched command is recorded in the command log', async () => {
    vi.mocked(bridgeClient.sendCommand).mockResolvedValue(ack({ device_id: 'acu_main', target: 'AC_POWER' }));
    useDeviceStore.setState({ devices: [acu()] });
    render(<ControlPage />);
    expect(screen.getAllByText('No commands sent this session').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Send OFF command' }));
    await waitFor(() => expect(screen.getByText('IR')).toBeInTheDocument());
  });
});
