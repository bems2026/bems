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

/**
 * Lamps, and which switch turns them on — RM-037.
 *
 * The property that matters most here: a lamp is drawn where it IS, and the grid is only how it
 * got there. Nothing below asserts a cell index, because nothing stores one.
 */
describe('SpacePlanView — the lighting layer', () => {
  const circuit = (id: string, display_name: string): Device => ({ ...device(id, display_name), class: 'switch', dps_map: 'type_a' });

  const seedRoom = () => {
    useDeviceStore.setState({
      devices: [circuit('l1', 'Row A'), circuit('l2', 'Row B'), device('co1', 'Desk outlet')],
      latestReadings: {}, totals: null, history: {},
    });
    useDeviceConfigStore.setState({
      saved: {
        l1: cfg('l1', { spaceNodeId: 'lab', planFixtures: [{ x: 0.25, y: 0.25 }, { x: 0.75, y: 0.25 }] }),
        l2: cfg('l2', { spaceNodeId: 'lab', planFixtures: [{ x: 0.25, y: 0.75 }] }),
        co1: cfg('co1', { spaceNodeId: 'lab', planX: 0.5, planY: 0.5 }),
      },
    });
  };

  const openLab = () => fireEvent.change(screen.getByLabelText('Space'), { target: { value: 'lab' } });

  it('draws every lamp of every circuit in the room', () => {
    seedRoom();
    render(<SpacePlanView />);
    openLab();
    expect(screen.getAllByTestId(/^plan-lamp-l1-/)).toHaveLength(2);
    expect(screen.getAllByTestId(/^plan-lamp-l2-/)).toHaveLength(1);
  });

  it('gives the two circuits different colours, so the plan says which switch reaches which lamp', () => {
    seedRoom();
    render(<SpacePlanView />);
    openLab();
    const a = screen.getByTestId('plan-lamp-l1-0').style.getPropertyValue('--lamp');
    const b = screen.getByTestId('plan-lamp-l2-0').style.getPropertyValue('--lamp');
    expect(a).not.toBe('');
    expect(a).not.toBe(b);
  });

  it('names the circuit on each lamp, because colour alone is not a label', () => {
    seedRoom();
    render(<SpacePlanView />);
    openLab();
    expect(screen.getByTestId('plan-lamp-l1-0')).toHaveAttribute('title', expect.stringContaining('Row A'));
  });

  it('draws lamps on the read-only plan too — they are the layout, not an editing affordance', () => {
    seedRoom();
    render(<SpacePlanView />);
    openLab();
    expect(screen.getAllByTestId(/^plan-lamp-/)).toHaveLength(3);
  });

  it('offers no lighting editor where the plan is not editable', () => {
    seedRoom();
    render(<SpacePlanView />);
    openLab();
    expect(screen.queryByRole('button', { name: /Paint lamps for Row A/ })).not.toBeInTheDocument();
  });

  it('shows no grid until a circuit is being painted, so the plan is not a spreadsheet at rest', () => {
    seedRoom();
    render(<SpacePlanView editable />);
    openLab();
    expect(screen.queryByTestId('lamp-grid')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Paint lamps for Row A/ }));
    expect(screen.getByTestId('lamp-grid')).toBeInTheDocument();
  });

  it('writes a lamp at the tapped cell, and saves it there and then', async () => {
    const toggleFixtureAt = vi.fn().mockResolvedValue(undefined);
    useDeviceConfigStore.setState({ toggleFixtureAt });
    seedRoom();
    render(<SpacePlanView editable />);
    openLab();
    fireEvent.click(screen.getByRole('button', { name: /Paint lamps for Row A/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Column 2, row 1' }));
    await waitFor(() => expect(toggleFixtureAt).toHaveBeenCalled());
    const [id, at, cols, rows] = toggleFixtureAt.mock.calls[0];
    expect(id).toBe('l1');
    expect(cols).toBe(4);
    expect(rows).toBe(3);
    // The cell's centre, in the plan's own 0..1 frame — never a cell index.
    expect(at).toEqual({ x: 0.375, y: 1 / 6 });
  });

  it('resizes the grid without moving a single lamp', () => {
    // THE TRAP THIS EXISTS FOR. Storing cell indices would make this resize relocate every
    // luminaire in the building while nothing physically moved.
    seedRoom();
    render(<SpacePlanView editable />);
    openLab();
    fireEvent.click(screen.getByRole('button', { name: /Paint lamps for Row A/ }));
    const before = screen.getAllByTestId(/^plan-lamp-l1-/).map((e) => e.getAttribute('style'));
    fireEvent.change(screen.getByLabelText('Columns'), { target: { value: '6' } });
    expect(screen.getAllByTestId(/^plan-lamp-l1-/).map((e) => e.getAttribute('style'))).toEqual(before);
  });

  it('stops painting when the room changes, because a circuit in one room means nothing in another', () => {
    seedRoom();
    render(<SpacePlanView editable />);
    openLab();
    fireEvent.click(screen.getByRole('button', { name: /Paint lamps for Row A/ }));
    fireEvent.change(screen.getByLabelText('Space'), { target: { value: 'hall' } });
    expect(screen.queryByTestId('lamp-grid')).not.toBeInTheDocument();
  });

  it('does not arm a device while painting, so one click on the frame means one thing', () => {
    // Enforced where a device can be ARMED rather than where a click is handled: a guard in the
    // click handler would be checking a state that could still be entered behind it. An earlier
    // version had exactly that, and deleting it broke nothing — which is how it was found.
    seedRoom();
    render(<SpacePlanView editable />);
    openLab();
    fireEvent.click(screen.getByRole('button', { name: /Paint lamps for Row A/ }));
    fireEvent.click(screen.getByTestId('plan-pin-co1'));
    const frame = screen.getByTestId('plan-frame');
    sizeTheFrame(frame);
    fireEvent.click(frame, { clientX: 150, clientY: 250 });
    expect(placeOnPlan).not.toHaveBeenCalled();
  });

  it('counts the lamps each circuit already has, so a room can be checked against the ceiling', () => {
    seedRoom();
    render(<SpacePlanView editable />);
    openLab();
    expect(screen.getByTestId('lamp-count-l1')).toHaveTextContent('2');
    expect(screen.getByTestId('lamp-count-l2')).toHaveTextContent('1');
  });

  it('says a room has no lighting circuits rather than showing an editor that can do nothing', () => {
    useDeviceStore.setState({ devices: [device('co1', 'Desk outlet')], latestReadings: {}, totals: null, history: {} });
    useDeviceConfigStore.setState({ saved: { co1: cfg('co1', { spaceNodeId: 'lab' }) } });
    render(<SpacePlanView editable />);
    openLab();
    expect(screen.getByText(/No lighting circuits are in this space/)).toBeInTheDocument();
  });
});

/**
 * The outline is the operator's sketch, not a survey. A device outside it is worth pointing at
 * and must never be refused — refusing would make a hand-drawn wall authoritative over a
 * building. RM-036/RM-037.
 */
describe('SpacePlanView — a device outside the drawn room', () => {
  const drawn = [
    nodes[0],
    { ...nodes[1], attrs: { plan: { kind: 'circle' } } },
    nodes[2],
  ] as SpaceNode[];

  it('warns, and still shows the device where it was put', () => {
    seedTree({ nodes: drawn });
    useDeviceStore.setState({ devices: [device('co1', 'Desk outlet')], latestReadings: {}, totals: null, history: {} });
    // A circle inscribed in the frame does not reach the corner.
    useDeviceConfigStore.setState({ saved: { co1: cfg('co1', { spaceNodeId: 'lab', planX: 0.02, planY: 0.02 }) } });
    render(<SpacePlanView />);
    fireEvent.change(screen.getByLabelText('Space'), { target: { value: 'lab' } });
    expect(screen.getByTestId('plan-pin-co1')).toBeInTheDocument();
    expect(screen.getByText(/outside the drawn outline/)).toBeInTheDocument();
  });

  it('says nothing when every device is inside it', () => {
    seedTree({ nodes: drawn });
    useDeviceStore.setState({ devices: [device('co1', 'Desk outlet')], latestReadings: {}, totals: null, history: {} });
    useDeviceConfigStore.setState({ saved: { co1: cfg('co1', { spaceNodeId: 'lab', planX: 0.5, planY: 0.5 }) } });
    render(<SpacePlanView />);
    fireEvent.change(screen.getByLabelText('Space'), { target: { value: 'lab' } });
    expect(screen.queryByText(/outside the drawn outline/)).not.toBeInTheDocument();
  });
});
