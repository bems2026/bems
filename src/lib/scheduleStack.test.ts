import { describe, it, expect } from 'vitest';
import {
  scheduleTargets,
  targetKey,
  stackFor,
  ruleProblem,
  explainProblem,
  RULE_PROBLEMS,
  stackConflicts,
  weekTimeline,
  formatMinute,
  MINUTES_PER_DAY,
} from './scheduleStack';
import type { Schedule } from './supabaseSchedules';
import type { Device } from './types';

const USER = '11111111-1111-1111-1111-111111111111';

const device = (id: string, name: string, cls: Device['class'], sockets?: string[]): Device =>
  ({
    id,
    display_name: name,
    class: cls,
    room: null,
    dps_map: null,
    status: 'active',
    ...(sockets ? { sockets } : {}),
    // `Device['sockets']` is a two-tuple, so TypeScript alone would forbid the one-socket case
    // below. The registry it comes from is plain JavaScript and the flow is hand-edited, so the
    // runtime guard is still worth having and still worth testing — hence the cast.
  }) as Device;

const L1 = device('l1', 'Light Switch 1', 'switch');
const CO5 = device('co5', 'Outlet 5', 'outlet_dual', ['CO5_1', 'CO5_2']);
const ACU = device('acu_main', 'CARE ACU IR', 'acu_ir');
const METER = device('mtr_lo_red', 'L.O Red', 'meter');

let n = 0;
const rule = (over: Partial<Schedule> = {}): Schedule => ({
  id: `r${(n += 1)}`,
  deviceId: 'l1',
  socket: null,
  on: '08:00',
  off: '18:00',
  days: '1111100',
  enabled: true,
  label: null,
  updatedBy: USER,
  updatedAt: '2026-09-01T00:00:00Z',
  createdAt: '2026-09-01T00:00:00Z',
  ...over,
});

const DISPATCHABLE = new Set(['l1', 'co5', 'acu_main']);

describe('scheduleTargets', () => {
  it('splits an outlet into one target per socket — the whole point of RM-059', () => {
    expect(scheduleTargets([CO5]).map((t) => t.name)).toEqual(['Outlet 5 · S1', 'Outlet 5 · S2']);
  });

  it('gives a switch and the aircon exactly one target each, with a null socket', () => {
    const targets = scheduleTargets([L1, ACU]);
    expect(targets.map((t) => t.name)).toEqual(['Light Switch 1', 'CARE ACU IR']);
    expect(targets.every((t) => t.socket === null)).toBe(true);
  });

  it('takes the socket count from the registry rather than assuming two', () => {
    const oneSocket = device('co9', 'Outlet 9', 'outlet_dual', ['CO9_1']);
    expect(scheduleTargets([oneSocket])).toHaveLength(1);
  });

  it('keys are unique and stable', () => {
    const keys = scheduleTargets([L1, CO5, ACU]).map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(['l1', 'co5:1', 'co5:2', 'acu_main']);
    expect(targetKey('co5', 2)).toBe('co5:2');
  });
});

describe('stackFor', () => {
  const targets = scheduleTargets([L1, CO5]);
  const s1 = targets.find((t) => t.key === 'co5:1')!;
  const s2 = targets.find((t) => t.key === 'co5:2')!;

  it('gives each socket only its own rules', () => {
    const rules = [rule({ deviceId: 'co5', socket: 1 }), rule({ deviceId: 'co5', socket: 2 })];
    expect(stackFor(rules, s1).map((r) => r.socket)).toEqual([1]);
    expect(stackFor(rules, s2).map((r) => r.socket)).toEqual([2]);
  });

  it('shows a legacy whole-outlet rule under BOTH sockets, because that is what it does', () => {
    // `fanOutCommand` expands a socket-null outlet rule to both relays at dispatch. Hiding it
    // under neither would leave a rule that switches the building invisible on this page.
    const legacy = [rule({ deviceId: 'co5', socket: null })];
    expect(stackFor(legacy, s1)).toHaveLength(1);
    expect(stackFor(legacy, s2)).toHaveLength(1);
  });

  it('never leaks another device rules', () => {
    const rules = [rule({ deviceId: 'l1' }), rule({ deviceId: 'co5', socket: 1 })];
    expect(stackFor(rules, s1).map((r) => r.deviceId)).toEqual(['co5']);
  });

  it('sorts chronologically by on-time so the list reads as the day', () => {
    const stack = [rule({ on: '13:00' }), rule({ on: '06:00' }), rule({ on: '22:00' })];
    expect(stackFor(stack, targets[0]).map((r) => r.on)).toEqual(['06:00', '13:00', '22:00']);
  });

  it('sorts an unfinished rule with no times to the bottom', () => {
    const stack = [rule({ on: null, off: null }), rule({ on: '06:00' })];
    expect(stackFor(stack, targets[0]).map((r) => r.on)).toEqual(['06:00', null]);
  });
});

describe('ruleProblem', () => {
  it('a healthy rule has none', () => {
    expect(ruleProblem(rule(), L1, DISPATCHABLE)).toBeNull();
  });

  it('reports an unattributed rule — one dead rule in a stack of five is otherwise invisible', () => {
    expect(ruleProblem(rule({ updatedBy: null }), L1, DISPATCHABLE)).toBe('no_attribution');
  });

  it('reports no days, and distinguishes an unfinished rule from a malformed one', () => {
    expect(ruleProblem(rule({ days: '0000000' }), L1, DISPATCHABLE)).toBe('malformed_days');
    expect(ruleProblem(rule({ on: null, off: null }), L1, DISPATCHABLE)).toBe('no_times');
  });

  it('reports a socket the device does not have, and one on a device with no sockets', () => {
    expect(ruleProblem(rule({ deviceId: 'co5', socket: 2 }), device('co5', 'Outlet 5', 'outlet_dual', ['CO5_1']), DISPATCHABLE)).toBe('socket_not_on_device');
    expect(ruleProblem(rule({ socket: 1 }), L1, DISPATCHABLE)).toBe('socket_not_applicable');
  });

  it('reports a device with no dispatch path and one absent from the registry', () => {
    expect(ruleProblem(rule({ deviceId: 'mtr_lo_red' }), METER, DISPATCHABLE)).toBe('not_dispatchable');
    expect(ruleProblem(rule({ deviceId: 'ghost' }), undefined, DISPATCHABLE)).toBe('unknown_device');
  });

  it('a DISARMED rule is never a fault — that is a state somebody chose', () => {
    expect(ruleProblem(rule({ enabled: false, updatedBy: null }), L1, DISPATCHABLE)).toBeNull();
  });

  it('every declared reason has plain-language text — no raw enum reaches a person', () => {
    for (const reason of RULE_PROBLEMS) {
      expect(explainProblem(reason)).not.toBe(reason);
      expect(explainProblem(reason).length).toBeGreaterThan(10);
    }
  });
});

describe('stackConflicts', () => {
  it('flags an on and an off at the same minute, and says which way it resolves', () => {
    const conflicts = stackConflicts([rule({ id: 'a', on: '08:00', off: null }), rule({ id: 'b', on: null, off: '08:00' })]);
    const collision = conflicts.find((c) => c.kind === 'collision')!;
    expect(collision.ruleIds.sort()).toEqual(['a', 'b']);
    expect(collision.message).toMatch(/resolves this to OFF/);
  });

  it('does not flag the same time on days that do not overlap', () => {
    const mon = rule({ on: '08:00', off: null, days: '1000000' });
    const tue = rule({ on: null, off: '08:00', days: '0100000' });
    expect(stackConflicts([mon, tue]).filter((c) => c.kind === 'collision')).toHaveLength(0);
  });

  it('flags exact duplicates, which are almost always an edit that was meant to replace', () => {
    const a = rule({ id: 'a' });
    const b = rule({ id: 'b' });
    expect(stackConflicts([a, b]).filter((c) => c.kind === 'duplicate')).toHaveLength(1);
  });

  it('calls an overnight rule overnight rather than an error, because it is legitimate', () => {
    const overnight = stackConflicts([rule({ on: '22:00', off: '06:00' })]);
    expect(overnight.map((c) => c.kind)).toEqual(['overnight']);
  });

  it('ignores disarmed rules entirely', () => {
    expect(stackConflicts([rule({ enabled: false, on: '08:00', off: null }), rule({ enabled: false, on: null, off: '08:00' })])).toEqual([]);
  });

  it('a clean stack has no conflicts', () => {
    expect(stackConflicts([rule({ on: '08:00', off: '12:00' }), rule({ on: '13:00', off: '17:00' })])).toEqual([]);
  });
});

describe('weekTimeline', () => {
  /** Total on-minutes across the week — the single number that says whether the walk is right. */
  const totalMinutes = (spans: { startMin: number; endMin: number }[]) => spans.reduce((sum, s) => sum + (s.endMin - s.startMin), 0);

  it('says so when there is nothing to draw, rather than painting an empty week', () => {
    // An empty strip and "always off" look identical, and only one of them is true.
    expect(weekTimeline([])).toEqual({ spans: [], empty: true, neverOff: false });
    expect(weekTimeline([rule({ enabled: false })]).empty).toBe(true);
  });

  it('paints one weekday window per day it is set for', () => {
    const t = weekTimeline([rule({ on: '08:00', off: '12:00', days: '1111100' })]);
    expect(t.empty).toBe(false);
    expect(t.spans).toHaveLength(5);
    expect(t.spans[0]).toEqual({ day: 0, startMin: 480, endMin: 720 });
    expect(totalMinutes(t.spans)).toBe(5 * 240);
  });

  it('paints two windows in a day from two rules — the stackable case', () => {
    const t = weekTimeline([
      rule({ on: '08:00', off: '12:00', days: '1000000' }),
      rule({ on: '13:00', off: '17:00', days: '1000000' }),
    ]);
    expect(t.spans).toEqual([
      { day: 0, startMin: 480, endMin: 720 },
      { day: 0, startMin: 780, endMin: 1020 },
    ]);
  });

  it('wraps a nightly overnight window past midnight, every night', () => {
    const t = weekTimeline([rule({ on: '22:00', off: '06:00', days: '1111111' })]);
    expect(totalMinutes(t.spans), 'seven nights of eight hours').toBe(7 * 8 * 60);
    expect(t.spans.some((s) => s.day === 0 && s.startMin === 1320 && s.endMin === MINUTES_PER_DAY)).toBe(true);
    expect(t.spans.some((s) => s.day === 1 && s.startMin === 0 && s.endMin === 360)).toBe(true);
  });

  it('an overnight rule set for ONE day leaves the device on nearly all week, and shows it', () => {
    // The surprise this strip exists to prevent. "On 22:00, off 06:00, Mondays" reads like an
    // eight-hour window; what it actually does is switch on Monday night and not switch off
    // again until the FOLLOWING Monday morning, because Monday holds the only off event.
    // A per-rule bar chart would draw the eight hours the operator imagined.
    const t = weekTimeline([rule({ on: '22:00', off: '06:00', days: '1000000' })]);
    expect(totalMinutes(t.spans), 'Mon 22:00 round to the next Mon 06:00, plus this week head').toBe(9120);
    expect(t.spans.some((s) => s.day === 3 && s.startMin === 0 && s.endMin === MINUTES_PER_DAY)).toBe(true);
  });

  it('carries a Friday-evening ON across the weekend to a Monday-morning OFF', () => {
    // This is why the walk simulates a repeating week instead of reading each rule as a bar.
    const t = weekTimeline([
      rule({ on: '17:00', off: null, days: '0000100' }), // Friday 17:00 on
      rule({ on: null, off: '07:00', days: '1000000' }), // Monday 07:00 off
    ]);
    expect(t.neverOff).toBe(false);
    // Fri 17:00 -> Mon 07:00 = 7h + 24h + 24h + 7h = 62 hours.
    expect(totalMinutes(t.spans)).toBe(62 * 60);
    expect(t.spans.some((s) => s.day === 5 && s.startMin === 0 && s.endMin === MINUTES_PER_DAY)).toBe(true);
    expect(t.spans.some((s) => s.day === 6 && s.startMin === 0 && s.endMin === MINUTES_PER_DAY)).toBe(true);
  });

  it('reports a stack that can only ever switch ON, rather than drawing a full green week', () => {
    const t = weekTimeline([rule({ on: '08:00', off: null, days: '1000000' })]);
    expect(t.neverOff).toBe(true);
    expect(t.spans.length).toBeGreaterThan(0);
  });

  it('OFF wins at an equal minute, exactly as the daemon resolves it', () => {
    const t = weekTimeline([
      rule({ on: '08:00', off: '12:00', days: '1000000' }),
      rule({ on: null, off: '08:00', days: '1000000' }),
    ]);
    // The 08:00 off is applied before the 08:00 on, so the window still opens at 08:00 and the
    // total is unchanged — but the ordering is what stops a phantom span appearing before it.
    expect(totalMinutes(t.spans)).toBe(240);
    expect(t.spans[0].startMin).toBe(480);
  });

  it('merges two windows that meet exactly into one span', () => {
    const t = weekTimeline([
      rule({ on: '08:00', off: '12:00', days: '1000000' }),
      rule({ on: '12:00', off: '17:00', days: '1000000' }),
    ]);
    // 12:00 is both an off and an on. Off wins, then on re-opens — but a reader should see one
    // bar from 08:00 to 17:00, not two touching bars with an invisible seam.
    expect(t.spans).toEqual([{ day: 0, startMin: 480, endMin: 1020 }]);
  });

  it('ignores disarmed rules when painting', () => {
    const t = weekTimeline([rule({ on: '08:00', off: '12:00', days: '1000000' }), rule({ enabled: false, on: '20:00', off: '22:00', days: '1000000' })]);
    expect(t.spans).toHaveLength(1);
  });

  it('a rule with no days paints nothing', () => {
    expect(weekTimeline([rule({ days: '0000000' })]).empty).toBe(true);
  });
});

describe('formatMinute', () => {
  it('renders minutes of the day, with midnight at the end shown as 24:00', () => {
    expect(formatMinute(0)).toBe('00:00');
    expect(formatMinute(480)).toBe('08:00');
    expect(formatMinute(1439)).toBe('23:59');
    expect(formatMinute(MINUTES_PER_DAY)).toBe('24:00');
  });
});
