import { fetchJson } from './bridgeClient';
import type { ExportReading, RawSource } from './readingsExport';
import type { AnomalyRow } from './supabaseAnomalies';
import type { ConnectivityRow } from './deviceConnectivity';

/**
 * RM-159: every read a screen repeats on a timer comes from the edge, and the cloud only when the edge
 * cannot answer. Each browser read of Supabase is a GET and a CORS OPTIONS in the project's log, and the
 * kiosk never closes — the reads below cost about 2,300 lines a day for that one screen.
 *
 * Each returns `null` when the edge cannot answer (an older proxy, no archive, a page not served from
 * the edge, a timeout), so the caller asks the cloud instead. An empty list IS an answer.
 */
async function edgeOrNull<T>(path: string, pick: (body: unknown) => T | null, timeoutMs?: number): Promise<T | null> {
  try {
    return pick(await fetchJson<unknown>(path, timeoutMs ? { timeoutMs } : {}));
  } catch {
    return null;
  }
}

/** The abnormal minutes `fetchTroubleEpisodes` reads, per column, from `GET /api/archive/trouble`. */
export interface EdgeTroubleRows {
  fault: Array<Record<string, unknown>>;
  power_type: Array<Record<string, unknown>>;
  net_state: Array<Record<string, unknown>>;
}

export function edgeTroubleRows(sinceIso: string): Promise<EdgeTroubleRows | null> {
  return edgeOrNull(`/archive/trouble?since=${encodeURIComponent(sinceIso)}`, (body) => {
    const b = body as Partial<EdgeTroubleRows> | null;
    return b && Array.isArray(b.fault) && Array.isArray(b.power_type) && Array.isArray(b.net_state)
      ? { fault: b.fault, power_type: b.power_type, net_state: b.net_state }
      : null;
  });
}

/** `device_connectivity`'s rows over the last `hours`, from `GET /api/archive/connectivity`. */
export function edgeConnectivity(hours: number): Promise<ConnectivityRow[] | null> {
  return edgeOrNull(`/archive/connectivity?hours=${hours}`, (body) => {
    const rows = (body as { rows?: unknown } | null)?.rows;
    return Array.isArray(rows) ? (rows as ConnectivityRow[]) : null;
  });
}

/** One bucket of `readings_buckets`, as `GET /api/archive/buckets` returns it. */
export interface EdgeBucketRow {
  ts: string;
  power_w: number | null;
  voltage: number | null;
  current: number | null;
  sample_count: number;
  online_count: number;
}

export function edgeBuckets(deviceId: string, sinceIso: string, bucketSeconds: number): Promise<EdgeBucketRow[] | null> {
  const q = `device_id=${encodeURIComponent(deviceId)}&since=${encodeURIComponent(sinceIso)}&bucket_s=${bucketSeconds}`;
  return edgeOrNull(`/archive/buckets?${q}`, (body) => {
    const rows = (body as { rows?: unknown } | null)?.rows;
    return Array.isArray(rows) ? (rows as EdgeBucketRow[]) : null;
  }, 30_000);
}

/**
 * The anomalies since an instant, newest first, from the edge — RM-158. `null` when the edge cannot
 * answer (an older proxy, no archive, a page not served from the edge), so the caller can ask the
 * cloud instead. An empty list IS an answer: nothing recent happened.
 */
export async function edgeRecentAnomalies(sinceIso: string): Promise<AnomalyRow[] | null> {
  try {
    const body = await fetchJson<{ rows?: AnomalyRow[] }>(`/archive/anomalies?since=${encodeURIComponent(sinceIso)}`);
    return Array.isArray(body?.rows) ? body.rows : null;
  } catch {
    return null;
  }
}

/**
 * Minute readings from the edge's permanent archive — RM-148.
 *
 * The cloud keeps 14 days of minute readings (`shared/retention.mjs`); the edge keeps every one, and
 * `server/proxy.mjs` serves them behind the same login as the rest of the API. The page is served
 * from the edge, so the proxy is always the same host that answers `/api`.
 *
 * Anything short of rows — no archive yet, a proxy from before RM-148, a page served from a
 * development machine, a timeout — is `null`, and the export falls back to the cloud, which still
 * holds every hour as an hourly average. An export never fails because the edge could not help.
 */
export const edgeRawSource: RawSource = async (deviceId, win) => {
  const q = `device_id=${encodeURIComponent(deviceId)}&since=${encodeURIComponent(win.startIso)}&until=${encodeURIComponent(win.endIso)}`;
  try {
    const body = await fetchJson<{ device_id?: string; rows?: ExportReading[] }>(`/archive/readings?${q}`, { timeoutMs: 60_000 });
    return Array.isArray(body?.rows) ? body.rows : null;
  } catch {
    return null;
  }
};
