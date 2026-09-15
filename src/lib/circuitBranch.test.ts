import { describe, it, expect } from 'vitest';
import { BUILDING_METER_IDS, DEVICE_REGISTRY } from '@shared/registry.mjs';
import { CIRCUITS } from '@shared/siteConfig.mjs';
import { branchOf } from './circuitBreakdown';

/**
 * RM-083. The per-device CSV names each device's branch. Expectations are read off the circuit tree,
 * never written as device ids — the rule `test/device-ids-in-frontend.test.mjs` holds the frontend
 * to, because a literal id here is a promise that the next building has the same wiring.
 */

const circuits = CIRCUITS as readonly { name: string; meter_device_id: string | null }[];
const registry = DEVICE_REGISTRY as readonly { id: string; branch_circuit?: string | null }[];

describe('branchOf', () => {
  it('gives a branch meter the circuit it measures', () => {
    const meters = BUILDING_METER_IDS as readonly string[];
    expect(meters.length).toBeGreaterThan(0);
    for (const id of meters) {
      expect(branchOf(id)).toBe(circuits.find((c) => c.meter_device_id === id)?.name ?? null);
    }
  });

  it('gives any other device its own branch circuit', () => {
    const others = registry.filter((d) => d.branch_circuit && !circuits.some((c) => c.meter_device_id === d.id));
    expect(others.length).toBeGreaterThan(0);
    for (const d of others) expect(branchOf(d.id)).toBe(d.branch_circuit);
  });

  it('says nothing about a device the tree does not know, rather than guessing', () => {
    expect(branchOf('no-such-device')).toBeNull();
  });
});
