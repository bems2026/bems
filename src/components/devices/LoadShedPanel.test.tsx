import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { LoadShedPanel } from './LoadShedPanel';
import { useDeviceStore } from '@/stores/deviceStore';
import { useDeviceConfigStore } from '@/stores/deviceConfigStore';
import { useSocketConfigStore } from '@/stores/socketConfigStore';
import { useCapabilitiesStore } from '@/stores/capabilitiesStore';
import { emptyDeviceConfig } from '@/lib/deviceConfig';
import type { Device, DeviceClass, Reading } from '@/lib/types';

const save = vi.fn();
const setDraftField = vi.fn();
const setSocketTier = vi.fn();

/** Ids this build has never seen, so nothing here passes because of one building's names.
 *
 * An `outlet_dual` carries a real `sockets` pair, as every registry entry does: since RM-060
 * the socket list is what says how many relays a device has, and a fixture without one would
 * be testing a device that cannot exist. */
const dev = (id: string, cls: DeviceClass = 'switch'): Device =>
  ({
    id,
    display_name: id.toUpperCase(),
    class: cls,
    room: null,
    dps_map: null,
    status: 'active',
    ...(cls === 'outlet_dual' ? { sockets: [`${id.toUpperCase()}_1`, `${id.toUpperCase()}_2`] } : {}),
  }) as Device;
const on = (id: string): Reading => ({ device_id: id, ts: new Date().toISOString(), online: true, state: 'on' });
/** An outlet reading with per-socket measured state — what `buildLatest` emits for a dual outlet. */
const sockets = (id: string, s1: 'on' | 'off', s2: 'on' | 'off'): Reading =>
  ({ device_id: id, ts: new Date().toISOString(), online: true, state: s1 === 'on' || s2 === 'on' ? 'on' : 'off', socket_states: { 1: s1, 2: s2 } }) as Reading;

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  save.mockResolvedValue(undefined);
  useDeviceStore.setState({ devices: [], latestReadings: {}, totals: null, history: {} });
  useDeviceConfigStore.setState({ saved: {}, draft: {}, status: 'ready', saveStatus: 'idle', saveError: null, lastSave: null, save, setDraftField });
  useCapabilitiesStore.setState({ dispatchClasses: ['switch', 'outlet_dual'] });
  useSocketConfigStore.setState({ saved: {}, status: 'ready', busy: {}, rowError: {}, setTier: setSocketTier });
});

describe('LoadShedPanel', () => {
  it('offers a tier for every relay — one per SOCKET on a dual outlet', () => {
    // RM-060: an outlet is two relays behind one label, and one may be a fridge while the other
    // is a kettle. A single control for both was a limitation of where the tier was stored.
    useDeviceStore.setState({ devices: [dev('sw-a'), dev('plug-b', 'outlet_dual')] });
    render(<LoadShedPanel onClose={() => {}} />);
    expect(screen.getByLabelText(/tier for SW-A/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/tier for PLUG-B · S1/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/tier for PLUG-B · S2/i)).toBeInTheDocument();
  });

  it('does not offer a tier for the aircon, and says why', () => {
    // The largest controllable load in this building is the aircon, and it has no relay. Leaving
    // it silently out of a shed list reads as an oversight; leaving it in would be a lie.
    useDeviceStore.setState({ devices: [dev('cooler', 'acu_ir')] });
    render(<LoadShedPanel onClose={() => {}} />);
    expect(screen.queryByLabelText(/tier for COOLER/i)).not.toBeInTheDocument();
    expect(screen.getByText(/cannot be shed at all/i)).toBeInTheDocument();
    expect(screen.getByText(/never relay-cut/i)).toBeInTheDocument();
  });

  it('saves a tier as soon as it is chosen', () => {
    // A tier is one choice from a fixed list, not a half-typed field. Staging it behind a Save
    // button would leave the panel showing one thing while the shedder would do another.
    useDeviceStore.setState({ devices: [dev('sw-a')] });
    render(<LoadShedPanel onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/tier for SW-A/i), { target: { value: 'group_1' } });
    expect(setDraftField).toHaveBeenCalledWith('sw-a', 'loadShedGroup', 'group_1');
    expect(save).toHaveBeenCalledWith('sw-a');
  });

  it('counts what would actually act, not just what carries a tier', async () => {
    // `shedPlan` switches a device only if it is assigned, dispatchable AND on. A panel showing
    // only the first would let somebody assign tiers to a fleet that cannot be commanded and
    // believe the building was protected.
    useDeviceStore.setState({ devices: [dev('sw-a'), dev('sw-b')], latestReadings: { 'sw-a': on('sw-a') } });
    useDeviceConfigStore.setState({
      saved: {
        'sw-a': { ...emptyDeviceConfig('sw-a'), loadShedGroup: 'group_1' },
        'sw-b': { ...emptyDeviceConfig('sw-b'), loadShedGroup: 'group_1' },
      },
    });
    render(<LoadShedPanel onClose={() => {}} />);
    // Two carry the tier; only one is on.
    expect(await screen.findByText('1 would act now')).toBeInTheDocument();
  });

  it('names the gap when a tier cannot reach its device', async () => {
    // The quietest way to believe a building is protected when it is not.
    useCapabilitiesStore.setState({ dispatchClasses: [] });
    useDeviceStore.setState({ devices: [dev('sw-a')], latestReadings: { 'sw-a': on('sw-a') } });
    useDeviceConfigStore.setState({ saved: { 'sw-a': { ...emptyDeviceConfig('sw-a'), loadShedGroup: 'group_1' } } });
    render(<LoadShedPanel onClose={() => {}} />);
    expect(await screen.findByRole('status')).toHaveTextContent(/no dispatch path/i);
    expect(screen.getByText(/not commandable/i)).toBeInTheDocument();
  });

  it('does not claim a device is commandable before the bridge has said so', () => {
    // `null` capabilities is "not answered yet", not "yes" — the optimistic reading of an
    // unanswered question is the dangerous one here, because it ends in a relay.
    useCapabilitiesStore.setState({ dispatchClasses: null });
    useDeviceStore.setState({ devices: [dev('sw-a')], latestReadings: { 'sw-a': on('sw-a') } });
    useDeviceConfigStore.setState({ saved: { 'sw-a': { ...emptyDeviceConfig('sw-a'), loadShedGroup: 'group_1' } } });
    render(<LoadShedPanel onClose={() => {}} />);
    expect(screen.getByText(/not commandable/i)).toBeInTheDocument();
  });

  it('shows unclassified devices as unclassified, never as a quiet yes', () => {
    useDeviceStore.setState({ devices: [dev('sw-a')] });
    render(<LoadShedPanel onClose={() => {}} />);
    const select = screen.getByLabelText(/tier for SW-A/i) as HTMLSelectElement;
    expect(select.value).toBe('');
    // Scoped, because "Not classified" is legitimately also an <option> in every row's select,
    // so a bare text query matches both. It is deliberately NOT one of the tier tiles: it is the
    // absence of a tier, and the panel says so on its own line.
    const unassigned = document.querySelector('.shed-panel__unassigned');
    expect(within(unassigned as HTMLElement).getByText('1')).toBeInTheDocument();
    expect(unassigned?.textContent).toMatch(/never shed/);
    expect(document.querySelectorAll('.shed-panel__tally-item')).toHaveLength(4);
  });

  it('surfaces a failed save instead of leaving the new tier looking stored', async () => {
    useDeviceStore.setState({ devices: [dev('sw-a')] });
    useDeviceConfigStore.setState({ saveError: 'policy matched no rows' });
    render(<LoadShedPanel onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/policy matched no rows/));
  });

  it('says so when the site has nothing a relay can switch', () => {
    useDeviceStore.setState({ devices: [dev('ct', 'meter')] });
    render(<LoadShedPanel onClose={() => {}} />);
    expect(screen.getByText(/nothing to shed/i)).toBeInTheDocument();
  });
});

describe('LoadShedPanel — per socket (RM-060)', () => {
  it('writes a socket tier to socket_config, not to the device row', () => {
    useDeviceStore.setState({ devices: [dev('plug-b', 'outlet_dual')] });
    render(<LoadShedPanel onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/tier for PLUG-B · S2/i), { target: { value: 'group_1' } });
    expect(setSocketTier).toHaveBeenCalledWith('plug-b', 2, 'group_1');
    expect(setDraftField).not.toHaveBeenCalled();
  });

  it('a single-relay device still writes its DEVICE row — two tables, one gesture', () => {
    useDeviceStore.setState({ devices: [dev('sw-a')] });
    render(<LoadShedPanel onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/tier for SW-A/i), { target: { value: 'group_2' } });
    expect(setDraftField).toHaveBeenCalledWith('sw-a', 'loadShedGroup', 'group_2');
    expect(setSocketTier).not.toHaveBeenCalled();
  });

  it('a socket tier overrides the device tier for that socket only', () => {
    useDeviceStore.setState({ devices: [dev('plug-b', 'outlet_dual')] });
    useDeviceConfigStore.setState({ saved: { 'plug-b': { ...emptyDeviceConfig('plug-b'), loadShedGroup: 'group_3' } } });
    useSocketConfigStore.setState({ saved: { 'plug-b': { 1: { deviceId: 'plug-b', socket: 1, loadShedGroup: 'group_1', label: null } } } });
    render(<LoadShedPanel onClose={() => {}} />);
    expect((screen.getByLabelText(/tier for PLUG-B · S1/i) as HTMLSelectElement).value).toBe('group_1');
    expect((screen.getByLabelText(/tier for PLUG-B · S2/i) as HTMLSelectElement).value).toBe('group_3', );
  });

  it('reads "on" PER SOCKET — one socket drawing does not make its neighbour sheddable', () => {
    // The device-level `state` is derived as `s1 || s2`, so using it here would show an already
    // off relay as one that would act.
    useDeviceStore.setState({ devices: [dev('plug-b', 'outlet_dual')], latestReadings: { 'plug-b': sockets('plug-b', 'on', 'off') } });
    useSocketConfigStore.setState({ saved: { 'plug-b': { 1: { deviceId: 'plug-b', socket: 1, loadShedGroup: 'group_1', label: null }, 2: { deviceId: 'plug-b', socket: 2, loadShedGroup: 'group_1', label: null } } } });
    render(<LoadShedPanel onClose={() => {}} />);
    // Two points carry group_1; exactly one of them could act right now.
    expect(screen.getByText(/1 would act now/i)).toBeInTheDocument();
  });

  it('a failed socket write is reported next to the control that caused it', () => {
    useDeviceStore.setState({ devices: [dev('plug-b', 'outlet_dual')] });
    useSocketConfigStore.setState({ rowError: { 'plug-b:1': 'Supabase socket_config write failed: nope' } });
    render(<LoadShedPanel onClose={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/socket_config write failed/i);
  });
});
