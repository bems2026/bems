/**
 * Copying what the cloud already holds into the Pi's archive — RM-148, Stage 2.
 *
 * The archive only starts filling when the new ingest is deployed, but the cloud holds 30 days of
 * raw rows that exist nowhere else, and Stage 4 prunes it to 14. So before anything is pruned,
 * those rows are copied down, once. They go in as `cloud` rows: kept for good, never sent back.
 *
 * WINDOWED, AND A FULL PAGE IS NEVER TRUSTED. PostgREST caps every answer at `db-max-rows` (1000
 * here) and says nothing when it does (`docs/storage-contract.md`). So each device is asked for
 * one window at a time, and a window that comes back exactly full is split in half and asked
 * again, down to a minute. Every window is checked after it is written: the archive must hold at
 * least as many rows for it as the cloud returned.
 *
 * Pure apart from what it is handed — `fetchWindow` is the cloud, `archive` is the archive — so
 * the tests can stand a fake cloud in front of it. `server/archive-backfill.mjs` is the CLI.
 */

import { STREAMS, ORIGIN } from './archiveDb.mjs';

/** PostgREST's `db-max-rows` on this project. */
export const PAGE_LIMIT = 1000;
/** 12 hours: 720 rows for one device at one a minute, comfortably under a page. */
export const WINDOW_MS = 12 * 60 * 60 * 1000;
const MIN_WINDOW_MS = 60_000;

/** Half-open `[start, end)` windows covering `[sinceMs, untilMs)`. */
export function windowsBetween(sinceMs, untilMs, windowMs) {
  const out = [];
  for (let s = sinceMs; s < untilMs; s += windowMs) out.push([s, Math.min(s + windowMs, untilMs)]);
  return out;
}

/** The PostgREST query for one window of one stream (and one device, where the stream has them). */
export function windowQuery(stream, { deviceId, sinceIso, untilIso, limit }) {
  const columns = Object.keys(STREAMS[stream].columns);
  const parts = [`select=${columns.join(',')}`];
  if (deviceId !== undefined && columns.includes('device_id')) parts.push(`device_id=eq.${encodeURIComponent(deviceId)}`);
  parts.push(`ts=gte.${encodeURIComponent(sinceIso)}`, `ts=lt.${encodeURIComponent(untilIso)}`);
  parts.push('order=ts.asc', `limit=${limit}`);
  return parts.join('&');
}

/**
 * @param {{
 *   archive: ReturnType<import('./archiveDb.mjs').openArchive>,
 *   fetchWindow: (stream: string, w: { deviceId?: string, sinceIso: string, untilIso: string, limit: number }) => Promise<object[]>,
 *   stream: string, deviceIds?: string[], sinceMs: number, untilMs: number,
 *   windowMs?: number, limit?: number, onWindow?: (w: object) => void,
 * }} args
 */
export async function backfillStream({ archive, fetchWindow, stream, deviceIds, sinceMs, untilMs, windowMs = WINDOW_MS, limit = PAGE_LIMIT, onWindow }) {
  const scopes = deviceIds && 'device_id' in STREAMS[stream].columns ? deviceIds : [undefined];
  const totals = { fetched: 0, inserted: 0, windows: 0 };

  async function copy(deviceId, s, e) {
    const rows = await fetchWindow(stream, { deviceId, sinceIso: new Date(s).toISOString(), untilIso: new Date(e).toISOString(), limit });
    if (rows.length >= limit) {
      if (e - s <= MIN_WINDOW_MS) {
        throw new Error(`${stream}${deviceId ? ` ${deviceId}` : ''}: ${rows.length} rows in ${new Date(s).toISOString()}–${new Date(e).toISOString()}, and cannot split the window further`);
      }
      const mid = s + Math.floor((e - s) / 2 / MIN_WINDOW_MS) * MIN_WINDOW_MS || s + Math.floor((e - s) / 2);
      await copy(deviceId, s, mid);
      await copy(deviceId, mid, e);
      return;
    }
    const inserted = rows.length ? archive.insertRows(stream, rows, { origin: ORIGIN.cloud }) : 0;
    const held = archive.countRange(stream, { sinceMs: s, untilMs: e, deviceId });
    if (held < rows.length) {
      throw new Error(`${stream}${deviceId ? ` ${deviceId}` : ''}: the archive holds ${held} rows for a window the cloud returned ${rows.length} for`);
    }
    totals.fetched += rows.length;
    totals.inserted += inserted;
    onWindow?.({ stream, deviceId, sinceMs: s, untilMs: e, fetched: rows.length, inserted });
  }

  for (const deviceId of scopes) {
    for (const [s, e] of windowsBetween(sinceMs, untilMs, windowMs)) {
      totals.windows += 1;
      await copy(deviceId, s, e);
    }
  }
  return totals;
}

/**
 * Rows from an NDJSON export (`npm run backup`, or the pre-retention export of 2026-09-15). They
 * go in as `import` rows: older than the cloud's window, so never sent to it.
 */
export function importNdjson({ archive, stream, lines, chunk = 5000 }) {
  const rows = [];
  for (const line of lines) {
    const text = String(line).trim();
    if (text) rows.push(JSON.parse(text));
  }
  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    inserted += archive.insertRows(stream, rows.slice(i, i + chunk), { origin: ORIGIN.import });
  }
  return { read: rows.length, inserted };
}
