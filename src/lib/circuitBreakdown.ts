import { BUILDING_METER_IDS, DEVICE_REGISTRY, METERED } from '@shared/registry.mjs';
import { CIRCUITS } from '@shared/siteConfig.mjs';
import type { PeriodDeviceReport } from './supabaseReports';
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

  const energy = new Map(rows.map((r) => [r.device_id, r.energy_kwh]));
  const meterIds = BUILDING_METER_IDS as readonly string[];

  const segments: CircuitSegment[] = meterIds.map((id) => ({
    label: nameOf(id),
    kwh: energy.get(id) ?? null,
  }));

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
