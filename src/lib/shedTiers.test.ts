import { describe, it, expect } from 'vitest';
import { summariseShed, isSheddableClass, SHED_ORDER } from './shedTiers';
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
    expect(s.excluded[0].reason).toMatch(/IR/);
    expect(s.excluded[0].reason).toMatch(/never relay-cut/);
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
