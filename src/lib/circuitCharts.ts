import { LOADS, LOAD_LABELS, loadOf } from '@shared/circuits.mjs';
import { CIRCUITS } from '@shared/siteConfig.mjs';
import { branchOptions, scopeMeterIds, type LoadId, type ReportScope } from './circuitBreakdown';
import { coverageOf, type PeriodDeviceReport } from './supabaseReports';
import { usableEnergy } from './boundedEnergy';
import { REMOVED_NOTEWORTHY_KWH } from './boundedEnergy';
import type { CircuitTrend, DeviceDayRow } from './circuitSeries';
import type { CircuitDayPoint } from '@/components/reports/charts/circuitDailyEnergyChart';
import type { TrendDay, TrendSeries } from '@/components/reports/charts/circuitPowerTrendChart';
import type { CircuitSegment } from '@/components/reports/charts/circuitBreakdownChart';

/**
 * Rows into circuit chart inputs — RM-095. Pure, and naming no device: every circuit, meter and
 * category comes from the site's circuit tree.
 *
 * COLOUR FOLLOWS THE CIRCUIT. A branch's colour is its place on the panel (`branchOptions` order), and a
 * category's is its place in `LOADS`, so narrowing to Lighting, or a week in which the aircon used the
 * most, never repaints one circuit as another. The palette has four series colours and this building
 * four branches; a fifth wraps, which the legend still disambiguates.
 */

export interface CircuitRef {
  id: string;
  label: string;
  meterId: string;
  colourIndex: number;
}

const HOUR_MS = 3_600_000;
const circuits = CIRCUITS as readonly { id: string; meter_device_id: string | null }[];

/** The branches a scope charts, each with its meter and its fixed colour. */
export function circuitRefs(scope: ReportScope): CircuitRef[] {
  const all = branchOptions();
  const meters = new Set(scopeMeterIds(scope));
  return all.flatMap((b, i) => {
    const meterId = circuits.find((c) => c.id === b.id)?.meter_device_id;
    return meterId && meters.has(meterId) ? [{ id: b.id, label: b.label, meterId, colourIndex: i }] : [];
  });
}

/** Every local day in the rows, each with each circuit's bounded energy in `refs` order. */
export function circuitDayPoints(rows: readonly DeviceDayRow[], refs: readonly CircuitRef[]): CircuitDayPoint[] {
  const byKey = new Map(rows.map((r) => [`${r.device_id}|${r.local_day.slice(0, 10)}`, r]));
  const days = [...new Set(rows.map((r) => r.local_day.slice(0, 10)))].sort();
  return days.map((day) => {
    const dayRows = refs.map((c) => byKey.get(`${c.meterId}|${day}`));
    const values = dayRows.map((r) => (r && r.online_minutes > 0 && r.energy_kwh !== null ? Number(r.energy_kwh) : null));
    const notes = refs.flatMap((c, k) => {
      const removed = dayRows[k]?.removed_kwh;
      return removed !== null && removed !== undefined && Number(removed) > REMOVED_NOTEWORTHY_KWH
        ? [`${c.label}: ${Number(removed).toFixed(2)} kWh counter jump not counted`]
        : [];
    });
    return {
      day,
      label: String(Number(day.slice(8, 10))),
      values,
      observed: values.some((v) => v !== null),
      // A total only when every circuit on the chart was recorded in full; otherwise at least this much.
      complete: dayRows.every((r) => r !== undefined && coverageOf(r.online_minutes, r.expected_minutes)?.band === 'complete'),
      ...(notes.length > 0 ? { notes } : {}),
    };
  });
}

/**
 * The trend chart's series and day boundaries. `utcOffsetMinutes` is the building's own — the same
 * `SITE.utc_offset_minutes` the rest of the app frames local days with — so a day starts at the
 * building's midnight, not the reader's.
 */
export function trendChartInput(trend: CircuitTrend, refs: readonly CircuitRef[], utcOffsetMinutes: number): { series: TrendSeries[]; days: TrendDay[] } {
  const count = Math.max(0, Math.round((trend.endMs - trend.startMs) / HOUR_MS));
  const series = refs.map((c) => {
    const slots = trend.series.find((s) => s.meterId === c.meterId)?.slots ?? [];
    const points = Array.from({ length: count }, (_, i) => slots[i]?.avgW ?? null);
    return { id: c.id, label: c.label, colourIndex: c.colourIndex, points };
  });
  const days: TrendDay[] = [];
  for (let i = 0; i < count; i++) {
    const local = new Date(trend.startMs + i * HOUR_MS + utcOffsetMinutes * 60_000);
    if (local.getUTCHours() !== 0 && i !== 0) continue;
    const key = local.toISOString().slice(0, 10);
    if (days.some((d) => d.key === key)) continue;
    days.push({ index: i, label: String(local.getUTCDate()), key });
  }
  return { series, days };
}

/**
 * The building's energy by what it was for: each category's building meters summed. A category with an
 * impossible figure among its meters is left out of the split and says why (RM-090), rather than being
 * drawn smaller than it was.
 */
export function loadShareSegments(rows: readonly PeriodDeviceReport[]): (CircuitSegment & { id: LoadId; colourIndex: number })[] {
  const byMeter = new Map(rows.map((r) => [r.device_id, r]));
  return (LOADS as readonly LoadId[]).flatMap((load) => {
    const meters = scopeMeterIds({ kind: 'load', load });
    if (meters.length === 0) return [];
    const label = LOAD_LABELS[load] as string;
    const colourIndex = (LOADS as readonly string[]).indexOf(load);
    const present = meters.map((m) => byMeter.get(m)).filter((r): r is PeriodDeviceReport => r !== undefined);
    if (present.some((r) => r.energy_kwh !== null && usableEnergy(r) === null)) {
      return [{ id: load, label, kwh: null, excluded: 'a meter on it stored more than it could have drawn', colourIndex }];
    }
    const values = present.map(usableEnergy).filter((v): v is number => v !== null);
    return [{ id: load, label, kwh: values.length > 0 ? values.reduce((a, v) => a + v, 0) : null, colourIndex }];
  });
}

/** A branch's category, for a table column. */
export function loadLabelOfCircuit(circuitId: string): string | null {
  const load = loadOf(CIRCUITS as never, circuitId) as LoadId | null;
  return load ? (LOAD_LABELS[load] as string) : null;
}
