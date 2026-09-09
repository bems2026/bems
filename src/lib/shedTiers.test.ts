import { describe, it, expect } from 'vitest';
import { summariseShed, isSheddableClass, SHED_ORDER, shedEligibleCount } from './shedTiers';
import type { Device, DeviceClass, Reading } from './types';

const dev = (id: string, cls: DeviceClass = 'switch'): Device => ({
  id, display_name: id.toUpperCase(), class: cls, room: null, dps_map: null, status: 'active',
});

const on = (id: string): Reading => ({ device_id: id, ts: new Date().toISOString(), online: true, state: 'on' });
const off = (id: string): Reading => ({ device_id: id, ts: new Date().toISOString(), online: true, state: 'off' });

const ALL: DeviceClass[] = ['outlet_dual', 'switch'];

describe('what can be shed at all', () => {
  it('is relays only', () => {
    expect(isSheddableClass('outlet_dual')).toBe(true);
    expect(isSheddableClass('switch')).toBe(true);
    expect(isSheddableClass('meter')).toBe(false);
    expect(isSheddableClass('sensor_temp_humidity')).toBe(false);
  });

  it('excludes the aircon, and says why rather than leaving it unexplained', () => {
    // The single largest controllable load in this building is the aircon at 33% — and it is
    // NOT relay-switched. Somebody reading a shed list would reasonably wonder where it went.
    const s = summariseShed([dev('acu', 'acu_ir')], () => null, {}, ALL);
    expect(s.rows).toEqual([]);
    expect(s.excluded).toHaveLength(1);
    expect(s.excluded[0].reason).toMatch(/remote/);
    expect(s.excluded[0].reason).toMatch(/never cut/);
  });

  it('excludes meters and sensors with their own reasons', () => {
    const s = summariseShed([dev('m', 'meter'), dev('t', 'sensor_temp_humidity')], () => null, {}, ALL);
    expect(s.excluded.map((e) => e.reason)).toEqual([
      expect.stringMatching(/no relay to switch/),
      expect.stringMatching(/switches nothing/),
    ]);
  });
});

describe('the three conditions the shedder actually applies', () => {
  it('counts a device as effective only when assigned, dispatchable AND on', () => {
    const devices = [dev('a'), dev('b'), dev('c')];
    const readings = { a: on('a'), b: off('b'), c: on('c') };
    const tiers: Record<string, 'group_1'> = { a: 'group_1', b: 'group_1', c: 'group_1' };
    // `c` is dispatchable by class here, so all three are — what separates them is `state`.
    const s = summariseShed(devices, (id) => tiers[id] ?? null, readings, ALL);
    expect(s.byTier.group_1.total).toBe(3);
    expect(s.byTier.group_1.effective).toBe(2); // b is already off
  });

  it('treats an unassigned device as not a volunteer', () => {
    // `shedPlan`'s own words. Unassigned is not a quiet "yes".
    const s = summariseShed([dev('a')], () => null, { a: on('a') }, ALL);
    expect(s.byTier.unassigned.total).toBe(1);
    expect(s.byTier.unassigned.effective).toBe(0);
  });

  it('treats `never` as a refusal, not a fourth tier', () => {
    const s = summariseShed([dev('a')], () => 'never', { a: on('a') }, ALL);
    expect(s.byTier.never.total).toBe(1);
    expect(s.byTier.never.effective).toBe(0);
    expect(SHED_ORDER).not.toContain('never');
  });

  it('counts a tier on an undispatchable device as inert, and says how many', () => {
    // THE GAP WORTH SURFACING: the configuration says this device sheds, and nothing would
    // happen. Assigning a tier where there is no dispatch path is the quietest way to believe
    // the building is protected when it is not.
    const s = summariseShed([dev('a')], () => 'group_1', { a: on('a') }, []);
    expect(s.rows[0].dispatchable).toBe(false);
    expect(s.byTier.group_1.effective).toBe(0);
    expect(s.inertCount).toBe(1);
  });

  it('never claims dispatchable before the bridge has said so', () => {
    // `null` is "capabilities not loaded yet", which is not "yes". Same posture `dispatchScope`
    // takes: the optimistic reading of an unanswered question is the dangerous one.
    const s = summariseShed([dev('a')], () => 'group_1', { a: on('a') }, null);
    expect(s.rows[0].dispatchable).toBe(false);
  });
});

describe('the summary a panel renders', () => {
  it('reports every tier even when empty, so a gap is visible rather than absent', () => {
    const s = summariseShed([], () => null, {}, ALL);
    expect(Object.keys(s.byTier).sort()).toEqual(['group_1', 'group_2', 'group_3', 'never', 'unassigned']);
    expect(s.byTier.group_2).toEqual({ total: 0, effective: 0 });
  });

  it('keeps rows in the order it was given, so the caller controls sorting', () => {
    const s = summariseShed([dev('b'), dev('a')], () => null, {}, ALL);
    expect(s.rows.map((r) => r.device.id)).toEqual(['b', 'a']);
  });
});

/* ===========================================================================
 * RM-067 — the unit is a socket. Each case here is paired with one in
 * `server/shedPlan.test.mjs`; that pairing is the whole reason this file exists.
 * ======================================================================== */

const outlet = (id: string): Device =>
  ({
    id,
    display_name: id.toUpperCase(),
    class: 'outlet_dual',
    room: null,
    dps_map: null,
    status: 'active',
    sockets: [`${id.toUpperCase()}_1`, `${id.toUpperCase()}_2`],
  }) as Device;

const socketReading = (id: string, s1: 'on' | 'off', s2: 'on' | 'off'): Reading =>
  ({
    device_id: id,
    ts: new Date().toISOString(),
    online: true,
    state: s1 === 'on' || s2 === 'on' ? 'on' : 'off',
    socket_states: { 1: s1, 2: s2 },
  }) as Reading;

describe('per-socket shed rows', () => {
  it('an outlet contributes ONE ROW PER SOCKET, named and keyed distinctly', () => {
    const s = summariseShed([outlet('co1')], () => null, {}, ALL);
    expect(s.rows.map((r) => r.key)).toEqual(['co1:1', 'co1:2']);
    expect(s.rows.map((r) => r.name)).toEqual(['CO1 · S1', 'CO1 · S2']);
    expect(s.rows.map((r) => r.socket)).toEqual([1, 2]);
  });

  it('a single-relay device still contributes one row with a null socket', () => {
    const s = summariseShed([dev('a')], () => null, {}, ALL);
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0]).toMatchObject({ socket: null, key: 'a', name: 'A' });
  });

  it('takes the socket count from the registry, never a hard-coded 2', () => {
    // `Device['sockets']` is a two-tuple, so this cannot be expressed without going through
    // `unknown`. The registry it comes from is plain JavaScript and the live flow is hand-edited,
    // so the runtime guard is real and worth pinning.
    const single = { ...outlet('co9'), sockets: ['CO9_1'] } as unknown as Device;
    expect(summariseShed([single], () => null, {}, ALL).rows).toHaveLength(1);
  });

  it('passes the socket to tierOf, so the two sockets can carry different tiers', () => {
    const s = summariseShed([outlet('co1')], (_id, socket) => (socket === 1 ? 'group_1' : 'never'), {}, ALL);
    expect(s.rows.map((r) => r.tier)).toEqual(['group_1', 'never']);
  });

  it('reads "on" PER SOCKET, not from the derived device state', () => {
    // `buildLatest` derives the device `state` as `s1 || s2`. Using it here would mark an
    // already-off relay as one that would act, every time its neighbour was drawing.
    const s = summariseShed([outlet('co1')], () => 'group_1', { co1: socketReading('co1', 'on', 'off') }, ALL);
    expect(s.rows.map((r) => r.on)).toEqual([true, false]);
    expect(s.byTier.group_1).toEqual({ total: 2, effective: 1 });
  });

  it('a reading with no socket_states is NOT assumed on', () => {
    const s = summariseShed([outlet('co1')], () => 'group_1', { co1: on('co1') }, ALL);
    expect(s.rows.every((r) => r.on === false)).toBe(true);
    expect(s.byTier.group_1.effective).toBe(0);
  });

  it('counts SHED POINTS, not devices — the number the panel must also say', () => {
    const s = summariseShed([outlet('co1'), dev('a')], () => 'group_1', { co1: socketReading('co1', 'on', 'on'), a: on('a') }, ALL);
    expect(s.byTier.group_1).toEqual({ total: 3, effective: 3 });
  });

  it('counts an inert socket once per socket, not once per device', () => {
    const s = summariseShed([outlet('co1')], () => 'group_1', { co1: socketReading('co1', 'on', 'on') }, []);
    expect(s.inertCount).toBe(2);
  });
});

describe('shedEligibleCount', () => {
  const tally = (over = {}) => ({
    group_1: { total: 0, effective: 0 },
    group_2: { total: 0, effective: 0 },
    group_3: { total: 0, effective: 0 },
    never: { total: 0, effective: 0 },
    unassigned: { total: 0, effective: 0 },
    ...over,
  });

  it('counts devices assigned to a real shed tier', () => {
    expect(shedEligibleCount(tally({ group_1: { total: 2, effective: 1 }, group_3: { total: 1, effective: 0 } }))).toBe(3);
  });

  /**
   * `never` and `unassigned` are both refusals, and `shedPlan` treats them the same way: a
   * device nobody classified is not a volunteer. Counting either would let auto-shed be armed
   * over a fleet that can never be shed.
   */
  it('counts neither the protected tier nor the unclassified as eligible', () => {
    expect(shedEligibleCount(tally({ never: { total: 5, effective: 0 }, unassigned: { total: 9, effective: 0 } }))).toBe(0);
  });

  /**
   * Assignment, not dispatchability, and not on-ness. Those two are transient — a device that is
   * off now may be on in an hour, and a bridge that cannot command a class now may report it
   * later. Assignment is the only one whose absence makes auto-shed PERMANENTLY inert, which is
   * the thing worth refusing to arm over. `inertCount` already reports the transient gap.
   */
  it('counts an assigned device even when nothing about it could act this minute', () => {
    expect(shedEligibleCount(tally({ group_2: { total: 4, effective: 0 } }))).toBe(4);
  });
});
