import { describe, it, expect } from 'vitest';
import { BUILDING_METER_IDS, DEVICE_REGISTRY } from '@shared/registry.mjs';
import { CIRCUITS } from '@shared/siteConfig.mjs';
import { branchOptions, scopeRows, type CircuitTree } from './circuitBreakdown';
import type { PeriodDeviceReport } from './supabaseReports';

/**
 * RM-082c — narrowing a report to one branch circuit.
 *
 * Expectations are read off the circuit tree, never written as device ids: a literal id here is a
 * promise that the next building has the same wiring (`test/device-ids-in-frontend.test.mjs`). The
 * deeper panel below is invented, because this building's is one level deep and a scope that only
 * works one level deep would pass here and be wrong at the next site.
 */

type Circuit = { id: string; parent_id: string | null; name: string; meter_device_id: string | null };
type Device = { id: string; branch_circuit?: string | null };

const circuits = CIRCUITS as readonly Circuit[];
const registry = DEVICE_REGISTRY as readonly Device[];
const meters = BUILDING_METER_IDS as readonly string[];

const row = (device_id: string): PeriodDeviceReport => ({
  period: 'month',
  period_start: '2026-08-01',
  device_id,
  energy_kwh: 1,
  peak_power_w: null,
  avg_power_w: null,
  online_sample_count: 1440,
  expected_sample_count: 1440,
});

describe('branchOptions on this site', () => {
  it('offers one branch per meter the building total is the sum of, named and ordered by the tree', () => {
    const options = branchOptions();
    expect(options.map((o) => circuits.find((c) => c.id === o.id)?.meter_device_id)).toEqual([...meters]);
    for (const o of options) expect(o.label).toBe(circuits.find((c) => c.id === o.id)?.name);
  });
});

describe('scopeRows on this site', () => {
  const all = registry.map((d) => row(d.id));

  it('returns every row when no branch is chosen', () => {
    expect(scopeRows(all, null)).toEqual(all);
  });

  it('keeps a branch meter and the devices wired to it, and nothing from another branch', () => {
    for (const option of branchOptions()) {
      const circuit = circuits.find((c) => c.id === option.id) as Circuit;
      const kept = scopeRows(all, option.id).map((r) => r.device_id).sort();
      const expected = registry
        .filter((d) => d.id === circuit.meter_device_id || d.branch_circuit === circuit.name)
        .map((d) => d.id)
        .sort();
      expect(kept).toEqual(expected);
      expect(kept).toContain(circuit.meter_device_id);
    }
  });

  it('puts no device in two branches, which would count it twice across them', () => {
    const counts = new Map<string, number>();
    for (const option of branchOptions()) {
      for (const r of scopeRows(all, option.id)) counts.set(r.device_id, (counts.get(r.device_id) ?? 0) + 1);
    }
    expect([...counts.values()].every((n) => n === 1)).toBe(true);
  });

  it('keeps nothing the tree does not place, rather than guessing a branch for it', () => {
    expect(scopeRows([row('not-a-device')], branchOptions()[0].id)).toEqual([]);
  });
});

describe('a deeper panel', () => {
  const tree: CircuitTree = {
    circuits: [
      { id: 'main', parent_id: null, name: 'Main', meter_device_id: null },
      { id: 'east', parent_id: 'main', name: 'East', meter_device_id: 'm-east' },
      { id: 'east-sockets', parent_id: 'east', name: 'East sockets', meter_device_id: 'm-east-sockets' },
      { id: 'west', parent_id: 'main', name: 'West', meter_device_id: 'm-west' },
    ],
    registry: [
      { id: 'm-east' },
      { id: 'm-east-sockets' },
      { id: 'm-west' },
      { id: 'socket-1', branch_circuit: 'East sockets' },
      { id: 'lamp-1', branch_circuit: 'West' },
      { id: 'loose' },
    ],
  };
  const rows = tree.registry.map((d) => row(d.id));

  it('offers only the topmost metered circuits — a sub-meter is detail inside a branch, not a branch', () => {
    expect(branchOptions(tree).map((o) => o.id)).toEqual(['east', 'west']);
  });

  it('keeps a device on a sub-circuit beneath the chosen branch, with its sub-meter', () => {
    expect(scopeRows(rows, 'east', tree).map((r) => r.device_id)).toEqual(['m-east', 'm-east-sockets', 'socket-1']);
    expect(scopeRows(rows, 'west', tree).map((r) => r.device_id)).toEqual(['m-west', 'lamp-1']);
  });

  it('survives a cycle in hand-edited wiring', () => {
    const loop: CircuitTree = {
      circuits: [
        { id: 'a', parent_id: 'b', name: 'A', meter_device_id: 'm-a' },
        { id: 'b', parent_id: 'a', name: 'B', meter_device_id: null },
      ],
      registry: [{ id: 'm-a' }, { id: 'x', branch_circuit: 'B' }],
    };
    expect(() => scopeRows([row('m-a'), row('x')], 'a', loop)).not.toThrow();
  });
});
