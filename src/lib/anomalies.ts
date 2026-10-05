import type { AnomalyRow } from './supabaseAnomalies';

/** A device only counts as "currently anomalous" while its most recent flagged tick is
 * within this many ms of now — three ingest poll cycles at the default 60s cadence. Kept
 * short so a resolved anomaly clears from the bell on its own once ingest.mjs stops
 * flagging it, without needing a server-side "resolved" column or a second write path. */
export const ANOMALY_RECENT_MS = 3 * 60 * 1000;

/** Collapses possibly-many rows per device (since RM-160 ingest.mjs writes one `anomalies` row
 * per unusual run, but several devices, or several runs inside the lookback, can each have one —
 * see server/anomalyStats.mjs's header) down to each device's single most recent row. Uses
 * Date.parse, not a string compare, so it doesn't assume every row's `ts` shares the same
 * timezone-offset formatting. */
export function latestAnomalyPerDevice(rows: AnomalyRow[]): Record<string, AnomalyRow> {
  const out: Record<string, AnomalyRow> = {};
  for (const row of rows) {
    const existing = out[row.device_id];
    if (!existing || Date.parse(row.ts) > Date.parse(existing.ts)) out[row.device_id] = row;
  }
  return out;
}

export function isAnomalyCurrent(row: AnomalyRow, nowMs: number = Date.now()): boolean {
  return nowMs - Date.parse(row.ts) < ANOMALY_RECENT_MS;
}

/**
 * RM-160: the first building date on which the `anomalies` table holds one row per unusual run, at a
 * level the device had not held that week. Before it, every switch of a cycling load was a row or two —
 * about 220 a day, against about 4 after — so a report's count for a period that began earlier means
 * something else, and says so. The rows themselves were left as they were recorded.
 */
export const UNUSUAL_EVENTS_FROM = '2026-10-06';

/** The caveat a report's "Unusual events" figure carries, or null when its period began on or after the change. */
export function unusualEventsCaveat(periodStart: string): string | null {
  if (periodStart.slice(0, 10) >= UNUSUAL_EVENTS_FROM) return null;
  // The reader's locale spells the date (test/site-naming.test.mjs), so it goes last, where any spelling reads.
  const from = new Date(`${UNUSUAL_EVENTS_FROM}T00:00:00Z`).toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
  return `every switch of a cycling load was counted before ${from}`;
}
