/**
 * Long-range history (beyond the bridge's 24h ring buffer) — reads directly from
 * Supabase's `readings` table (architecture plan Phase 4). The bridge stays the source
 * for the existing 1h/6h/24h ranges, unchanged; this is purely additive.
 *
 * `supabase/schema.sql`'s `readings` table carries every device's every poll, including
 * unmetered/offline rows with `power_w: null` — this module drops those rather than
 * coercing to 0, same rule `chartParams.ts`'s `pointValue` already follows for the bridge
 * path: a missing reading and a real zero are different facts.
 */

import { supabase } from '@/config/supabase';
import type { HistoryPoint } from './types';

export type LongRange = '7d' | '30d';

const RANGE_MS: Record<LongRange, number> = {
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

/** How often to re-poll a long-range view. Far less frequent than the bridge's 60s
 * sample rate on purpose — a week/month-wide chart doesn't need per-minute freshness,
 * and re-querying Supabase that often would be pure waste. */
export const LONG_HISTORY_REFRESH_MS = 5 * 60 * 1000;

interface ReadingsRow {
  ts: string;
  power_w: number | null;
  voltage: number | null;
  current: number | null;
}

/** Pure — no I/O. Exported separately from `getLongHistory` so the drop-null-power
 * behavior is unit-testable without a live Supabase project. */
export function mapReadingsRows(rows: ReadingsRow[]): HistoryPoint[] {
  const points: HistoryPoint[] = [];
  for (const row of rows) {
    if (row.power_w === null) continue;
    points.push({
      ts: row.ts,
      power_w: row.power_w,
      voltage: row.voltage ?? undefined,
      current: row.current ?? undefined,
    });
  }
  return points;
}

/**
 * Throws if Supabase isn't configured — callers must check `supabase !== null`
 * (re-exported from `@/config/supabase`) before calling this and fall back gracefully
 * (e.g. hide the 7d/30d range options) rather than surfacing a raw error to the UI.
 */
export async function getLongHistory(deviceId: string, range: LongRange): Promise<HistoryPoint[]> {
  if (!supabase) {
    throw new Error('Supabase is not configured (VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY unset)');
  }
  const sinceIso = new Date(Date.now() - RANGE_MS[range]).toISOString();
  const { data, error } = await supabase
    .from('readings')
    .select('ts,power_w,voltage,current')
    .eq('device_id', deviceId)
    .gte('ts', sinceIso)
    .order('ts', { ascending: true });
  if (error) throw new Error(`Supabase history fetch failed for ${deviceId}: ${error.message}`);
  return mapReadingsRows(data ?? []);
}
