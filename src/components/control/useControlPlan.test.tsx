import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { useControlPlan } from './useControlPlan';
import { useDeviceConfigStore } from '@/stores/deviceConfigStore';
import { useSpaceTreeStore } from '@/stores/spaceTreeStore';
import { emptyDeviceConfig } from '@/lib/deviceConfig';
import type { SpaceNode } from '@/lib/spaceTree';

/**
 * RM-044. There is one source now: what somebody drew.
 *
 * These used to assert a PREFERENCE — drawn data over a hand-surveyed build-time pack, with a
 * control test proving the pack had actually loaded so the comparison was not vacuous. The pack
 * was deleted on 2026-09-02 once the CARE office was drawn, and its coordinates live on as the
 * `care-office` preset, so both of those tests went with it: there is no longer a second source
 * for data to beat. What remains is that a drawn room produces a plan and an undrawn one
 * produces nothing — which is now the whole contract.
 */

const nodes: SpaceNode[] = [
  { id: 'b', site_id: 's', parent_id: null, kind: 'building', name: 'NBERIC', sort_order: 0, attrs: {} },
  { id: 'lab', site_id: 's', parent_id: 'b', kind: 'room', name: 'Lab', sort_order: 0, attrs: { plan: { kind: 'circle' } } },
  { id: 'hall', site_id: 's', parent_id: 'b', kind: 'room', name: 'Hall', sort_order: 1, attrs: {} },
];

const cfg = (id: string, over: Partial<ReturnType<typeof emptyDeviceConfig>>) => ({ ...emptyDeviceConfig(id), ...over });

/**
 * Renders the hook's whole return into the DOM and drives it through buttons.
 *
 * An earlier version assigned the return to a variable declared outside the component, which is
 * a side effect during render — `react-hooks/globals` fails it, and rightly: what that variable
 * held would depend on when React happened to re-render last. Everything the assertions need is
 * rendered instead, so there is nothing to smuggle out.
 */
function Probe() {
  const { plan, source, rooms, roomId, setRoomId } = useControlPlan();
  return (
    <div>
      <span data-testid="source">{source ?? 'none'}</span>
      <span data-testid="room">{roomId ?? 'none'}</span>
      <span data-testid="rooms">{rooms.map((r) => r.id).join(',')}</span>
      <span data-testid="outlets">{JSON.stringify(plan?.OUTLET_POSITIONS ?? null)}</span>
      <span data-testid="lights">{JSON.stringify(plan?.LIGHT_POSITIONS ?? null)}</span>
      {rooms.map((r) => (
        <button key={r.id} type="button" onClick={() => setRoomId(r.id)}>
          show {r.id}
        </button>
      ))}
      {plan ? <plan.PlanShell /> : null}
    </div>
  );
}

const read = (id: string) => JSON.parse(screen.getByTestId(id).textContent || 'null');

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
  it('builds a plan from what somebody drew', async () => {
    const drawn = {
      co1: cfg('co1', { spaceNodeId: 'lab', planX: 0.25, planY: 0.75 }),
      l1: cfg('l1', { spaceNodeId: 'lab', planFixtures: [{ x: 0.2, y: 0.2 }] }),
    };
    // Mounted with nothing drawn first, so the transition from "no plan" to "a plan" is what is
    // asserted rather than the end state alone.
    render(<Probe />);
    expect(screen.getByTestId('source')).toHaveTextContent('none');
    useDeviceConfigStore.setState({ saved: drawn });
    await screen.findByText('data');
    expect(read('outlets')).toEqual({ co1: { x: 0.25, y: 0.75 } });
    expect(read('lights')).toEqual({ l1: [{ x: 0.2, y: 0.2 }] });
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
    expect(screen.getByTestId('rooms')).toHaveTextContent('lab');
  });

  it('switches room on request, and draws only that room', () => {
    useDeviceConfigStore.setState({
      saved: {
        co1: cfg('co1', { spaceNodeId: 'lab', planX: 0.25, planY: 0.25 }),
        co2: cfg('co2', { spaceNodeId: 'hall', planX: 0.75, planY: 0.75 }),
      },
    });
    render(<Probe />);
    expect(read('outlets')).toEqual({ co2: { x: 0.75, y: 0.75 } }); // Hall sorts first
    fireEvent.click(screen.getByRole('button', { name: 'show lab' }));
    expect(read('outlets')).toEqual({ co1: { x: 0.25, y: 0.25 } });
  });

  it('falls back to the first drawn room when the chosen one stops being drawn', async () => {
    // Otherwise a device moved out of the displayed room leaves the card showing an empty frame,
    // which reads as a failed render rather than as a room that is now empty.
    useDeviceConfigStore.setState({
      saved: {
        co1: cfg('co1', { spaceNodeId: 'lab', planX: 0.25, planY: 0.25 }),
        co2: cfg('co2', { spaceNodeId: 'hall', planX: 0.75, planY: 0.75 }),
      },
    });
    render(<Probe />);
    fireEvent.click(screen.getByRole('button', { name: 'show lab' }));
    expect(screen.getByTestId('room')).toHaveTextContent('lab');
    useDeviceConfigStore.setState({ saved: { co2: cfg('co2', { spaceNodeId: 'hall', planX: 0.75, planY: 0.75 }) } });
    // By test id, not by text: once `lab` stops being drawn, three nodes say "hall" — the room,
    // the room list, and the button that shows it.
    await waitFor(() => expect(screen.getByTestId('room')).toHaveTextContent('hall'));
  });

  it('has no plan at all when nothing is drawn, rather than falling back to another building', () => {
    // What the deleted pack did. A site that has drawn nothing gets the honest empty state and
    // the same controls in a list — never one building's coordinates rendered at another.
    render(<Probe />);
    expect(screen.getByTestId('source')).toHaveTextContent('none');
    expect(read('outlets')).toBeNull();
    expect(screen.getByTestId('rooms')).toHaveTextContent('');
    expect(screen.getByTestId('room')).toHaveTextContent('none');
  });
});
