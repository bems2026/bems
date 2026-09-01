import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { LoadShedPanel } from './LoadShedPanel';
import { useDeviceStore } from '@/stores/deviceStore';
import { useDeviceConfigStore } from '@/stores/deviceConfigStore';
import { useCapabilitiesStore } from '@/stores/capabilitiesStore';
import { emptyDeviceConfig } from '@/lib/deviceConfig';
import type { Device, DeviceClass, Reading } from '@/lib/types';

const save = vi.fn();
const setDraftField = vi.fn();

/** Ids this build has never seen, so nothing here passes because of one building's names. */
const dev = (id: string, cls: DeviceClass = 'switch'): Device => ({
  id, display_name: id.toUpperCase(), class: cls, room: null, dps_map: null, status: 'active',
});
const on = (id: string): Reading => ({ device_id: id, ts: new Date().toISOString(), online: true, state: 'on' });

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  save.mockResolvedValue(undefined);
  useDeviceStore.setState({ devices: [], latestReadings: {}, totals: null, history: {} });
  useDeviceConfigStore.setState({ saved: {}, draft: {}, status: 'ready', saveStatus: 'idle', saveError: null, lastSave: null, save, setDraftField });
  useCapabilitiesStore.setState({ dispatchClasses: ['switch', 'outlet_dual'] });
});

describe('LoadShedPanel', () => {
  it('offers a tier for every relay-controlled device', () => {
    useDeviceStore.setState({ devices: [dev('sw-a'), dev('plug-b', 'outlet_dual')] });
    render(<LoadShedPanel onClose={() => {}} />);
    expect(screen.getByLabelText(/tier for SW-A/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/tier for PLUG-B/i)).toBeInTheDocument();
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
