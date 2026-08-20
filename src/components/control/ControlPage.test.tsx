import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { ControlPage } from './ControlPage';
import { useDeviceStore } from '@/stores/deviceStore';
import { useCommandStore } from '@/stores/commandStore';
import { useCapabilitiesStore } from '@/stores/capabilitiesStore';
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
  useCapabilitiesStore.setState({ hardwareDispatchEnabled: null, dispatchClasses: null });
  useControlLog.setState({ entries: [] });
});

describe('ControlPage', () => {
  it('shows the dispatch-closed banner while capabilities are unknown, not just while explicitly false', () => {
    useDeviceStore.setState({ devices: [light(1)] });
    render(<ControlPage />);
    expect(screen.getByText(/Hardware dispatch is closed/)).toBeInTheDocument();
  });

  it('keeps showing the banner when the gate is confirmed closed', () => {
    useCapabilitiesStore.setState({ hardwareDispatchEnabled: false, dispatchClasses: [] });
    useDeviceStore.setState({ devices: [light(1)] });
    render(<ControlPage />);
    expect(screen.getByText(/Hardware dispatch is closed/)).toBeInTheDocument();
  });

  it('stops claiming dispatch is closed once the gate is confirmed open', () => {
    useCapabilitiesStore.setState({ hardwareDispatchEnabled: true, dispatchClasses: ['switch'] });
    useDeviceStore.setState({ devices: [light(1)] });
    render(<ControlPage />);
    expect(screen.queryByText(/Hardware dispatch is closed/)).not.toBeInTheDocument();
    expect(screen.getByText(/switches real hardware/)).toBeInTheDocument();
  });

  // The regression this whole feature exists to prevent: the banner used to be a single
  // boolean, so opening the gate made it vanish entirely — silently implying outlets and the
  // ACU had gone live too, when server/proxy.mjs only ever dispatches `switch` commands.
  it('names what is live AND what only looks live when the gate is open but lights are the only class that dispatches', () => {
    useCapabilitiesStore.setState({ hardwareDispatchEnabled: true, dispatchClasses: ['switch'] });
    useDeviceStore.setState({ devices: [light(1), outlet(1), acu()] });
    render(<ControlPage />);
    const banner = document.querySelector('.control-dispatch-banner') as HTMLElement;
    expect(banner).toHaveTextContent(/Lighting now switches real hardware/);
    expect(banner).toHaveTextContent(/Outlets and the ACU are validated and audit-logged only/);
  });

  it('flags the outlets and ACU cards themselves, not just the page banner — the banner is easy to scroll past', () => {
    useCapabilitiesStore.setState({ hardwareDispatchEnabled: true, dispatchClasses: ['switch'] });
    useDeviceStore.setState({ devices: [light(1), outlet(1), acu()] });
    render(<ControlPage />);
    const outletsCard = screen.getByText('Outlets').closest('.control-list-card') as HTMLElement;
    expect(within(outletsCard).getByText(/not dispatched/i)).toBeInTheDocument();
    const irCard = screen.getByText('IR AIRCON').closest('.control-ir-card') as HTMLElement;
    expect(within(irCard).getByText(/not dispatched/i)).toBeInTheDocument();
  });

  it('adds no per-card flags while the gate is fully closed — the page banner already says nothing dispatches, and repeating it on every card is noise', () => {
    useCapabilitiesStore.setState({ hardwareDispatchEnabled: false, dispatchClasses: [] });
    useDeviceStore.setState({ devices: [light(1), outlet(1), acu()] });
    render(<ControlPage />);
    expect(screen.queryByText(/not dispatched/i)).not.toBeInTheDocument();
  });

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

  it('the IR command center sends a one-shot command, never a toggle, for the real ACU device — gated behind a confirmation', () => {
    vi.mocked(bridgeClient.sendCommand).mockResolvedValue(ack({ device_id: 'acu_main', target: 'AC_POWER' }));
    useDeviceStore.setState({ devices: [acu()] });
    render(<ControlPage />);
    fireEvent.click(screen.getByRole('button', { name: /Send ON at/ }));
    expect(bridgeClient.sendCommand).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Yes, send/ }));
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

  it('a stale (offline) switch cannot be toggled and is visibly flagged, instead of looking identical to a live one', () => {
    vi.mocked(bridgeClient.sendCommand).mockResolvedValue(ack({ device_id: 'l1', target: 'L1', action: 'on' }));
    useDeviceStore.setState({
      devices: [light(1)],
      latestReadings: { l1: { device_id: 'l1', ts: new Date().toISOString(), online: false, state: 'off' } },
    });
    render(<ControlPage />);
    const row = screen.getByText('Light Switch 1').closest('.control-list-row') as HTMLElement;
    expect(within(row).getByRole('switch')).toBeDisabled();
    expect(within(row).getByText('stale')).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('switch'));
    expect(bridgeClient.sendCommand).not.toHaveBeenCalled();
  });

  it('a stale (offline) outlet socket cannot be toggled from the sockets list', () => {
    vi.mocked(bridgeClient.sendCommand).mockResolvedValue(ack());
    useDeviceStore.setState({
      devices: [outlet(1)],
      latestReadings: { co1: { device_id: 'co1', ts: new Date().toISOString(), online: false, state: 'off', socket_states: { 1: 'off', 2: 'off' } } },
    });
    render(<ControlPage />);
    const row = screen.getByText('Outlet 1').closest('.control-list-row') as HTMLElement;
    const s1 = within(row).getAllByRole('button')[0];
    expect(s1).toBeDisabled();
    fireEvent.click(s1);
    expect(bridgeClient.sendCommand).not.toHaveBeenCalled();
  });

  it('every dispatched command is recorded in the command log', async () => {
    vi.mocked(bridgeClient.sendCommand).mockResolvedValue(ack({ device_id: 'acu_main', target: 'AC_POWER' }));
    useDeviceStore.setState({ devices: [acu()] });
    render(<ControlPage />);
    expect(screen.getAllByText('No commands sent this session').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Send OFF' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, send OFF' }));
    await waitFor(() => expect(screen.getByText('IR')).toBeInTheDocument());
  });

  it('the outlet plan\'s DP1/DP2 puck toggles a single socket directly — ungated, like every other single-device control', () => {
    vi.mocked(bridgeClient.sendCommand).mockResolvedValue(ack({ device_id: 'co1', socket: 1, action: 'on' }));
    useDeviceStore.setState({
      devices: [outlet(1)],
      latestReadings: { co1: { device_id: 'co1', ts: new Date().toISOString(), online: true, state: 'off', socket_states: { 1: 'off', 2: 'off' } } },
    });
    render(<ControlPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Outlet 1 DP1' }));
    expect(bridgeClient.sendCommand).toHaveBeenCalledWith(expect.objectContaining({ device_id: 'co1', socket: 1, action: 'on' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('"All outlets off" in the plan panel is gated and fans out to both sockets on every outlet', async () => {
    vi.mocked(bridgeClient.sendCommand).mockResolvedValue(ack());
    useDeviceStore.setState({ devices: [outlet(1), outlet(2)] });
    render(<ControlPage />);
    fireEvent.click(screen.getByRole('button', { name: 'All outlets off' }));
    expect(bridgeClient.sendCommand).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Turn outlets off' }));
    await waitFor(() => expect(bridgeClient.sendCommand).toHaveBeenCalledTimes(4)); // 2 outlets x 2 sockets
  });
});

// ---------------------------------------------------------------------------
// ACU setpoint.
//
// The aircon takes an IR code, not a relay state, so "on" alone cannot say what to turn it on
// to. Before this the card could only ever send whatever temperature the retired dashboard
// switch happened to use.
// ---------------------------------------------------------------------------

describe('ACU setpoint', () => {
  it('offers exactly the degrees the IR library has codes for, and nothing outside them', () => {
    useDeviceStore.setState({ devices: [acu()] });
    render(<ControlPage />);
    const select = screen.getByLabelText('SETPOINT') as HTMLSelectElement;
    const values = [...select.options].map((o) => Number(o.value));
    expect(values[0]).toBe(16);
    expect(values[values.length - 1]).toBe(30);
    expect(values).toHaveLength(15);
  });

  it('sends the chosen setpoint with the command', () => {
    vi.mocked(bridgeClient.sendCommand).mockResolvedValue(ack({ device_id: 'acu_main', target: 'AC_POWER' }));
    useDeviceStore.setState({ devices: [acu()] });
    render(<ControlPage />);
    fireEvent.change(screen.getByLabelText('SETPOINT'), { target: { value: '19' } });
    fireEvent.click(screen.getByRole('button', { name: /Send ON at 19/ }));
    fireEvent.click(screen.getByRole('button', { name: /Yes, send 19/ }));
    expect(bridgeClient.sendCommand).toHaveBeenCalledWith(expect.objectContaining({ device_id: 'acu_main', action: 'on', target_c: 19 }));
  });

  it('sends no setpoint with an off command — off is a code of its own, not a temperature', () => {
    vi.mocked(bridgeClient.sendCommand).mockResolvedValue(ack({ device_id: 'acu_main', target: 'AC_POWER' }));
    useDeviceStore.setState({ devices: [acu()] });
    render(<ControlPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Send OFF' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, send OFF' }));
    const sent = vi.mocked(bridgeClient.sendCommand).mock.calls[0][0];
    expect(sent.action).toBe('off');
    expect(sent.target_c).toBeUndefined();
  });

  it('names the temperature in the confirmation, so nobody confirms a setpoint they cannot see', () => {
    useDeviceStore.setState({ devices: [acu()] });
    render(<ControlPage />);
    fireEvent.change(screen.getByLabelText('SETPOINT'), { target: { value: '28' } });
    fireEvent.click(screen.getByRole('button', { name: /Send ON at 28/ }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/28°C/);
  });

  it('opens at the ACU\'s last known setpoint rather than a fixed guess', () => {
    useDeviceStore.setState({
      devices: [acu()],
      latestReadings: { acu_main: { device_id: 'acu_main', ts: new Date().toISOString(), online: true, state: 'on', setpoint_c: 21 } },
    });
    render(<ControlPage />);
    expect((screen.getByLabelText('SETPOINT') as HTMLSelectElement).value).toBe('21');
  });
});
