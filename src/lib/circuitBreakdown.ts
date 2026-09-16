import { BUILDING_METER_IDS, DEVICE_REGISTRY, METERED } from '@shared/registry.mjs';
import { CIRCUITS } from '@shared/siteConfig.mjs';
import { LOADS, LOAD_LABELS, buildingMeterIds, circuitPath, loadOf } from '@shared/circuits.mjs';
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
  /** What the circuit carries — RM-092. Inherited from above when absent. */
  load?: string;
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
/** Every device that measures power: the branch meters and the sub-meters beneath them. From the registry,
 *  so no device is named here. The Reports page reads their daily energy (RM-094). */
export function measuredDeviceIds(): string[] {
  return [...new Set([...(BUILDING_METER_IDS as readonly string[]), ...registry.filter((d) => meteredIds.has(d.id)).map((d) => d.id)])];
}

/** The meters the building total is the sum of, in site order. */
export function buildingMeters(): string[] {
  return [...(BUILDING_METER_IDS as readonly string[])];
}

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

/** What a branch circuit carries — RM-092, in the site's own `circuits.mjs`. */
export type LoadId = 'lighting' | 'aircon' | 'other';

/**
 * Which part of the building a report is narrowed to — RM-093: the whole of it, everything that carries
 * one kind of load (all the lighting branches together), or one branch.
 */
export type ReportScope = { kind: 'all' } | { kind: 'load'; load: LoadId } | { kind: 'circuit'; circuitId: string };

export const ALL_SCOPE: ReportScope = { kind: 'all' };

export interface ScopeOption {
  /** The scope, encoded for one `<select>` value. */
  value: string;
  label: string;
  /** `use` for a category, `circuit` for a branch, `null` for the whole building. */
  group: 'use' | 'circuit' | null;
}

const loadOfCircuit = (tree: CircuitTree, id: string) => loadOf(tree.circuits as never, id) as LoadId | null;

/** The branches a scope takes in, in site order. The whole building is every branch. */
function scopeBranches(scope: ReportScope, tree: CircuitTree): BranchOption[] {
  const branches = branchOptions(tree);
  if (scope.kind === 'all') return branches;
  if (scope.kind === 'load') return branches.filter((b) => loadOfCircuit(tree, b.id) === scope.load);
  return branches.filter((b) => b.id === scope.circuitId);
}

export function encodeScope(scope: ReportScope): string {
  return scope.kind === 'all' ? 'all' : scope.kind === 'load' ? `load:${scope.load}` : `circuit:${scope.circuitId}`;
}

/**
 * A select value back into a scope. Anything this tree does not offer — a category no branch carries, a
 * circuit that is not a branch, a value from an older build — is the whole building, never an empty
 * report that would read as a part of the building that used nothing.
 */
export function decodeScope(value: string, tree: CircuitTree = SITE_TREE): ReportScope {
  const [kind, ...rest] = value.split(':');
  const id = rest.join(':');
  if (kind === 'load' && (LOADS as readonly string[]).includes(id)) {
    const scope: ReportScope = { kind: 'load', load: id as LoadId };
    return scopeBranches(scope, tree).length > 0 ? scope : ALL_SCOPE;
  }
  if (kind === 'circuit' && branchOptions(tree).some((b) => b.id === id)) return { kind: 'circuit', circuitId: id };
  return ALL_SCOPE;
}

/**
 * What a reader can narrow to: the whole building, each category the branches carry, then each branch.
 * Categories are offered only when the branches carry two or more of them — with one, "Lighting" would
 * be the whole building under another name.
 */
export function scopeOptions(tree: CircuitTree = SITE_TREE): ScopeOption[] {
  const branches = branchOptions(tree);
  const carried = new Set(branches.map((b) => loadOfCircuit(tree, b.id)).filter((l): l is LoadId => l !== null));
  const uses =
    carried.size >= 2
      ? (LOADS as readonly LoadId[]).filter((l) => carried.has(l)).map((l) => ({ value: `load:${l}`, label: LOAD_LABELS[l] as string, group: 'use' as const }))
      : [];
  return [
    { value: 'all', label: 'All circuits', group: null },
    ...uses,
    ...branches.map((b) => ({ value: `circuit:${b.id}`, label: b.label, group: 'circuit' as const })),
  ];
}

/** What a narrowed report calls itself: the category or the branch. `null` for the whole building. */
export function scopeLabel(scope: ReportScope, tree: CircuitTree = SITE_TREE): string | null {
  if (scope.kind === 'all') return null;
  if (scope.kind === 'load') return LOAD_LABELS[scope.load] as string;
  return branchOptions(tree).find((b) => b.id === scope.circuitId)?.label ?? null;
}

/** The building meters a scope sums, in site order — never a sub-meter, so nothing is counted twice. */
export function scopeMeterIds(scope: ReportScope, tree: CircuitTree = SITE_TREE): string[] {
  const ids = new Set(scopeBranches(scope, tree).map((b) => b.id));
  return (buildingMeterIds(tree.circuits) as string[]).filter((meterId) => {
    const circuit = tree.circuits.find((c) => c.meter_device_id === meterId);
    return circuit !== undefined && ids.has(circuit.id);
  });
}

/** The category of the branch a device hangs from, or `null` when the tree does not place it. */
export function loadOfDevice(deviceId: string, tree: CircuitTree = SITE_TREE): LoadId | null {
  const own = circuitOfDevice(tree, deviceId);
  return own ? loadOfCircuit(tree, own.id) : null;
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
  scope: ReportScope | string | null,
  tree: CircuitTree = SITE_TREE
): T[] {
  // A bare circuit id is RM-082c's form, kept for its callers.
  const resolved: ReportScope = scope === null ? ALL_SCOPE : typeof scope === 'string' ? { kind: 'circuit', circuitId: scope } : scope;
  if (resolved.kind === 'all') return [...rows];
  // RM-093: a category is every branch that carries it, each with what hangs beneath it.
  const wanted = new Set(resolved.kind === 'circuit' ? [resolved.circuitId] : scopeBranches(resolved, tree).map((b) => b.id));
  const inScope = new Map<string, boolean>();
  return rows.filter((r) => {
    let known = inScope.get(r.device_id);
    if (known === undefined) {
      const own = circuitOfDevice(tree, r.device_id);
      known = own ? (circuitPath(tree.circuits, own.id) as { id: string }[]).some((c) => wanted.has(c.id)) : false;
      inScope.set(r.device_id, known);
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
