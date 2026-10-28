/**
 * Whether the edge reaches the cloud, said to a person — RM-165, 2026-10-28.
 *
 * The live pill measures the proxy, which answers with or without the internet. From 15 to 28 October the site
 * network had no internet: the edge archived every minute, 566,000 rows waited, and every circuit meter held one
 * reading until the internet returned (E-260). Nothing on the page said so. `GET /api/edge/status`
 * (`server/edgeStatus.mjs`) is ingest's own view; this turns it into the bell's notice and the top bar's chip.
 */

export type EdgeLinkState = 'online' | 'offline' | 'paused' | 'unknown';

export interface EdgeStatus {
  state: EdgeLinkState;
  waiting: number | null;
  lastUploadOkAt: string | null;
  lastUploadFailAt: string | null;
  frozen: Array<{ deviceId: string; frozenSince: string }>;
}

/** Below this many rows waiting the edge is simply between two regular uploads (about 100 rows every five minutes). */
export const CATCHING_UP_ABOVE = 1000;

export function parseEdgeStatus(body: unknown): EdgeStatus | null {
  const b = body as Record<string, unknown> | null;
  const state = b?.state;
  if (state !== 'online' && state !== 'offline' && state !== 'paused' && state !== 'unknown') return null;
  const frozen = Array.isArray(b?.frozen) ? (b.frozen as Array<Record<string, unknown>>) : [];
  return {
    state,
    waiting: typeof b?.waiting === 'number' && Number.isFinite(b.waiting) ? b.waiting : null,
    lastUploadOkAt: typeof b?.last_upload_ok_at === 'string' ? b.last_upload_ok_at : null,
    lastUploadFailAt: typeof b?.last_upload_fail_at === 'string' ? b.last_upload_fail_at : null,
    frozen: frozen
      .filter((f) => typeof f.device_id === 'string' && typeof f.frozen_since === 'string')
      .map((f) => ({ deviceId: f.device_id as string, frozenSince: f.frozen_since as string })),
  };
}

export interface LinkNotice {
  kind: 'offline' | 'catching-up' | 'paused';
  severity: 'warning' | 'notice';
  /** What the top bar's chip reads. */
  chip: string;
  title: string;
  body: string;
  /** Stable for one outage, so "dismiss" holds until the next one. */
  stamp: string;
}

const count = (n: number) => n.toLocaleString(undefined);

/** The notice for this status, or null when there is nothing to say (online and caught up, or unknown). */
export function linkNotice(s: EdgeStatus | null): LinkNotice | null {
  if (!s) return null;
  const waiting = s.waiting ?? 0;
  const stamp = s.lastUploadOkAt ?? 'never';
  if (s.state === 'offline') {
    return {
      kind: 'offline',
      severity: 'warning',
      chip: 'Offline logging',
      title: 'No internet at the site',
      body:
        `The Pi is logging every minute on its own${waiting > 0 ? `; ${count(waiting)} readings wait to upload` : ''}. ` +
        'Live readings and control keep working on the local network. ' +
        'The circuit meters hold their last reading until the internet returns; their energy registers keep counting, so the held energy is recovered afterwards as an estimate.',
      stamp,
    };
  }
  if (s.state === 'paused') {
    return {
      kind: 'paused',
      severity: 'notice',
      chip: 'Upload paused',
      title: 'Cloud upload paused on the Pi',
      body: `Logging continues on the Pi${waiting > 0 ? `; ${count(waiting)} readings wait to upload` : ''}. Reports read from the cloud stop at the pause until it is lifted.`,
      stamp: `paused:${stamp}`,
    };
  }
  if (s.state === 'online' && waiting > CATCHING_UP_ABOVE) {
    return {
      kind: 'catching-up',
      severity: 'notice',
      chip: `Syncing ${count(waiting)}`,
      title: 'Back online, catching up',
      body: `The Pi is uploading what it logged while the internet was down: ${count(waiting)} readings to go. Reports fill in as it does.`,
      stamp: `catching-up:${s.lastUploadFailAt ?? stamp}`,
    };
  }
  return null;
}
