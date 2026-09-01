import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { useControlPlan } from './useControlPlan';
import { useDeviceConfigStore } from '@/stores/deviceConfigStore';
import { useSpaceTreeStore } from '@/stores/spaceTreeStore';
import { emptyDeviceConfig } from '@/lib/deviceConfig';
import type { SpaceNode } from '@/lib/spaceTree';

/**
 * The order of preference is the whole of RM-037's last step: **what somebody drew beats the
 * hand-surveyed pack**, and the pack still beats nothing. The pack is one office's coordinates;
 * at any other site it draws that site's devices at this site's positions and looks entirely
 * correct doing it.
 */

const nodes: SpaceNode[] = [
  { id: 'b', site_id: 's', parent_id: null, kind: 'building', name: 'NBERIC', sort_order: 0, attrs: {} },
  { id: 'lab', site_id: 's', parent_id: 'b', kind: 'room', name: 'Lab', sort_order: 0, attrs: { plan: { kind: 'circle' } } },
  { id: 'hall', site_id: 's', parent_id: 'b', kind: 'room', name: 'Hall', sort_order: 1, attrs: {} },
];

const cfg = (id: string, over: Partial<ReturnType<typeof emptyDeviceConfig>>) => ({ ...emptyDeviceConfig(id), ...over });

/** Renders the hook and exposes what it returned, so the assertions read as facts about the hook
 * rather than about a card that happens to consume it. */
let seen: ReturnType<typeof useControlPlan>;
function Probe() {
  seen = useControlPlan();
  return (
    <div>
      <span data-testid="source">{seen.source ?? 'none'}</span>
      <span data-testid="room">{seen.roomId ?? 'none'}</span>
      {seen.plan ? <seen.plan.PlanShell /> : null}
    </div>
  );
}

beforeEach(() => {
  useSpaceTreeStore.setState({ nodes, status: 'ready', mutating: false, error: null, canEdit: true });
  useDeviceConfigStore.setState({ saved: {}, draft: {} });
});

afterEach(() => {
  // vite.config.ts sets `globals: false`, so RTL's automatic cleanup never registers.
  cleanup();
  vi.restoreAllMocks();
});

describe('useControlPlan — where the plan comes from', () => {
  it('prefers what somebody drew over the build-time pack', async () => {
    const drawn = {
      co1: cfg('co1', { spaceNodeId: 'lab', planX: 0.25, planY: 0.75 }),
      l1: cfg('l1', { spaceNodeId: 'lab', planFixtures: [{ x: 0.2, y: 0.2 }] }),
    };
    // Mount with nothing drawn first, and WAIT for the pack to actually arrive — the point is
    // that the pack loses once it is genuinely there, which a mount that never resolved the
    // dynamic import cannot show.
    render(<Probe />);
    await screen.findByText('pack');
    act(() => {
      useDeviceConfigStore.setState({ saved: drawn });
    });
    expect(screen.getByTestId('source')).toHaveTextContent('data');
    expect(seen.plan?.OUTLET_POSITIONS).toEqual({ co1: { x: 0.25, y: 0.75 } });
    expect(seen.plan?.LIGHT_POSITIONS).toEqual({ l1: [{ x: 0.2, y: 0.2 }] });
  });

  it('draws the room the operator sketched, not a surveyed office', () => {
    useDeviceConfigStore.setState({ saved: { co1: cfg('co1', { spaceNodeId: 'lab', planX: 0.5, planY: 0.5 }) } });
    const { container } = render(<Probe />);
    // A circle, because that is the shape on `lab`. The pack's shell draws rectangles and a door.
    expect(container.querySelector('.control-outlet-plan__shape path')?.getAttribute('d')).toMatch(/^M/);
    expect(container.querySelector('.control-outlet-plan__partition')).toBeNull();
  });

  it('offers only rooms that have something drawn in them', () => {
    useDeviceConfigStore.setState({
      saved: {
        co1: cfg('co1', { spaceNodeId: 'lab', planX: 0.5, planY: 0.5 }),
        co2: cfg('co2', { spaceNodeId: 'hall' }),
      },
    });
    render(<Probe />);
    expect(seen.rooms.map((r) => r.id)).toEqual(['lab']);
  });

  it('switches room on request, and draws only that room', () => {
    useDeviceConfigStore.setState({
      saved: {
        co1: cfg('co1', { spaceNodeId: 'lab', planX: 0.25, planY: 0.25 }),
        co2: cfg('co2', { spaceNodeId: 'hall', planX: 0.75, planY: 0.75 }),
      },
    });
    render(<Probe />);
    expect(seen.plan?.OUTLET_POSITIONS).toEqual({ co2: { x: 0.75, y: 0.75 } }); // Hall sorts first
    act(() => seen.setRoomId('lab'));
    expect(seen.plan?.OUTLET_POSITIONS).toEqual({ co1: { x: 0.25, y: 0.25 } });
  });

  it('falls back to the first drawn room when the chosen one stops being drawn', () => {
    // Otherwise a device moved out of the displayed room leaves the card showing an empty frame,
    // which reads as a failed render rather than as a room that is now empty.
    useDeviceConfigStore.setState({
      saved: {
        co1: cfg('co1', { spaceNodeId: 'lab', planX: 0.25, planY: 0.25 }),
        co2: cfg('co2', { spaceNodeId: 'hall', planX: 0.75, planY: 0.75 }),
      },
    });
    render(<Probe />);
    act(() => seen.setRoomId('lab'));
    expect(screen.getByTestId('room')).toHaveTextContent('lab');
    act(() => {
      useDeviceConfigStore.setState({ saved: { co2: cfg('co2', { spaceNodeId: 'hall', planX: 0.75, planY: 0.75 }) } });
    });
    expect(screen.getByTestId('room')).toHaveTextContent('hall');
  });

  it('loads the build-time pack when nothing is drawn, and names no room over it', async () => {
    // ALSO THE CONTROL FOR THE TEST ABOVE. Until this passed, "prefers data over the pack" was
    // vacuous: the dynamic import had not resolved, so there was no pack for data to beat, and
    // reversing the preference in the hook broke nothing. If this ever stops finding a pack, the
    // preference test is asserting nothing again.
    render(<Probe />);
    await screen.findByText('pack');
    // A select over the pack would be a choice that does not exist: that pack IS one office.
    expect(seen.rooms).toEqual([]);
    expect(seen.roomId).toBeNull();
  });
});
