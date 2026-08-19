import type { AnomalyRow } from './supabaseAnomalies';

/** A device only counts as "currently anomalous" while its most recent flagged tick is
 * within this many ms of now — three ingest poll cycles at the default 60s cadence. Kept
 * short so a resolved anomaly clears from the bell on its own once ingest.mjs stops
 * flagging it, without needing a server-side "resolved" column or a second write path. */
export const ANOMALY_RECENT_MS = 3 * 60 * 1000;

/** Collapses possibly-many rows per device (ingest.mjs writes one `anomalies` row per
 * flagged tick, and a persistent condition can flag for several ticks in a row — see
 * server/anomalyStats.mjs's header) down to each device's single most recent row. Uses
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
