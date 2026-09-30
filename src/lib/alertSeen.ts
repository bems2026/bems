/**
 * What this browser has marked as seen in the alerts bell — RM-152.
 *
 * "Ack" used to be a `useState` Set: a reload, or the kiosk's reload for a new build, forgot every
 * one. The operator chose per-browser memory over a shared table (2026-09-30), so it lives in
 * `localStorage`. Every read and write is guarded: a private window, blocked storage or a full quota
 * makes the bell forget, never break.
 *
 * WHAT IS REMEMBERED IS A STAMP, NOT JUST AN ID. A device's power warning marked as seen stays seen
 * only for that episode (its start); a new episode is new news and comes back. A live-state alert (a
 * device not reporting, the fleet dropping) has no episode, so its mark expires instead, after
 * `LIVE_SEEN_MS`: a problem that lasts comes back twice a day rather than never.
 */

const KEY = 'ibems.alerts.seen.v1';
/** Marks older than the week the bell shows, plus a day, are dropped when read. */
export const SEEN_KEEP_MS = 8 * 24 * 60 * 60 * 1000;
/** How long "seen" holds for an alert with no episode of its own. */
export const LIVE_SEEN_MS = 12 * 60 * 60 * 1000;

export type SeenMap = Record<string, { stamp: string; at: number }>;

export function readSeen(nowMs = Date.now()): SeenMap {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: SeenMap = {};
    for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
      const entry = v as { stamp?: unknown; at?: unknown };
      if (typeof entry?.stamp === 'string' && typeof entry?.at === 'number' && nowMs - entry.at < SEEN_KEEP_MS) {
        out[id] = { stamp: entry.stamp, at: entry.at };
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function writeSeen(map: SeenMap): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // Storage refused: the mark lasts this page's life, which is what Ack always did.
  }
}

/** Whether `id` is marked seen for this `stamp`, and, when `ttlMs` is given, recently enough. */
export function isSeen(map: SeenMap, id: string, stamp: string, nowMs: number, ttlMs?: number): boolean {
  const entry = map[id];
  if (!entry || entry.stamp !== stamp) return false;
  return ttlMs === undefined || nowMs - entry.at < ttlMs;
}
