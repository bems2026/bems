/**
 * Monthly energy reports — reads the rows `generate_monthly_report` stores
 * (`supabase/phase12_monthly_reports.sql`). Read-only; nothing in the browser generates a
 * report, and RLS grants `authenticated` select and nothing else.
 *
 * WHY COVERAGE TRAVELS WITH EVERY FIGURE:
 * a device that was offline for most of a month still produces a real, small, confident
 * kWh number. Presenting it without saying how much of the month was actually observed is
 * the same failure Phase 9 fixed on the charts — a plausible answer that is silently wrong.
 * Every consumer of this module is expected to render `coverageOf()` next to the value, and
 * `ReportsPage` does. This matters acutely right now: the field devices have been offline
 * since 2026-08-20 (ROADMAP RM-001), so recent months are mostly gap.
 */

import { supabase } from '@/config/supabase';

export interface MonthlyDeviceReport {
  month: string;
  device_id: string;
  energy_kwh: number | null;
  peak_power_w: number | null;
  avg_power_w: number | null;
  online_sample_count: number;
  expected_sample_count: number;
}

export interface MonthlyBuildingReport {
  month: string;
  energy_kwh: number | null;
  peak_total_power_w: number | null;
  avg_voltage: number | null;
  phase_current_red_avg: number | null;
  phase_current_yellow_avg: number | null;
  phase_current_blue_avg: number | null;
  command_count: number;
  command_count_manual: number;
  command_count_schedule: number;
  command_count_autoshed: number;
  anomaly_count: number;
  online_sample_count: number;
  expected_sample_count: number;
  generated_at: string;
}

export type CoverageBand = 'complete' | 'partial' | 'sparse' | 'none';

export interface Coverage {
  ratio: number;
  band: CoverageBand;
}

/**
 * Pure. What fraction of the month was actually observed, and how much that figure can carry.
 *
 * Returns `null` — not zero — when the expected count is missing or zero, because "we cannot
 * say" and "we saw nothing" are different facts, and only one of them is a measurement.
 *
 * The bands are deliberately conservative. `partial` starts at half a month because a figure
 * derived from less than that should never be quoted as the month's consumption without the
 * caveat attached, and `complete` demands 95% rather than 100% because the ingest daemon
 * restarts, and a handful of missed minutes across a month is not a gap worth flagging.
 */
export function coverageOf(onlineSamples: number, expectedSamples: number): Coverage | null {
  if (!Number.isFinite(expectedSamples) || expectedSamples <= 0) return null;
  if (!Number.isFinite(onlineSamples) || onlineSamples < 0) return null;
  const ratio = Math.min(onlineSamples / expectedSamples, 1);
  if (ratio >= 0.95) return { ratio, band: 'complete' };
  if (ratio >= 0.5) return { ratio, band: 'partial' };
  if (ratio > 0) return { ratio, band: 'sparse' };
  return { ratio: 0, band: 'none' };
}

/** Pure. Whether a figure from this coverage may be presented as the month's answer without
 * a caveat beside it. Only `complete` may. */
export function isQuotable(coverage: Coverage | null): boolean {
  return coverage?.band === 'complete';
}

/** Pure. `2026-07-01` -> `July 2026`, without pulling a date library in for one format. */
export function formatMonth(month: string): string {
  const [y, m] = month.slice(0, 10).split('-');
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  if (Number.isNaN(date.getTime())) return month;
  return date.toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function requireSupabase() {
  if (!supabase) {
    throw new Error('Supabase is not configured (VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY unset)');
  }
  return supabase;
}

/** Every month that has a generated report, newest first. Explicitly bounded — PostgREST
 * caps silently, and this project has been bitten by inferring completeness from a response
 * that had no way to signal truncation. */
export async function getReportMonths(): Promise<MonthlyBuildingReport[]> {
  const { data, error } = await requireSupabase()
    .from('monthly_building_reports')
    .select('*')
    .order('month', { ascending: false })
    .limit(240);
  if (error) throw new Error(`Supabase report list failed: ${error.message}`);
  return (data ?? []) as MonthlyBuildingReport[];
}

/** The per-device rows for one month. At most one row per device, so the device count is the
 * natural bound. */
export async function getDeviceReports(month: string): Promise<MonthlyDeviceReport[]> {
  const { data, error } = await requireSupabase()
    .from('monthly_reports')
    .select('*')
    .eq('month', month)
    .order('energy_kwh', { ascending: false, nullsFirst: false })
    .limit(500);
  if (error) throw new Error(`Supabase report fetch failed for ${month}: ${error.message}`);
  return (data ?? []) as MonthlyDeviceReport[];
}
