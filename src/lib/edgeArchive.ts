import { fetchJson } from './bridgeClient';
import type { ExportReading, RawSource } from './readingsExport';
import type { AnomalyRow } from './supabaseAnomalies';

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
