/**
 * Long-range history (beyond the bridge's 24h ring buffer) — reads from Supabase's
 * `readings` table via the `readings_buckets` RPC (`supabase/phase9_history_buckets.sql`).
 * The bridge stays the source for the existing 1h/6h/24h ranges, unchanged.
 *
 * WHY AN RPC AND NOT A PLAIN SELECT — the bug this replaces:
 * this module used to select raw rows with no `.limit()` and no pagination, on the
 * assumption that asking for no limit returns everything. PostgREST caps every result at
 * `db-max-rows` (1000 on this project) and gives no signal that it did: no error, no flag,
 * just a shorter array. With `order('ts', ascending: true)` the 1000 rows kept were the
 * OLDEST in the window. Measured on the live Pi on 2026-08-21: 6,614 rows existed in
 * mtr_co_yellow's 7-day window, 1,000 came back, and the "7d" chart drew 17h39m of data
 * ending four days in the past — with axes, a plausible curve, and no way for anyone to
 * tell. An explicit `limit=20000` still returns 1000, so no client-side change could have
 * fixed it; the aggregation has to happen in Postgres.
 *
 * The RPC also averages ONLY online samples. Selecting `ts,power_w,voltage,current` never
 * carried `online`, so a device that had been offline for a day still charted its frozen
 * last wattage as a real, flat line — throwing away, at the last step, the honesty
 * `shared/buildLatest.mjs` enforces for building totals (EX-063).
 *
 * `readings` carries rows with `power_w: null`, and a bucket with no online sample averages
 * to null too. Both are dropped rather than coerced to 0, the same rule `chartParams.ts`'s
 * `pointValue` follows for the bridge path: a missing reading and a real zero are different
 * facts.
 */

import { supabase } from '@/config/supabase';
import type { HistoryPoint } from './types';

export type LongRange = '7d';

const RANGE_MS: Record<LongRange, number> = {
  '7d': 7 * 24 * 60 * 60 * 1000,
};

/**
 * Bucket width per range. Chosen so the point count lands well under both the RPC's own
 * `max_buckets` guard and PostgREST's 1000-row cap, with enough resolution to still show a
 * daily load shape: 7d/15min = 672 points.
 */
const BUCKET_SECONDS: Record<LongRange, number> = {
  '7d': 15 * 60,
};

/** Above this, assume we hit a cap rather than reached the end of the data. Must stay under
 * PostgREST's `db-max-rows` (1000) — see `assertNotTruncated`. Exported so the range tables
 * below can be unit-tested against it: a range whose bucket count reaches this throws at
 * runtime, and the point of Phase 9 was to stop discovering that in production. */
export const MAX_POINTS = 900;

/** How often to re-poll a long-range view. Far less frequent than the bridge's 60s
 * sample rate on purpose — a week/month-wide chart doesn't need per-minute freshness,
 * and re-querying Supabase that often would be pure waste. */
export const LONG_HISTORY_REFRESH_MS = 5 * 60 * 1000;

interface BucketRow {
  ts: string;
  power_w: number | null;
  voltage: number | null;
  current: number | null;
  sample_count?: number | null;
  online_count?: number | null;
}

/**
 * Throws if a result is exactly the size of a cap, because that is indistinguishable from
 * a truncated answer and PostgREST provides no other signal.
 *
 * Failing loudly is the entire point. The bug this guards against did not look like a bug:
 * a truncated array renders as a complete-looking chart, and stayed invisible for days
 * because nothing ever asked whether the data was all there. A thrown error surfaces as the
 * Analytics page's existing `'error'` status — visibly wrong beats quietly wrong.
 *
 * Pure — exported for its own tests.
 */
export function assertNotTruncated<T>(rows: T[], cap: number, context: string): T[] {
  if (rows.length >= cap) {
    throw new Error(
      `${context} returned ${rows.length} rows, at or above the ${cap}-row cap — the result ` +
        'is probably truncated, and a truncated history renders as a complete-looking chart. ' +
        'Widen the bucket size or narrow the range rather than trusting this answer.'
    );
  }
  return rows;
}

/** Pure — no I/O. Exported separately from `getLongHistory` so the drop-null-power
 * behavior is unit-testable without a live Supabase project. */
export function mapReadingsRows(rows: BucketRow[]): HistoryPoint[] {
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
 * (e.g. hide the long-range options) rather than surfacing a raw error to the UI.
 */
export async function getLongHistory(deviceId: string, range: LongRange): Promise<HistoryPoint[]> {
  if (!supabase) {
    throw new Error('Supabase is not configured (VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY unset)');
  }
  const sinceIso = new Date(Date.now() - RANGE_MS[range]).toISOString();
  const { data, error } = await supabase.rpc('readings_buckets', {
    p_device_id: deviceId,
    p_since: sinceIso,
    p_bucket_seconds: BUCKET_SECONDS[range],
  });
  if (error) throw new Error(`Supabase history fetch failed for ${deviceId}: ${error.message}`);
  const rows = (data ?? []) as BucketRow[];
  assertNotTruncated(rows, MAX_POINTS, `readings_buckets(${deviceId}, ${range})`);
  return mapReadingsRows(rows);
}

// --- The archive: history older than the raw retention window ---------------------------

/**
 * Ranges served by `readings_archive` (`supabase/phase10_history_archive.sql`) rather than
 * `readings_buckets`.
 *
 * WHY A SECOND PATH: `readings_buckets` reads `readings` only, and `server/retention.mjs`
 * prunes that table at 30 days. Phase 9 built `readings_hourly` to keep the history past
 * that point — but nothing read it, so anything older than the retention window was
 * unreachable from the app. These ranges cross that boundary; the RPC merges both tables and
 * deduplicates the seam, so a caller never has to know where the boundary currently sits.
 */
export const ARCHIVE_RANGES = ['90d', '1y'] as const;
export type ArchiveRange = (typeof ARCHIVE_RANGES)[number];

const ARCHIVE_RANGE_MS: Record<ArchiveRange, number> = {
  '90d': 90 * 24 * 60 * 60 * 1000,
  '1y': 365 * 24 * 60 * 60 * 1000,
};

/**
 * Bucket width per archive range. Every value must be a whole number of hours —
 * `readings_hourly` has no finer grain and the RPC raises rather than fabricating one — and
 * every range must yield fewer than `MAX_POINTS` buckets. Both are asserted in the tests,
 * because getting either wrong fails at runtime in production rather than at build time:
 * 90d/6h = 360 points, 1y/1d = 365 points.
 */
const ARCHIVE_BUCKET_SECONDS: Record<ArchiveRange, number> = {
  '90d': 6 * 60 * 60,
  '1y': 24 * 60 * 60,
};

/** How often to re-poll an archive view. A year-wide chart moves even more slowly than a
 * month-wide one, and every point but the last is already immutable history. */
export const ARCHIVE_REFRESH_MS = 30 * 60 * 1000;

/** Pure — the window and bucket size for a range, split out so the two invariants above are
 * testable without a live Supabase project. */
export function archiveWindow(
  range: ArchiveRange,
  nowMs: number = Date.now()
): { sinceIso: string; untilIso: string; bucketSeconds: number } {
  return {
    sinceIso: new Date(nowMs - ARCHIVE_RANGE_MS[range]).toISOString(),
    untilIso: new Date(nowMs).toISOString(),
    bucketSeconds: ARCHIVE_BUCKET_SECONDS[range],
  };
}

/**
 * Long-range history spanning the retention boundary. Same contract as `getLongHistory`:
 * throws if Supabase is unconfigured, throws rather than returning a possibly-truncated
 * answer, and drops null-power buckets as gaps instead of coercing them to zero.
 */
export async function getArchiveHistory(deviceId: string, range: ArchiveRange): Promise<HistoryPoint[]> {
  if (!supabase) {
    throw new Error('Supabase is not configured (VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY unset)');
  }
  const { sinceIso, untilIso, bucketSeconds } = archiveWindow(range);
  const { data, error } = await supabase.rpc('readings_archive', {
    p_device_id: deviceId,
    p_since: sinceIso,
    p_until: untilIso,
    p_bucket_seconds: bucketSeconds,
  });
  if (error) throw new Error(`Supabase archive fetch failed for ${deviceId}: ${error.message}`);
  const rows = (data ?? []) as BucketRow[];
  assertNotTruncated(rows, MAX_POINTS, `readings_archive(${deviceId}, ${range})`);
  return mapReadingsRows(rows);
}
