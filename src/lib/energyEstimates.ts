/**
 * Energy a held meter counted but did not report, as the Reports page adds it — RM-165, E-260.
 *
 * The circuit meters hold their readings while the site network has no internet, and their lifetime registers
 * keep counting; the reports bank each day's register, which sat still, so that energy was in no day. The edge
 * spreads each recovered step over the held days (`server/heldEnergy.mjs`) into `energy_estimates`
 * (supabase/phase57). Here they are added, once, where the page loads its two energy reads — each circuit's days
 * and each device's period — so every figure built from them (charts, totals, Energy by use, the PDF, the CSV)
 * carries them, and every row keeps `estimated_kwh` so each place can say how much of it is estimated.
 */

import { supabase } from '@/config/supabase';
import { SITE } from '@shared/siteConfig.mjs';
import type { DeviceDayRow } from './circuitSeries';
import type { PeriodDeviceReport, ReportPeriod } from './supabaseReports';

export interface EnergyEstimate {
  device_id: string;
  local_day: string;
  kwh: number;
  held_from: string;
  held_to: string;
}

const MISSING_TABLE = /energy_estimates|PGRST205|42P01|does not exist|schema cache/i;

/** The first local day after a period that starts on `start`. Calendar arithmetic on dates, not instants. */
export function periodEndDay(period: ReportPeriod, start: string): string {
  const d = new Date(`${start.slice(0, 10)}T00:00:00Z`);
  if (period === 'day') d.setUTCDate(d.getUTCDate() + 1);
  else if (period === 'week') d.setUTCDate(d.getUTCDate() + 7);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The estimates of a period's days. Empty, not an error, when the deployment has no account database or phase57
 * is not applied yet: the reports are then what they were, without the held energy.
 */
export async function fetchEnergyEstimates(period: ReportPeriod, start: string, { signal }: { signal?: AbortSignal } = {}): Promise<EnergyEstimate[]> {
  if (supabase === null) return [];
  let request = supabase
    .from('energy_estimates')
    .select('device_id,local_day,kwh,held_from,held_to')
    .eq('site_id', SITE.id)
    .gte('local_day', start.slice(0, 10))
    .lt('local_day', periodEndDay(period, start));
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) {
    if (MISSING_TABLE.test(`${error.code ?? ''} ${error.message}`)) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map((r) => ({ ...r, local_day: String(r.local_day).slice(0, 10), kwh: Number(r.kwh) }));
}

/**
 * The estimates, or none when they cannot be read. They are an addition: a failed read leaves the report as it was
 * without them, never without the report.
 */
export function estimatesOrNone(period: ReportPeriod, start: string, opts: { signal?: AbortSignal } = {}): Promise<EnergyEstimate[]> {
  return fetchEnergyEstimates(period, start, opts).catch(() => []);
}

const add = (a: number | null | undefined, b: number) => Math.round(((a ?? 0) + b) * 1000) / 1000;

/** Each circuit's days, with its estimates added and kept apart in `estimated_kwh`. A held day with no row gets one. */
export function withEstimatedDays(rows: readonly DeviceDayRow[], estimates: readonly EnergyEstimate[]): DeviceDayRow[] {
  if (estimates.length === 0) return [...rows];
  const out = rows.map((r) => ({ ...r }));
  for (const e of estimates) {
    const row = out.find((r) => r.device_id === e.device_id && r.local_day.slice(0, 10) === e.local_day);
    if (row) {
      row.energy_kwh = add(row.energy_kwh, e.kwh);
      row.estimated_kwh = add(row.estimated_kwh, e.kwh);
    } else {
      out.push({
        device_id: e.device_id, local_day: e.local_day, energy_kwh: e.kwh, estimated_kwh: e.kwh, counter_kwh: null, removed_kwh: null,
        clipped_hours: 0, peak_power_w: null, avg_power_w: null, online_minutes: 0, expected_minutes: 0, resolution: null,
      });
    }
  }
  return out.sort((x, y) => x.device_id.localeCompare(y.device_id) || x.local_day.localeCompare(y.local_day));
}

/** Each device's period figure, with its estimates added and kept apart in `estimated_kwh`. */
export function withEstimatedPeriod(rows: readonly PeriodDeviceReport[], estimates: readonly EnergyEstimate[]): PeriodDeviceReport[] {
  if (estimates.length === 0) return [...rows];
  const byDevice = new Map<string, number>();
  for (const e of estimates) byDevice.set(e.device_id, add(byDevice.get(e.device_id), e.kwh));
  return rows.map((r) => {
    const kwh = byDevice.get(r.device_id);
    return kwh === undefined ? r : { ...r, energy_kwh: add(r.energy_kwh, kwh), estimated_kwh: kwh };
  });
}

/** How much of a set of rows is estimated, and on which devices: for the page's notice and the PDF's caveat. */
export function estimatedTotal(rows: readonly { device_id: string; estimated_kwh?: number | null }[]): { kwh: number; deviceIds: string[] } {
  let kwh = 0;
  const ids: string[] = [];
  for (const r of rows) {
    if (!(r.estimated_kwh && r.estimated_kwh > 0)) continue;
    kwh += r.estimated_kwh;
    if (!ids.includes(r.device_id)) ids.push(r.device_id);
  }
  return { kwh: Math.round(kwh * 1000) / 1000, deviceIds: ids };
}

/** The sentence that goes with an estimated figure, the same on the page and in the PDF. */
export function estimateSentence(total: { kwh: number; deviceIds: string[] }, nameOf: (id: string) => string): string | null {
  if (!(total.kwh > 0)) return null;
  const names = total.deviceIds.map(nameOf).join(' and ');
  return `${total.kwh.toFixed(2)} kWh of this is estimated: ${names} held ${total.deviceIds.length === 1 ? 'its' : 'their'} last reading while the site had no internet, and ${total.deviceIds.length === 1 ? 'its register' : 'their registers'} kept counting. The energy counted across the hold is spread over the held days by each meter's usual weekday and weekend use.`;
}
