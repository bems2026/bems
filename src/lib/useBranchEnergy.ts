import { useMemo } from 'react';
import { BUILDING_METER_IDS } from '@shared/registry.mjs';
import { useDeviceStore, historyFor } from '@/stores/deviceStore';
import { useNowTick } from './useNowTick';
import { branchEnergySplit, type BranchEnergySplit, type EnergyPeriod } from './branchEnergy';
import type { HistoryPoint } from './types';

const MINUTE = 60_000;

/**
 * The branch split for `period`, as every card that shows it must read it — RM-078.
 *
 * Overview's Energy Breakdown and Analytics' "By branch" both call this, so the rows, the total,
 * the rounding and the notices come from one derivation and cannot disagree. Freeze detection reads
 * each building meter's 24h history, which Overview's Energy Flow card and the Analytics history
 * hook both keep loaded.
 */
export function useBranchEnergy(period: EnergyPeriod): BranchEnergySplit {
  const devices = useDeviceStore((s) => s.devices);
  const readings = useDeviceStore((s) => s.latestReadings);
  const totals = useDeviceStore((s) => s.totals);
  const history = useDeviceStore((s) => s.history);
  // Expiry and "still frozen" are decided on a scale of minutes, so the split is recomputed on the
  // minute rather than on every tick of the shared clock.
  const minute = Math.floor(useNowTick() / MINUTE) * MINUTE;

  const meterHistory = useMemo(() => {
    const out: Record<string, HistoryPoint[]> = {};
    for (const id of BUILDING_METER_IDS as readonly string[]) out[id] = historyFor(history, id, '24h');
    return out;
  }, [history]);

  return useMemo(
    () => branchEnergySplit({ devices, readings, totals, historyByDevice: meterHistory, period, nowMs: minute }),
    [devices, readings, totals, meterHistory, period, minute],
  );
}
