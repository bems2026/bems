import { siteDate, siteTimeShort } from './siteTime';
import type { ConnStatus } from './bridgeClient';
import type { Slot, SlotQuality } from './timeseries';

/**
 * RM-076 — the words a chart uses about a point, and about how current its data is.
 *
 * KEPT TO A WORD OR TWO, at the operator's request on the live page (2026-09-15). The first version
 * explained every point in a sentence — "Average of 11 of 11 samples", "Reading at 22:50:02",
 * "Bridge buffer · fetched 08:32:01" — on every line of every tooltip, which buried the one number a
 * reader came for. Now a plain reading gets no words at all, anything else gets one tag, and the badge
 * above the chart uses the same words. Pure, so the words are pinned by tests in one place.
 */

export type QualityTone = 'neutral' | 'good' | 'warn' | 'bad' | 'accent';

const TAG: Record<SlotQuality, string | null> = {
  measured: null,
  interpolated: 'Estimated',
  live: 'Live',
  frozen: 'Frozen',
  offline: 'Offline',
  outlier: 'Bad reading',
  missing: 'No data',
};

/** A word or two for a point that is not a plain reading; `null` for one that is. */
export function qualityTag(slot: Pick<Slot, 'quality' | 'samples' | 'of'>): string | null {
  return TAG[slot.quality];
}

const DAY_MS = 86_400_000;

/**
 * The moment a tooltip is about: `Sep 14 · 22:40` for a one-minute point, `Sep 14 · 22:40–22:51` for
 * one that stands for longer, and just the day or days for a point a day or more wide.
 */
export function tooltipTime(t: number, stepMs: number): string {
  const day = (ms: number) => siteDate(ms, { month: 'short', day: 'numeric' });
  if (stepMs >= DAY_MS) return stepMs === DAY_MS ? day(t) : `${day(t)}–${day(t + stepMs - DAY_MS)}`;
  const from = siteTimeShort(t);
  return stepMs > 60_000 ? `${day(t)} · ${from}–${siteTimeShort(t + stepMs)}` : `${day(t)} · ${from}`;
}

export function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export interface SyncStatus {
  /** An answer — success or failure — has come back for the range on screen. */
  settled: boolean;
  /** When this range last arrived successfully, for any of its devices. */
  fetchedAt: number | null;
  /** Consecutive failed fetches since then. */
  failures: number;
  lastError: string | null;
  refetchMs: number;
  source: 'bridge' | 'stored';
}

export interface SyncSummary {
  tone: QualityTone;
  text: string;
  detail: string;
}

const isStale = (sync: SyncStatus, nowMs: number) => sync.fetchedAt !== null && (sync.failures > 0 || nowMs - sync.fetchedAt > 2 * sync.refetchMs);

/** The one badge that says whether what is on screen is current. */
export function syncSummary(sync: SyncStatus, wsStatus: ConnStatus, nowMs: number): SyncSummary {
  if (sync.fetchedAt === null) {
    if (!sync.settled) return { tone: 'accent', text: 'Syncing…', detail: 'Fetching history for this range.' };
    return { tone: 'bad', text: 'History unavailable', detail: `No history has arrived for this range${sync.lastError ? ` (${sync.lastError})` : ''}. Retrying.` };
  }
  const age = nowMs - sync.fetchedAt;
  if (isStale(sync, nowMs)) {
    return {
      tone: 'warn',
      text: `Cached · ${formatAge(age)} old`,
      detail: `Showing history fetched ${formatAge(age)} ago${sync.lastError ? `; the latest attempt failed: ${sync.lastError}` : ''}. Retrying.`,
    };
  }
  if (sync.source === 'stored') return { tone: 'good', text: 'Up to date', detail: `Stored history, fetched ${formatAge(age)} ago.` };
  if (wsStatus === 'reconnecting' || wsStatus === 'offline') {
    return { tone: 'warn', text: 'Live feed reconnecting', detail: 'History is current, but the live feed is down, so the newest readings are not being added to the end of the chart.' };
  }
  return { tone: 'good', text: 'Live', detail: `History fetched ${formatAge(age)} ago; the newest point comes from the live feed.` };
}

/** One line for a tooltip, only once the data behind it has stopped arriving. */
export function staleNote(sync: SyncStatus, nowMs: number): string | null {
  return sync.fetchedAt !== null && isStale(sync, nowMs) ? `Cached · ${formatAge(nowMs - sync.fetchedAt)} old` : null;
}
