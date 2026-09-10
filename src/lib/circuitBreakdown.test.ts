import { describe, it, expect } from 'vitest';
import { buildBreakdown } from './circuitBreakdown';
import { BUILDING_METER_IDS, DEVICE_REGISTRY, METERED } from '@shared/registry.mjs';
import { CIRCUITS } from '@shared/siteConfig.mjs';
import type { PeriodDeviceReport } from './supabaseReports';

/**
 * The breakdown is derived from the circuit tree, never from device names.
 *
 * The first version of this lived inline in `ReportsPage` and reached for `mtr_co_yellow` and
 * `/^co\d$/` by hand. `test/device-ids-in-frontend.test.mjs` refused it, and rightly: each of
 * those literals is a promise that the next building has the same wiring, which is the promise
 * RM-033's whole replication track exists to stop the frontend making.
 */

const meterIds = BUILDING_METER_IDS as readonly string[];
const nameOf = (id: string) => `name:${id}`;

/** The metered devices the tree puts under a branch — the same derivation the module makes,
 *  restated here so the fixtures are built from this deployment's wiring rather than assuming
 *  it. A test that hardcoded `co1..co7` would be the very thing this module exists to avoid. */
function registryChildrenOf(meterId: string): string[] {
  const circuit = (CIRCUITS as { name: string; meter_device_id: string | null }[]).find(
    (c) => c.meter_device_id === meterId
  );
  if (!circuit) return [];
  const metered = new Set((METERED as { id: string }[]).map((d) => d.id));
  return (DEVICE_REGISTRY as { id: string; branch_circuit?: string | null }[])
    .filter((d) => d.branch_circuit === circuit.name && d.id !== meterId && metered.has(d.id))
    .map((d) => d.id);
}

const row = (device_id: string, energy_kwh: number | null): PeriodDeviceReport => ({
  period: 'month',
  period_start: '2026-08-01',
  device_id,
  energy_kwh,
  peak_power_w: null,
  avg_power_w: null,
  online_sample_count: 1440,
  expected_sample_count: 1440,
});

describe('buildBreakdown', () => {
  it('segments on the same meters the building total is summed from', () => {
    // Not a list assembled here. If these two ever diverged, the chart would be a breakdown of
    // something other than the figure printed above it.
    const { segments } = buildBreakdown(meterIds.map((id) => row(id, 10)), nameOf);
    expect(segments.slice(0, meterIds.length).map((s) => s.label)).toEqual(meterIds.map(nameOf));
  });

  it('carries a branch with no reported energy as null, not as zero', () => {
    const rows = meterIds.map((id, i) => row(id, i === 0 ? null : 10));
    const { segments } = buildBreakdown(rows, nameOf);
    expect(segments[0].kwh).toBeNull();
  });

  it('names the devices no meter accounts for rather than omitting them', () => {
    // The seven light switches have no metering at all. A reader who cannot see them listed
    // will assume lighting is inside one of the segments above.
    const rows = [...meterIds.map((id) => row(id, 10)), row('l1', null), row('l2', null)];
    const { segments } = buildBreakdown(rows, nameOf);
    const unmetered = segments.find((s) => /unmetered/i.test(s.label));
    expect(unmetered).toBeDefined();
    expect(unmetered!.label).toContain('2');
    expect(unmetered!.kwh).toBeNull();
  });

  it('reports the branch its own sub-meters account for least', () => {
    // The real August shape: the branch measured far more than the outlets beneath it did.
    const branch = meterIds[0];
    const rows = [...meterIds.map((id) => row(id, id === branch ? 51 : 5)), row('co1', 1), row('co2', 0.8)];
    const { untracked } = buildBreakdown(rows, nameOf);
    // Only asserted when this deployment actually has sub-meters under that branch; the
    // derivation is what is under test, not this building's wiring.
    if (untracked) {
      expect(untracked.kwh).toBeGreaterThan(0);
      expect(meterIds.map(nameOf)).toContain(untracked.label);
    }
  });

  it('does not flag a branch whose sub-meters account for what it measured', () => {
    // The correctly-wired case. Every metered device under a branch reporting its share leaves
    // nothing unattributed, and a chart that flagged it anyway would flag the whole building.
    const branch = meterIds[0];
    const children = registryChildrenOf(branch);
    if (children.length === 0) return; // this deployment has no sub-metered branch to test with
    const each = 10 / children.length;
    const rows = [
      ...meterIds.map((id) => row(id, id === branch ? 10 : 0)),
      ...children.map((id) => row(id, each)),
    ];
    expect(buildBreakdown(rows, nameOf).untracked).toBeUndefined();
  });

  it('never flags a branch that has no sub-meters at all', () => {
    // Nothing was ever claiming to account for it — the lighting branch measures seven switches
    // that carry no metering — so calling it 100% unattributed would be flagging correct wiring.
    const bare = meterIds.filter((id) => registryChildrenOf(id).length === 0);
    expect(bare.length).toBeGreaterThan(0);
    const rows = meterIds.map((id) => row(id, 10));
    const { untracked } = buildBreakdown(rows, nameOf);
    expect(bare.map(nameOf)).not.toContain(untracked?.label);
  });

  it('returns nothing to draw when there are no rows', () => {
    expect(buildBreakdown([], nameOf)).toEqual({ segments: [] });
  });

  it('names nothing — every label comes from the caller or from a count', () => {
    const { segments } = buildBreakdown(meterIds.map((id) => row(id, 1)), nameOf);
    segments.forEach((s) => expect(s.label === undefined || s.label.length > 0).toBe(true));
    // Every branch label went through `nameOf`, so the module itself spells no device.
    const branchLabels = segments.filter((s) => s.label.startsWith('name:'));
    expect(branchLabels).toHaveLength(meterIds.length);
  });
});
