import { BUILDING_METER_IDS, DEVICE_REGISTRY, METERED } from '@shared/registry.mjs';
import { CIRCUITS } from '@shared/siteConfig.mjs';
import { buildingMeterIds, circuitPath } from '@shared/circuits.mjs';
import type { PeriodDeviceReport } from './supabaseReports';
import { usableEnergy } from './boundedEnergy';
import type { CircuitSegment } from '@/components/reports/charts/circuitBreakdownChart';

/**
 * Turning a period's per-device rows into a breakdown of the building.
 *
 * NOTHING HERE NAMES A DEVICE. The first version of this lived inline in `ReportsPage` and
 * reached for `mtr_co_yellow` and `/^co\d$/` by hand — which `test/device-ids-in-frontend.test.mjs`
 * refused, and rightly: every one of those literals is a promise that the next building has the
 * same wiring. It is the same rule FI-017 enforced when `BUILT_IN_DEVICES` moved out of the
 * shared registry, and RM-033's whole reason for existing.
 *
 * The shape comes from the circuit tree instead. `BUILDING_METER_IDS` is the derived constant
 * `shared/buildLatest.mjs` sums to produce the building total in the first place, so the chart
 * and the figure printed above it cannot disagree about which meters make the whole. Which
 * devices sit beneath a branch comes from each device's own `branch_circuit`, matched against
 * the circuit's name.
 */

interface Circuit {
  id: string;
  parent_id: string | null;
  name: string;
  meter_device_id: string | null;
}

interface RegistryDevice {
  id: string;
  display_name?: string;
  branch_circuit?: string | null;
  ctx?: unknown;
}

const circuits = CIRCUITS as readonly Circuit[];
const registry = DEVICE_REGISTRY as readonly RegistryDevice[];
const meteredIds = new Set((METERED as readonly RegistryDevice[]).map((d) => d.id));

/** The circuit a meter measures, if the tree declares one. */
function circuitForMeter(meterId: string): Circuit | undefined {
  return circuits.find((c) => c.meter_device_id === meterId);
}

/**
 * The branch circuit a device sits on, by name — RM-083, for the per-device CSV's Branch column.
 *
 * A branch meter's branch is the circuit it measures; any other device's is its own
 * `branch_circuit`. Derived from the tree like everything else here, so no device is named. `null`
 * when the tree does not say, which the CSV leaves as an empty cell rather than a guess.
 */
export function branchOf(deviceId: string): string | null {
  const measured = circuitForMeter(deviceId);
  if (measured) return measured.name;
  return registry.find((d) => d.id === deviceId)?.branch_circuit ?? null;
}

/**
 * The wiring a scope is read from. The page uses this deployment's; a test can hand in a deeper
 * panel than this building has, which is the only way to know the scope works below one level.
 */
export interface CircuitTree {
  circuits: readonly Circuit[];
  registry: readonly { id: string; branch_circuit?: string | null }[];
}

const SITE_TREE: CircuitTree = { circuits, registry };

export interface BranchOption {
  /** The circuit's id — stable, and never shown. */
  id: string;
  /** The circuit's name, as the panel schedule and each device's `branch_circuit` spell it. */
  label: string;
}

/**
 * The branches a report can be narrowed to — RM-082c. One per meter the building total is the sum of,
 * in that order: a sub-meter is detail inside a branch already counted, so offering it beside its own
 * branch would invite reading the two as parts of the same whole.
 */
export function branchOptions(tree: CircuitTree = SITE_TREE): BranchOption[] {
  return (buildingMeterIds(tree.circuits) as string[]).flatMap((meterId) => {
    const circuit = tree.circuits.find((c) => c.meter_device_id === meterId);
    return circuit ? [{ id: circuit.id, label: circuit.name }] : [];
  });
}

/** The circuit a device hangs from: the one it meters, else the one its own record names. */
function circuitOfDevice(tree: CircuitTree, deviceId: string): Circuit | undefined {
  const metered = tree.circuits.find((c) => c.meter_device_id === deviceId);
  if (metered) return metered;
  const named = tree.registry.find((d) => d.id === deviceId)?.branch_circuit;
  return named ? tree.circuits.find((c) => c.name === named) : undefined;
}

/**
 * The rows on one branch circuit, or every row when none is chosen — RM-082c.
 *
 * A device is on a branch when the branch is anywhere on its path from the service entrance: a
 * sub-circuit's devices belong to the branch above them. The walk is `circuitPath`'s, depth-capped
 * and cycle-safe, because `parent_id` is hand-edited. A device the tree does not place is on no
 * branch — kept out rather than guessed into one, and the page counts what it left out.
 */
export function scopeRows<T extends { device_id: string }>(
  rows: readonly T[],
  circuitId: string | null,
  tree: CircuitTree = SITE_TREE
): T[] {
  if (circuitId === null) return [...rows];
  const onBranch = new Map<string, boolean>();
  return rows.filter((r) => {
    let known = onBranch.get(r.device_id);
    if (known === undefined) {
      const own = circuitOfDevice(tree, r.device_id);
      known = own ? (circuitPath(tree.circuits, own.id) as { id: string }[]).some((c) => c.id === circuitId) : false;
      onBranch.set(r.device_id, known);
    }
    return known;
  });
}

export interface Breakdown {
  segments: CircuitSegment[];
  /**
   * The branch whose own sub-meters account for the least of what it measured, when there is
   * one. Deliberately NOT "building minus branches", which is structurally zero since RM-057 and
   * would draw as a broken chart rather than as a finding.
   */
  untracked?: { label: string; kwh: number | null };
}

export function buildBreakdown(
  rows: readonly PeriodDeviceReport[],
  nameOf: (id: string) => string
): Breakdown {
  if (rows.length === 0) return { segments: [] };

  // RM-090: an impossible stored figure is neither a share nor a sub-meter's total — it is left out,
  // and the segment says so rather than reading as unmetered.
  const energy = new Map(rows.map((r) => [r.device_id, usableEnergy(r)]));
  const refused = new Set(rows.filter((r) => r.energy_kwh !== null && usableEnergy(r) === null).map((r) => r.device_id));
  const meterIds = BUILDING_METER_IDS as readonly string[];

  const segments: CircuitSegment[] = meterIds.map((id) =>
    refused.has(id)
      ? { label: nameOf(id), kwh: null, excluded: 'its stored figure is more than it could have drawn' }
      : { label: nameOf(id), kwh: energy.get(id) ?? null }
  );

  /**
   * Devices the period reported on that no meter can account for — the seven light switches
   * here, which have no metering at all. Named rather than omitted: a reader who cannot see
   * them listed will assume lighting is inside one of the segments above.
   */
  const unmetered = rows.filter((r) => !meteredIds.has(r.device_id) && !meterIds.includes(r.device_id));
  if (unmetered.length > 0) {
    segments.push({ label: `${unmetered.length} unmetered devices`, kwh: null });
  }

  // For each metered branch, how much of what it measured its own sub-meters account for.
  let worst: Breakdown['untracked'];
  let worstGap = 0;
  for (const meterId of meterIds) {
    const branchKwh = energy.get(meterId);
    if (typeof branchKwh !== 'number') continue;
    const circuit = circuitForMeter(meterId);
    if (!circuit) continue;

    const children = registry.filter(
      (d) => d.branch_circuit === circuit.name && d.id !== meterId && meteredIds.has(d.id)
    );
    // A branch with no sub-meters is not "100% unattributed" — nothing was ever claiming to
    // account for it, and reporting that as a gap would flag every correctly-wired branch.
    if (children.length === 0) continue;

    const attributed = children.reduce((a, d) => a + (energy.get(d.id) ?? 0), 0);
    const gap = branchKwh - attributed;
    if (gap > worstGap) {
      worstGap = gap;
      worst = { label: nameOf(meterId), kwh: gap };
    }
  }

  return worst ? { segments, untracked: worst } : { segments };
}
