/**
 * Whether the edge reaches the cloud, as the page can see it — RM-165, 2026-10-28.
 *
 * WHY. The page's live pill measures only the proxy, which answers with or without the internet. From 7 to 14
 * October and again from 15 to 28 October the site network had no internet: the edge archived every minute and
 * nobody looking at the page could tell that 566,000 rows were waiting, or why every meter held one reading.
 * Ingest is the only process that knows, so it writes what it knows here once a tick, and the proxy serves it
 * with the archive's status (`/api/archive/status`).
 *
 * ONE WRITER. Ingest writes; the proxy only reads. A file older than `STALE_AFTER_MS` is reported as
 * `unknown`, not as the state it last held: ingest stopped is not the same as ingest online.
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs';

/** Three missed ticks. */
export const STALE_AFTER_MS = 3 * 60_000;

/**
 * @param {string} file
 * @param {{ at: string, cloudReachable: boolean, paused?: boolean, waiting: number,
 *   lastUploadOkAt: string|null, lastUploadFailAt: string|null, frozen: Array<{ deviceId: string, frozenSince: string }> }} status
 */
export function writeEdgeStatus(file, status) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(status));
  renameSync(tmp, file);
}

/**
 * What the page is told. `state` is `online`, `offline` (the last upload attempt failed), `paused` (the operator
 * paused uploads) or `unknown` (no file, an unreadable one, or one older than `STALE_AFTER_MS`).
 */
export function readEdgeStatus(file, nowMs = Date.now(), staleAfterMs = STALE_AFTER_MS) {
  let s;
  try {
    s = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { state: 'unknown' };
  }
  const atMs = Date.parse(s?.at ?? '');
  if (!Number.isFinite(atMs) || nowMs - atMs > staleAfterMs) return { state: 'unknown' };
  return {
    state: s.paused ? 'paused' : s.cloudReachable ? 'online' : 'offline',
    at: s.at,
    waiting: Number.isFinite(s.waiting) ? s.waiting : null,
    last_upload_ok_at: s.lastUploadOkAt ?? null,
    last_upload_fail_at: s.lastUploadFailAt ?? null,
    frozen: Array.isArray(s.frozen) ? s.frozen.map((f) => ({ device_id: f.deviceId, frozen_since: f.frozenSince })) : [],
  };
}

/**
 * RM-165, measured on the day it shipped: after a restart the upload batch starts large and times out on a slow
 * link while the minutes before had gone through. An upload that went through within this long means the site has
 * internet, whatever one batch did.
 */
export const RECENT_OK_MS = 15 * 60_000;

/** @param {{ reachable: boolean|null, okAt: string|null }} seen */
export function cloudReachable(seen, nowMs = Date.now()) {
  if (seen.reachable === true) return true;
  const okMs = Date.parse(seen.okAt ?? '');
  return Number.isFinite(okMs) && nowMs - okMs <= RECENT_OK_MS;
}

/** What the last run of ingest had learned, so a restart does not forget the last good upload. */
export function previousSeen(file) {
  try {
    const s = JSON.parse(readFileSync(file, 'utf8'));
    return { reachable: null, okAt: s.lastUploadOkAt ?? null, failAt: s.lastUploadFailAt ?? null };
  } catch {
    return { reachable: null, okAt: null, failAt: null };
  }
}
