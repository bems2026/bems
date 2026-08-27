import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { SpacePlanView } from './SpacePlanView';
import { useDeviceStore } from '@/stores/deviceStore';
import { useDeviceConfigStore } from '@/stores/deviceConfigStore';
import { useSpaceTreeStore } from '@/stores/spaceTreeStore';
import { emptyDeviceConfig } from '@/lib/deviceConfig';
import type { SpaceNode } from '@/lib/spaceTree';
import type { Device } from '@/lib/types';

const placeOnPlan = vi.fn();

const nodes: SpaceNode[] = [
  { id: 'b', site_id: 's', parent_id: null, kind: 'building', name: 'NBERIC', sort_order: 0, attrs: {} },
  { id: 'lab', site_id: 's', parent_id: 'b', kind: 'room', name: 'Lab', sort_order: 0, attrs: {} },
  { id: 'hall', site_id: 's', parent_id: 'b', kind: 'room', name: 'Hall', sort_order: 1, attrs: {} },
];

/** Ids this build has never heard of, on purpose: the plan may not know any device by name. */
const device = (id: string, display_name: string): Device => ({
  id,
  display_name,
  class: 'outlet_dual',
  room: null,
  dps_map: 'type_b',
  status: 'active',
});

const cfg = (id: string, over: Partial<ReturnType<typeof emptyDeviceConfig>> = {}) => ({ ...emptyDeviceConfig(id), ...over });

/** The frame has no size in jsdom, exactly as it has none when hidden in a real browser. Tests
 * that click the frame must give it one, and one test deliberately does not. */
function sizeTheFrame(el: Element, rect = { left: 100, top: 50, width: 200, height: 400 }) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    ...rect,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  } as DOMRect);
}

const seedTree = (over: Partial<ReturnType<typeof useSpaceTreeStore.getState>> = {}) =>
  useSpaceTreeStore.setState({ nodes, status: 'ready', mutating: false, error: null, canEdit: true, ...over });

beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
  placeOnPlan.mockReset().mockResolvedValue(undefined);
  seedTree();
  useDeviceStore.setState({ devices: [], latestReadings: {}, totals: null, history: {} });
  useDeviceConfigStore.setState({ saved: {}, draft: {}, status: 'ready', saveStatus: 'idle', saveError: null, lastSave: null, placeOnPlan });
});

describe('SpacePlanView — before anyone draws a plan', () => {
  it('says there are no spaces yet, rather than showing an empty frame', () => {
    seedTree({ nodes: [] });
    useDeviceStore.setState({ devices: [device('zz9', 'Rack PDU')] });
    render(<SpacePlanView />);
    expect(screen.getByText(/no spaces defined/i)).toBeInTheDocument();
  });

  it('lists the whole fleet grouped by the space each device is in', () => {
    // THE POINT OF THE PHASE. A site that has built a tree but positioned nothing gets a real,
    // useful view — not a blank rectangle that is indistinguishable from a broken one.
    useDeviceStore.setState({ devices: [device('zz9', 'Rack PDU'), device('qq1', 'Bench Outlet')] });
    useDeviceConfigStore.setState({ saved: { zz9: cfg('zz9', { spaceNodeId: 'lab' }), qq1: cfg('qq1', { spaceNodeId: 'hall' }) } });
    render(<SpacePlanView />);
    // By role, because the space picker legitimately carries the same labels in its options.
    expect(screen.getByRole('button', { name: 'NBERIC / Hall' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'NBERIC / Lab' })).toBeInTheDocument();
    expect(screen.getByText('Rack PDU')).toBeInTheDocument();
    expect(screen.getByText('Bench Outlet')).toBeInTheDocument();
  });

  it('accounts for devices that are in no space at all', () => {
    // Omitting them would show a tidy plan of a building with hardware missing from it.
    useDeviceStore.setState({ devices: [device('zz9', 'Rack PDU')] });
    render(<SpacePlanView />);
    expect(screen.getByText(/not placed/i)).toBeInTheDocument();
    expect(screen.getByText('Rack PDU')).toBeInTheDocument();
  });

  it('knows no device by name — an id this build has never seen renders the same as any other', () => {
    useDeviceStore.setState({ devices: [device('totally-new-id', 'Something New')] });
    useDeviceConfigStore.setState({ saved: { 'totally-new-id': cfg('totally-new-id', { spaceNodeId: 'lab' }) } });
    render(<SpacePlanView />);
    expect(screen.getByText('Something New')).toBeInTheDocument();
  });
});

describe('SpacePlanView — one space', () => {
  const openLab = () => fireEvent.change(screen.getByRole('combobox', { name: /space/i }), { target: { value: 'lab' } });

  beforeEach(() => {
    useDeviceStore.setState({ devices: [device('zz9', 'Rack PDU'), device('qq1', 'Bench Outlet')] });
  });

  it('draws a pin for a device that has a position', () => {
    useDeviceConfigStore.setState({ saved: { zz9: cfg('zz9', { spaceNodeId: 'lab', planX: 0.25, planY: 0.75 }) } });
    render(<SpacePlanView />);
    openLab();
    const pin = screen.getByTestId('plan-pin-zz9');
    expect(pin).toHaveStyle({ left: '25%', top: '75%' });
  });

  it('leaves a device with no position off the frame and says where it went', () => {
    // Drawing it somewhere — the middle, a corner — would be a position nobody chose, rendered
    // as confidently as one somebody did.
    useDeviceConfigStore.setState({ saved: { zz9: cfg('zz9', { spaceNodeId: 'lab' }) } });
    render(<SpacePlanView />);
    openLab();
    expect(screen.queryByTestId('plan-pin-zz9')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('plan-unpositioned')).getByText('Rack PDU')).toBeInTheDocument();
  });

  it('does not draw a device belonging to a space inside this one', () => {
    // ITS COORDINATES ARE MEASURED AGAINST ITS OWN ROOM. Drawn in the parent's frame they point
    // somewhere nobody chose — and the drawing would look entirely correct.
    useDeviceConfigStore.setState({ saved: { zz9: cfg('zz9', { spaceNodeId: 'lab', planX: 0.25, planY: 0.75 }) } });
    render(<SpacePlanView />);
    fireEvent.change(screen.getByRole('combobox', { name: /space/i }), { target: { value: 'b' } });
    expect(screen.queryByTestId('plan-pin-zz9')).not.toBeInTheDocument();
    expect(screen.getByText(/inside this one/i)).toBeInTheDocument();
  });
});

describe('SpacePlanView — placing', () => {
  const openLab = () => fireEvent.change(screen.getByRole('combobox', { name: /space/i }), { target: { value: 'lab' } });

  beforeEach(() => {
    useDeviceStore.setState({ devices: [device('zz9', 'Rack PDU')] });
    useDeviceConfigStore.setState({ saved: { zz9: cfg('zz9', { spaceNodeId: 'lab' }) } });
  });

  it('offers nothing to click when it is not an editor', () => {
    render(<SpacePlanView />);
    openLab();
    expect(screen.queryByRole('button', { name: /place/i })).not.toBeInTheDocument();
  });

  it('places a device where the frame was clicked', async () => {
    render(<SpacePlanView editable />);
    openLab();
    fireEvent.click(screen.getByRole('button', { name: /place Rack PDU/i }));
    const frame = screen.getByTestId('plan-frame');
    sizeTheFrame(frame);
    fireEvent.click(frame, { clientX: 150, clientY: 150 });
    await waitFor(() => expect(placeOnPlan).toHaveBeenCalledWith('zz9', { x: 0.25, y: 0.25 }));
  });

  it('does nothing when the frame has no size, rather than storing a NaN', () => {
    // A hidden or unlaid-out frame reports a zero rect. `0/0` is NaN, which phase23's CHECK
    // would reject — after the pin had already appeared to move.
    render(<SpacePlanView editable />);
    openLab();
    fireEvent.click(screen.getByRole('button', { name: /place Rack PDU/i }));
    fireEvent.click(screen.getByTestId('plan-frame'), { clientX: 150, clientY: 150 });
    expect(placeOnPlan).not.toHaveBeenCalled();
  });

  it('can be positioned by typing, not only by pointing', async () => {
    // Clicking a frame is a mouse action. Two number fields are the same fact, reachable from a
    // keyboard — and they are how a position gets set precisely rather than approximately.
    useDeviceConfigStore.setState({ saved: { zz9: cfg('zz9', { spaceNodeId: 'lab', planX: 0.25, planY: 0.75 }) } });
    render(<SpacePlanView editable />);
    openLab();
    fireEvent.click(screen.getByTestId('plan-pin-zz9'));
    fireEvent.change(screen.getByRole('spinbutton', { name: /across/i }), { target: { value: '60' } });
    await waitFor(() => expect(placeOnPlan).toHaveBeenCalledWith('zz9', { x: 0.6, y: 0.75 }));
  });

  it('takes a device off the plan without taking it out of the room', async () => {
    // Two different claims. "Nobody has marked its spot" is not "it is not in the Lab".
    useDeviceConfigStore.setState({ saved: { zz9: cfg('zz9', { spaceNodeId: 'lab', planX: 0.25, planY: 0.75 }) } });
    render(<SpacePlanView editable />);
    openLab();
    fireEvent.click(screen.getByTestId('plan-pin-zz9'));
    fireEvent.click(screen.getByRole('button', { name: /off the plan/i }));
    await waitFor(() => expect(placeOnPlan).toHaveBeenCalledWith('zz9', null));
  });

  it('says why it cannot edit when Supabase is not configured, instead of offering a control that always fails', () => {
    // Learned from SpaceTreePanel, where exactly this shipped as a raw TypeError because the
    // unit tests mock the client as present.
    seedTree({ canEdit: false });
    render(<SpacePlanView editable />);
    openLab();
    expect(screen.getByText(/not configured/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /place Rack PDU/i })).not.toBeInTheDocument();
  });
});
