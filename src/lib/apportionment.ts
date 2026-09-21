import { CIRCUITS } from '@shared/siteConfig.mjs';
import type { LoadId } from './circuitBreakdown';
import { energyFlagOf, usableEnergy, type EnergyFlag } from './boundedEnergy';
import { coverageOf, type Coverage, type PeriodDeviceReport } from './supabaseReports';
import { toHourEnergyPoints, type HourEnergyRow } from './reportSeries';
import type { DeviceDayRow } from './circuitSeries';
import type { DailyEnergyPoint } from '@/components/reports/charts/dailyEnergyChart';
import type { HourlyEnergyPoint } from '@/components/reports/charts/hourlyEnergyChart';

/**
 * A load nobody metered, as the estimate it is — RM-130 / FI-035.
 *
 * C.O Yellow feeds the CARE office's outlets and, in another room, the director's office aircon,
 * which the operator puts at about two thirds of the branch (2026-09-22). No meter sits on that
 * aircon. Its figure here is the branch's MEASURED energy times a share DECLARED in the site file
 * with its basis — an apportionment, which is a different kind of number from everything else on
 * the Reports page, and is rendered as such: "≈", the word "estimate", the basis, and every caveat
 * the branch's own figure carries. A refused branch figure (RM-090) refuses its share too; a partly
 * recorded branch gives a partly recorded estimate; a branch that recorded nothing gives nothing.
 *
 * The measured charts are not touched. `load: 'other'` on the branch still groups all of it as
 * Others in "Energy by use"; the section that shows this estimate says how much it would move.
 * Mixing an estimate into a measured split would make the split unauditable.
 *
 * Pure, and naming no device: the branch, the share and its basis come from `CIRCUITS`.
 */

export interface ApportionedEstimate {
  id: string;
  label: string;
  load: LoadId;
  branchId: string;
  branchLabel: string;
  /** The category the whole branch is counted under in the measured charts — Others, here. */
  branchLoad: LoadId;
  meterId: string;
  share: number;
  basis: string;
  /** The branch's own usable figure for the period; null when not stored, not observed, or refused. */
  branchKwh: number | null;
  estimatedKwh: number | null;
  /** What the share leaves for the branch's own load — the outlets, here. */
  remainderKwh: number | null;
  coverage: Coverage | null;
  flag: EnergyFlag | null;
}

interface ApportionmentDecl {
  id: string;
  label: string;
  load: LoadId;
  share: number;
  basis: string;
}

interface CircuitDecl {
  id: string;
  name: string;
  load?: LoadId;
  meter_device_id?: string;
  apportionment?: readonly ApportionmentDecl[];
}

export function apportionedEstimates(rows: readonly PeriodDeviceReport[]): ApportionedEstimate[] {
  const byDevice = new Map(rows.map((r) => [r.device_id, r]));
  const out: ApportionedEstimate[] = [];
  for (const circuit of CIRCUITS as readonly CircuitDecl[]) {
    if (!circuit.apportionment || !circuit.meter_device_id) continue;
    const row = byDevice.get(circuit.meter_device_id);
    const branchKwh = row && row.online_sample_count > 0 ? usableEnergy(row) : null;
    for (const a of circuit.apportionment) {
      out.push({
        id: a.id,
        label: a.label,
        load: a.load,
        branchId: circuit.id,
        branchLabel: circuit.name,
        branchLoad: circuit.load ?? 'other',
        meterId: circuit.meter_device_id,
        share: a.share,
        basis: a.basis,
        branchKwh,
        estimatedKwh: branchKwh === null ? null : branchKwh * a.share,
        remainderKwh: branchKwh === null ? null : branchKwh * (1 - a.share),
        coverage: row ? coverageOf(row.online_sample_count, row.expected_sample_count) : null,
        flag: row ? energyFlagOf(row) : null,
      });
    }
  }
  return out;
}

/** "about two thirds", "about half", "about 40%" — the share in the office's words. */
export function shareWords(share: number): string {
  const named: [number, string][] = [
    [1 / 4, 'a quarter'],
    [1 / 3, 'a third'],
    [1 / 2, 'half'],
    [2 / 3, 'two thirds'],
    [3 / 4, 'three quarters'],
  ];
  const hit = named.find(([v]) => Math.abs(v - share) < 0.01);
  return hit ? `about ${hit[1]}` : `about ${Math.round(share * 100)}%`;
}

/**
 * The estimate, day by day — the branch's bounded daily energy (phase42) times the share, so the
 * estimate's bars sit on the same footing as the circuit's and sum to the same period figure. An
 * unobserved day stays a gap; a partly recorded one stays a floor.
 */
export function estimateDayPoints(rows: readonly DeviceDayRow[], e: ApportionedEstimate): DailyEnergyPoint[] {
  return rows
    .filter((r) => r.device_id === e.meterId)
    .sort((a, b) => a.local_day.localeCompare(b.local_day))
    .map((r) => {
      const observed = r.online_minutes > 0 && r.energy_kwh !== null;
      return {
        day: r.local_day.slice(0, 10),
        label: String(Number(r.local_day.slice(8, 10))),
        kwh: observed ? Number(r.energy_kwh) * e.share : null,
        observed,
        complete: coverageOf(r.online_minutes, r.expected_minutes)?.band === 'complete',
      };
    });
}

/** The estimate, hour by hour for a day — the branch's hourly credits times the share, power too. */
export function estimateHourPoints(rows: readonly HourEnergyRow[], e: ApportionedEstimate): HourlyEnergyPoint[] {
  return toHourEnergyPoints(rows.filter((r) => r.device_id === e.meterId)).map((p) => ({
    ...p,
    kwh: p.kwh === null ? null : p.kwh * e.share,
    avgW: p.avgW === null ? null : p.avgW * e.share,
    maxW: p.maxW === null ? null : p.maxW * e.share,
  }));
}
