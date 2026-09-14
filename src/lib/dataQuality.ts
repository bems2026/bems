import { SITE } from '@shared/siteConfig.mjs';
import type { ConnStatus } from './bridgeClient';
import type { Slot, SlotQuality } from './timeseries';

/**
 * RM-076 — the words a chart uses to say what a point is and how current it is.
 *
 * Kept pure and out of the components so the sentences are pinned by tests in one place, and so
 * the tooltip and the badge stay thin. Two rules run through all of it: never let a bridged,
 * frozen or rejected value read as a measurement, and never let old data read as current.
 */

export type ChartQuantity = 'power' | 'voltage' | 'current';
export type QualityTone = 'neutral' | 'good' | 'warn' | 'bad' | 'accent';

const UNIT: Record<ChartQuantity, string> = { power: 'W', voltage: 'V', current: 'A' };

export const QUALITY_LABEL: Record<SlotQuality, string> = {
  measured: 'Measured',
  interpolated: 'Interpolated',
  live: 'Live',
  frozen: 'Frozen',
  offline: 'Offline',
  outlier: 'Rejected',
  missing: 'No data',
};

/** What the device carried, exactly — a tooltip is where full precision belongs. */
export function formatRawValue(value: number, quantity: ChartQuantity): string {
  return `${value} ${UNIT[quantity]}`;
}

export type SlotDescriptor = Pick<Slot, 'quality' | 'raw' | 'imputedFrom' | 'samples' | 'of' | 'coverage'>;

export function describeSlot(slot: SlotDescriptor, quantity: ChartQuantity): string {
  const raw = slot.raw !== undefined ? formatRawValue(slot.raw, quantity) : undefined;
  switch (slot.quality) {
    case 'interpolated':
      if (slot.imputedFrom === 'offline') return raw ? `Interpolated across a brief offline flicker (the device carried ${raw})` : 'Interpolated across a brief offline flicker';
      if (slot.imputedFrom === 'outlier') return raw ? `Interpolated over a rejected reading of ${raw}` : 'Interpolated over a rejected reading';
      if (slot.imputedFrom === 'missing') return 'Interpolated across a missed sample';
      return slot.samples !== undefined && slot.of !== undefined ? `Mostly interpolated: an average of ${slot.samples} of ${slot.of} samples` : 'Interpolated';
    case 'outlier':
      return raw ? `Rejected: ${raw} is outside what this site can measure` : 'Rejected: not a readable number';
    case 'frozen':
      return raw
        ? `Frozen: the meter repeated ${raw} unchanged, so this is not a measurement`
        : 'Frozen: the meter repeated the same reading unchanged, so this is not a measurement';
    case 'offline':
      return raw ? `Offline: the bridge reported this device unreachable (its last value, ${raw}, is not plotted)` : 'Offline: the bridge reported this device unreachable';
    case 'missing':
      return 'No data recorded for this time';
    case 'live':
      return 'Live reading';
    case 'measured':
      if (slot.coverage) return `Stored average of ${slot.coverage.online} of ${slot.coverage.samples} samples online`;
      if (slot.samples !== undefined && slot.of !== undefined && slot.of > 1) return `Average of ${slot.samples} of ${slot.of} samples`;
      return 'Measured';
  }
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

function siteClockSeconds(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: SITE.timezone as string });
}

/** Where a point on the chart came from, for the tooltip. */
export function sourceLabel(sync: SyncStatus, quality: SlotQuality, nowMs: number): string {
  if (quality === 'live') return 'Live feed';
  const name = sync.source === 'stored' ? 'Stored history' : 'Bridge buffer';
  if (sync.fetchedAt === null) return name;
  const at = siteClockSeconds(sync.fetchedAt);
  return isStale(sync, nowMs) ? `Cached · as of ${at}` : `${name} · fetched ${at}`;
}
