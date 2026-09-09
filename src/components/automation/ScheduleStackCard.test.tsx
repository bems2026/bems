import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { ScheduleStackCard } from './ScheduleStackCard';
import { useScheduleStore } from '@/stores/scheduleStore';
import { scheduleTargets } from '@/lib/scheduleStack';
import type { Schedule } from '@/lib/supabaseSchedules';
import type { Device } from '@/lib/types';

/**
 * The schedule stack — the surface an operator actually edits, and until RM-071 the one with no
 * component test at all. That gap is part of how the page shipped claiming "staged, not yet
 * dispatchable" while the daemon was firing these rows at real relays.
 *
 * WHAT THESE ASSERT, and what they deliberately do not. Behaviour and accessible structure: that
 * the IF/THEN split puts the days in the condition and the timed switch in the action, that times
 * commit on blur rather than per keystroke, and that a dead rule says so. They do NOT assert class
 * names or visual layout — `DsmThresholdsCard.test.tsx` reaches for `.card-sub` and
 * `.automation-dsm-field__warn` and is the reason a later restyle has to be careful; nothing here
 * adds to that debt.
 */

const patch = vi.fn();
const remove = vi.fn();
const create = vi.fn();

const OUTLET = {
  id: 'co1',
  display_name: 'Outlet 1',
  class: 'outlet_dual',
  sockets: ['C.O Yellow', 'C.O Blue'],
  room: null,
  dps_map: null,
  status: 'active',
  branch_circuit: 'BR-2',
} as unknown as Device;

// `updatedBy` is not bookkeeping and is not optional: `server/schedulePlan.mjs` attributes the
// command it fires to this user and SKIPS any row without one, so a fixture that omitted it would
// be modelling a rule that silently never fires.
const rule = (over: Partial<Schedule> = {}): Schedule => ({
  id: 'r1',
  deviceId: 'co1',
  socket: 1,
  on: '08:00',
  off: '18:00',
  days: '1111100',
  enabled: true,
  label: 'Office hours',
  updatedBy: '33333333-3333-3333-3333-333333333333',
  updatedAt: '2026-09-09T08:00:00Z',
  createdAt: '2026-09-09T08:00:00Z',
  ...over,
});

const target = () => scheduleTargets([OUTLET])[0];

beforeEach(() => {
  vi.clearAllMocks();
  useScheduleStore.setState({
    schedules: [],
    status: 'ready',
    loadError: null,
    busy: {},
    rowError: {},
    lastSave: null,
    patch,
    remove,
    create,
  });
});
afterEach(cleanup);

describe('ScheduleStackCard — the IF/THEN split', () => {
  it('puts the days in the condition and the timed switch in the action', () => {
    // The reading this encodes: "when Mon-Fri, turn it on at 08:00 and off at 18:00." If these
    // ever swap, the rule still works and the sentence stops being true, which is exactly the
    // kind of drift a screenshot review misses.
    render(<ScheduleStackCard target={target()} stack={[rule()]} dispatchableIds={new Set(['co1'])} />);

    const when = screen.getByText(/^When$/i).closest('div');
    const then = screen.getByText(/^Then$/i).closest('div');
    expect(when).toBeTruthy();
    expect(then).toBeTruthy();

    // Day chips live under WHEN.
    expect(within(when!.parentElement!).getByRole('button', { name: /Monday for/i })).toBeInTheDocument();
    // Both time fields live under THEN.
    expect(within(then!.parentElement!).getByLabelText(/on time$/i)).toBeInTheDocument();
    expect(within(then!.parentElement!).getByLabelText(/off time$/i)).toBeInTheDocument();
  });

  it('names the trigger type for a screen reader, so the rail colour is never the only cue', () => {
    render(<ScheduleStackCard target={target()} stack={[rule()]} dispatchableIds={new Set(['co1'])} />);
    expect(screen.getByText(/time trigger/i)).toBeInTheDocument();
  });

  it('keeps the arm switch out of both zones — it is neither a condition nor an action', () => {
    render(<ScheduleStackCard target={target()} stack={[rule()]} dispatchableIds={new Set(['co1'])} />);
    const arm = screen.getByRole('switch', { name: /Arm Office hours/i });
    expect(arm.closest('.rule-block')).toBeNull();
  });
});

describe('ScheduleStackCard — writes', () => {
  it('commits a time on blur, not on every keystroke', () => {
    // `<input type="time">` fires change for each intermediate value. Writing "0", "08", "08:0"
    // would be three round trips and three chances to persist a half-typed time.
    render(<ScheduleStackCard target={target()} stack={[rule()]} dispatchableIds={new Set(['co1'])} />);
    const onField = screen.getByLabelText(/on time$/i);

    fireEvent.change(onField, { target: { value: '09:3' } });
    fireEvent.change(onField, { target: { value: '09:30' } });
    expect(patch).not.toHaveBeenCalled();

    fireEvent.blur(onField, { target: { value: '09:30' } });
    expect(patch).toHaveBeenCalledWith('r1', { on: '09:30' });
  });

  it('does not write when a blurred time is unchanged', () => {
    render(<ScheduleStackCard target={target()} stack={[rule()]} dispatchableIds={new Set(['co1'])} />);
    fireEvent.blur(screen.getByLabelText(/on time$/i), { target: { value: '08:00' } });
    expect(patch).not.toHaveBeenCalled();
  });

  it('toggles a day through the shared rotation rather than an index offset', () => {
    // Mon..Sun is the stored order. Clicking Saturday must set index 5, not index 6.
    render(<ScheduleStackCard target={target()} stack={[rule()]} dispatchableIds={new Set(['co1'])} />);
    fireEvent.click(screen.getByRole('button', { name: /Saturday for/i }));
    expect(patch).toHaveBeenCalledWith('r1', { days: '1111110' });
  });

  it('a stack of two rules edits each independently — the defect this whole table change fixed', () => {
    const stack = [rule(), rule({ id: 'r2', on: '13:00', off: '17:00', label: 'Afternoon' })];
    render(<ScheduleStackCard target={target()} stack={stack} dispatchableIds={new Set(['co1'])} />);

    expect(screen.getAllByRole('switch')).toHaveLength(2);
    fireEvent.blur(screen.getByLabelText(/Afternoon on time$/i), { target: { value: '14:00' } });
    expect(patch).toHaveBeenCalledWith('r2', { on: '14:00' });
    expect(patch).toHaveBeenCalledTimes(1);
  });
});

describe('ScheduleStackCard — what it refuses to hide', () => {
  it('says an armed rule can never fire, on the rule itself', () => {
    // A dead rule in a stack of five is invisible unless it says so where it is.
    render(
      <ScheduleStackCard target={target()} stack={[rule({ days: '0000000' })]} dispatchableIds={new Set(['co1'])} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(/never fire/i);
  });

  it('surfaces a same-minute collision and says which way it resolves', () => {
    // The daemon resolves this deterministically — off wins — so the page must say so rather than
    // leave the operator to discover it from the relay.
    const stack = [rule({ id: 'a', on: '08:00', off: '12:00' }), rule({ id: 'b', on: '15:00', off: '08:00' })];
    render(<ScheduleStackCard target={target()} stack={stack} dispatchableIds={new Set(['co1'])} />);
    const collision = screen
      .getAllByRole('status')
      .map((el) => el.textContent ?? '')
      .find((t) => /Two rules act at/.test(t));
    expect(collision).toMatch(/Two rules act at 08:00 on Monday/);
    expect(collision).toMatch(/resolves this to OFF/);
  });

  it('an empty stack says the scheduler ignores it until armed', () => {
    render(<ScheduleStackCard target={target()} stack={[]} dispatchableIds={new Set(['co1'])} />);
    expect(screen.getByText(/until it is armed the scheduler ignores it/i)).toBeInTheDocument();
  });

  it('never names the database vendor', () => {
    useScheduleStore.setState({ rowError: { r1: 'Could not save the rule.' } });
    render(<ScheduleStackCard target={target()} stack={[rule()]} dispatchableIds={new Set(['co1'])} />);
    expect(document.body.textContent).not.toMatch(/supabase/i);
  });
});
