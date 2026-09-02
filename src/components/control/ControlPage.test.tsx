import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { ControlPage } from './ControlPage';
import { useDeviceStore } from '@/stores/deviceStore';
import { useCommandStore } from '@/stores/commandStore';
import { useCapabilitiesStore } from '@/stores/capabilitiesStore';
import { useSiteUiStore } from '@/stores/siteUiStore';
import { useSpaceTreeStore } from '@/stores/spaceTreeStore';
import { useDeviceConfigStore } from '@/stores/deviceConfigStore';
import { emptyDeviceConfig } from '@/lib/deviceConfig';
import { useControlLog } from './controlLog';
import * as bridgeClient from '@/lib/bridgeClient';
import type { CommandAck, Device } from '@/lib/types';
import { setpointOptions } from './setpointOptions';
import { SITE, DEVICE_REGISTRY } from '@shared/registry.mjs';
import { validateCommand } from '@shared/commands.mjs';

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
  useSpaceTreeStore.setState({ nodes: [], status: 'ready', canEdit: false, mutating: false, error: null });
  useDeviceConfigStore.setState({ saved: {}, draft: {} });
  useCommandStore.setState({ pending: {} });
  useCapabilitiesStore.setState({ hardwareDispatchEnabled: null, dispatchClasses: null });
  useControlLog.setState({ entries: [] });
  // Back to visible, which is both the default and what every test above assumes. A leaked
  // `false` here would hide the plan for an unrelated test and read as a missing card.
  useSiteUiStore.setState({ prefs: { controlPlanCard: true, overviewSceneCard: true } });
});

describe('ControlPage', () => {
  // The page-level dispatch banner was removed on 2026-08-25: on a fully-dispatching site it
  // only ever read "everything is live" — a paragraph announcing the absence of a problem. The
  // same fact now rides on the card it applies to, which also covers the state the banner used
  // to own alone: a fully closed gate, where every card is flagged rather than none.
  it("marks every commandable card as not-dispatched while capabilities are still unknown", () => {
    useDeviceStore.setState({ devices: [light(1), outlet(1), acu()] });
    render(<ControlPage />);
    expect(screen.getAllByText(/not dispatched/i)).toHaveLength(3);
  });

  it("keeps marking every card when the gate is confirmed closed", () => {
    useCapabilitiesStore.setState({ hardwareDispatchEnabled: false, dispatchClasses: [] });
    useDeviceStore.setState({ devices: [light(1), outlet(1), acu()] });
    render(<ControlPage />);
    expect(screen.getAllByText(/not dispatched/i)).toHaveLength(3);
  });

  // The regression the scope split exists to prevent: a binary signal would vanish the moment
  // the gate opened, silently implying outlets and the ACU had gone live with the lights.
  it("flags only the classes that do not dispatch when the gate is partly open", () => {
    useCapabilitiesStore.setState({ hardwareDispatchEnabled: true, dispatchClasses: ["switch"] });
    useDeviceStore.setState({ devices: [light(1), outlet(1), acu()] });
    render(<ControlPage />);
    const outletsCard = screen.getByText("Outlets").closest(".control-list-card") as HTMLElement;
    expect(within(outletsCard).getByText(/not dispatched/i)).toBeInTheDocument();
    const irCard = screen.getByText("IR AIRCON").closest(".control-ir-card") as HTMLElement;
    expect(within(irCard).getByText(/not dispatched/i)).toBeInTheDocument();
    const lightsCard = screen.getByText("Lighting switches").closest(".control-list-card") as HTMLElement;
    expect(within(lightsCard).queryByText(/not dispatched/i)).not.toBeInTheDocument();
  });

  it("says nothing at all once every class dispatches — silence is the right signal for all-live", () => {
    useCapabilitiesStore.setState({ hardwareDispatchEnabled: true, dispatchClasses: ["switch", "outlet_dual", "acu_ir"] });
    useDeviceStore.setState({ devices: [light(1), outlet(1), acu()] });
    render(<ControlPage />);
    expect(screen.queryByText(/not dispatched/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/switches real hardware/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Hardware dispatch/)).not.toBeInTheDocument();
  });

  it('renders the real registry devices across the switches and outlets lists', () => {
    useDeviceStore.setState({ devices: [outlet(1), light(1), acu()] });
    render(<ControlPage />);
    expect(screen.getByText('Outlet 1')).toBeInTheDocument();
    expect(screen.getByText('Light Switch 1')).toBeInTheDocument();
    // The device's OWN display name, not a label typed into the card. Until FI-016 the card
    // rendered the literal "CARE ACU" while the registry called this device "Aircon" — the
    // control was labelled with a name that disagreed with the thing it commands.
    expect(screen.getByText(acu().display_name)).toBeInTheDocument();
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

  /**
   * The other half of EX-017, finished. That change removed `stale` from `disabled=` on the
   * reasoning that telemetry comes FROM a device while a command goes TO it — but it left
   * `if (busy || unknown || stale) return;` in the click handlers of both light controls. The
   * button therefore rendered enabled and the click did nothing, silently, which is worse than
   * a disabled control: a disabled one at least says it will not work.
   *
   * Only `online: false` refuses, and it refuses at the button, where it is visible.
   */
  it('a switch the bridge still reports online can be toggled even when its reading has gone stale', () => {
    vi.mocked(bridgeClient.sendCommand).mockResolvedValue(ack({ device_id: 'l1', target: 'L1', action: 'on' }));
    useDeviceStore.setState({
      devices: [light(1)],
      latestReadings: { l1: { device_id: 'l1', ts: new Date(Date.now() - 120_000).toISOString(), online: true, state: 'off' } },
    });
    render(<ControlPage />);
    const row = screen.getByText('Light Switch 1').closest('.control-list-row') as HTMLElement;
    const toggle = within(row).getByRole('switch');
    expect(toggle).not.toBeDisabled();
    fireEvent.click(toggle);
    expect(bridgeClient.sendCommand).toHaveBeenCalledWith(expect.objectContaining({ device_id: 'l1', action: 'on' }));
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

  it('the outlet plan\'s DP1/DP2 puck toggles a single socket directly — ungated, like every other single-device control', async () => {
    vi.mocked(bridgeClient.sendCommand).mockResolvedValue(ack({ device_id: 'co1', socket: 1, action: 'on' }));
    useDeviceStore.setState({
      devices: [outlet(1)],
      latestReadings: { co1: { device_id: 'co1', ts: new Date().toISOString(), online: true, state: 'off', socket_states: { 1: 'off', 2: 'off' } } },
    });
    // The plan is DRAWN DATA now, not a build-time pack (RM-044): the puck exists because a
    // room has this outlet placed in it, and at a site where nothing is drawn it never appears —
    // the same outlet is then commanded from `OutletsListCard`, which this file covers
    // separately. Seeded here rather than awaited, because there is no import left to resolve.
    useSpaceTreeStore.setState({
      nodes: [{ id: 'room', site_id: 's', parent_id: null, kind: 'room', name: 'Office', sort_order: 0, attrs: {} }],
      status: 'ready', canEdit: true, mutating: false, error: null,
    });
    useDeviceConfigStore.setState({
      saved: { co1: { ...emptyDeviceConfig('co1'), spaceNodeId: 'room', planX: 0.5, planY: 0.5 } },
    });
    render(<ControlPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Outlet 1 DP1' }));
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
  it('offers the IR library range narrowed by this site policy floor, and nothing outside it', () => {
    // RM-027: the ceiling is what the IR library has codes for, the floor is the operator's
    // rule. Read from SITE rather than hardcoded, so a site with a different policy - or none -
    // does not have to rewrite this test in order to add itself.
    useDeviceStore.setState({ devices: [acu()] });
    render(<ControlPage />);
    const select = screen.getByLabelText('SETPOINT') as HTMLSelectElement;
    const values = [...select.options].map((o) => Number(o.value));
    expect(values).toEqual(setpointOptions(SITE.policy.acu_min_setpoint_c));
    expect(values[values.length - 1]).toBe(30);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(16);
  });

  it('offers nothing the server would refuse - every option survives validateCommand', () => {
    // This is the whole reason for narrowing the list. A selectable option that comes back as
    // a 400 reads as a bug rather than as a policy, so assert the two agree by construction
    // rather than by both having been edited on the same day.
    useDeviceStore.setState({ devices: [acu()] });
    render(<ControlPage />);
    const select = screen.getByLabelText('SETPOINT') as HTMLSelectElement;
    for (const opt of [...select.options]) {
      const r = validateCommand(
        { device_id: 'acu_main', action: 'on', target_c: Number(opt.value) },
        DEVICE_REGISTRY,
        SITE.policy,
      );
      expect(r.ok, `setpoint ${opt.value} is offered but refused as ${r.code}`).toBe(true);
    }
  });

  it('sends the chosen setpoint with the command', () => {
    vi.mocked(bridgeClient.sendCommand).mockResolvedValue(ack({ device_id: 'acu_main', target: 'AC_POWER' }));
    useDeviceStore.setState({ devices: [acu()] });
    render(<ControlPage />);
    // 27, not 19: this site's policy floor is 25, so 19 is no longer offered. The assertion
    // is that the CHOSEN value reaches the command, which any offered value proves equally.
    fireEvent.change(screen.getByLabelText('SETPOINT'), { target: { value: '27' } });
    fireEvent.click(screen.getByRole('button', { name: /Send ON at 27/ }));
    fireEvent.click(screen.getByRole('button', { name: /Yes, send 27/ }));
    expect(bridgeClient.sendCommand).toHaveBeenCalledWith(expect.objectContaining({ device_id: 'acu_main', action: 'on', target_c: 27 }));
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
      latestReadings: { acu_main: { device_id: 'acu_main', ts: new Date().toISOString(), online: true, state: 'on', setpoint_c: 27 } },
    });
    render(<ControlPage />);
    expect((screen.getByLabelText('SETPOINT') as HTMLSelectElement).value).toBe('27');
  });

  it('does not open at a last known setpoint the policy forbids', () => {
    // RM-027, and a real state rather than a hypothetical: the unit can be sitting below the
    // floor because someone used the physical remote, or because it was set before the policy
    // existed. Seeding there would preselect a value the server refuses, so the operator's
    // first click would fail for no visible reason.
    useDeviceStore.setState({
      devices: [acu()],
      latestReadings: { acu_main: { device_id: 'acu_main', ts: new Date().toISOString(), online: true, state: 'on', setpoint_c: 21 } },
    });
    render(<ControlPage />);
    const value = Number((screen.getByLabelText('SETPOINT') as HTMLSelectElement).value);
    expect(value).toBeGreaterThanOrEqual(SITE.policy.acu_min_setpoint_c ?? 16);
  });
});

/**
 * RM-035 — the plan card can be turned off, and turning it off must never turn off a control.
 *
 * The plan is a picture of a building, drawn from a pack surveyed in one office. A site whose
 * room does not match needs to be able to hide it. But every lamp and socket on that plan is
 * also in the Lighting switches and Outlets lists, driving the same `commandStore.send` — so
 * hiding it removes a diagram and nothing else.
 *
 * This is the property most worth pinning, because the failure would be quiet and serious: a
 * refactor that moved a control inside the hidden block would leave an operator unable to switch
 * a relay, with nothing on screen explaining why, and every other test still green.
 */
describe('the plan card is optional, the controls are not', () => {
  const bothOn = () => {
    useDeviceStore.setState({
      devices: [light(1), outlet(1)],
      latestReadings: {
        l1: { device_id: 'l1', ts: new Date().toISOString(), online: true, state: 'off' },
        co1: { device_id: 'co1', ts: new Date().toISOString(), online: true, state: 'off', socket_states: { 1: 'off', 2: 'off' } },
      },
    });
  };

  it('shows the plan by default, because an existing deployment must look unchanged', () => {
    useSiteUiStore.setState({ prefs: { controlPlanCard: true, overviewSceneCard: true } });
    bothOn();
    render(<ControlPage />);
    expect(screen.getByText('Lighting & outlet plan')).toBeInTheDocument();
  });

  it('hides the plan when the site turns it off', () => {
    useSiteUiStore.setState({ prefs: { controlPlanCard: false, overviewSceneCard: true } });
    bothOn();
    render(<ControlPage />);
    expect(screen.queryByText('Lighting & outlet plan')).not.toBeInTheDocument();
  });

  it('still switches a light with the plan hidden — the list toggle dispatches as it always did', () => {
    vi.mocked(bridgeClient.sendCommand).mockResolvedValue(ack({ device_id: 'l1', target: 'L1', action: 'on' }));
    useSiteUiStore.setState({ prefs: { controlPlanCard: false, overviewSceneCard: true } });
    bothOn();
    render(<ControlPage />);
    const row = screen.getByText('Light Switch 1').closest('.control-list-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('switch'));
    expect(bridgeClient.sendCommand).toHaveBeenCalledWith(expect.objectContaining({ device_id: 'l1', action: 'on' }));
  });

  it('still switches an outlet socket with the plan hidden', () => {
    vi.mocked(bridgeClient.sendCommand).mockResolvedValue(ack({ device_id: 'co1', socket: 1, action: 'on' }));
    useSiteUiStore.setState({ prefs: { controlPlanCard: false, overviewSceneCard: true } });
    bothOn();
    render(<ControlPage />);
    const row = screen.getByText('Outlet 1').closest('.control-list-row') as HTMLElement;
    fireEvent.click(within(row).getAllByRole('button')[0]);
    expect(bridgeClient.sendCommand).toHaveBeenCalledWith(expect.objectContaining({ device_id: 'co1', socket: 1, action: 'on' }));
  });

  it('leaves the master actions working, since they never read the plan at all', () => {
    // "Lights off" acts on page membership, not on what is drawn. Worth pinning: an operator
    // who has hidden the plan has not asked to lose the one action that switches everything.
    vi.mocked(bridgeClient.sendCommand).mockResolvedValue(ack({ device_id: 'l1', target: 'L1', action: 'off' }));
    useSiteUiStore.setState({ prefs: { controlPlanCard: false, overviewSceneCard: true } });
    bothOn();
    render(<ControlPage />);
    fireEvent.click(screen.getByRole('button', { name: /Lights off/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Turn lights off' }));
    expect(bridgeClient.sendCommand).toHaveBeenCalledWith(expect.objectContaining({ device_id: 'l1', action: 'off' }));
  });

  it('a device excluded from control gets no toggle anywhere on the page, not just no master action', () => {
    // `device_config.functions` is a SITE decision about which page a device belongs on. Only
    // ControlPage's master actions used to honour it, so a device an operator had deliberately
    // excluded was left out of "Lights off" and then handed its own toggle in the list below —
    // the one place the exclusion mattered most.
    useDeviceStore.setState({ devices: [light(1), light(2), outlet(1)] });
    useDeviceConfigStore.setState({
      saved: { l2: { ...emptyDeviceConfig('l2'), functions: [] } },
      draft: {},
    });
    render(<ControlPage />);

    expect(screen.getAllByRole('switch', { name: 'Light Switch 1' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('switch', { name: 'Light Switch 2' })).not.toBeInTheDocument();
    expect(screen.queryByText('Light Switch 2')).not.toBeInTheDocument();
  });

  it('a device with no config recorded still appears — absent is not excluded', () => {
    // `null` functions means "nobody has said", which falls back to the class default. Treating
    // that as an exclusion would empty the page on a site that has never opened the editor.
    useDeviceStore.setState({ devices: [light(1)] });
    useDeviceConfigStore.setState({ saved: {}, draft: {} });
    render(<ControlPage />);
    expect(screen.getAllByRole('switch', { name: 'Light Switch 1' }).length).toBeGreaterThan(0);
  });

});
