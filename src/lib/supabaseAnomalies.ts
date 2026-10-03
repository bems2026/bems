/**
 * Reads from Supabase's `anomalies` table — server-computed only, never written from the
 * browser (`supabase/phase8_anomalies.sql`'s RLS grants `authenticated` select, nothing
 * else). Same fetch-pattern precedent as `supabaseHistory.ts`'s `getLongHistory`: explicit
 * column list, a prefixed `Error` when Supabase isn't configured.
 */

import { supabase } from '@/config/supabase';
import { edgeRecentAnomalies } from './edgeArchive';

export interface AnomalyRow {
  device_id: string;
  ts: string;
  metric: string;
  value: number;
  baseline_mean: number;
  baseline_stddev: number;
  z_score: number;
  iqr_lower: number;
  iqr_upper: number;
  method: 'zscore' | 'iqr' | 'both';
  sample_count: number;
}

/** How far back to ask for anomaly rows. Wider than ANOMALY_RECENT_MS (src/lib/anomalies.ts)
 * on purpose — the popover only treats a row as "currently active" within that shorter
 * window, but fetching further back costs nothing and leaves room to widen that definition
 * later without a second round trip. */
const LOOKBACK_MS = 15 * 60 * 1000;

/**
 * The edge first, the cloud as the fallback — RM-158. Every open browser polled the cloud for this
 * once a minute, and each poll was a GET and a CORS OPTIONS in the project's log: about 2,880 lines a
 * day for the kiosk alone, when log ingestion was over the Free plan's 1 GB. The edge archives each
 * anomaly the minute it is found, before uploading it, so it holds the same rows, and sooner.
 *
 * Throws if the edge cannot answer and Supabase isn't configured — same contract as getLongHistory;
 * callers (anomaliesStore.ts) must catch and degrade rather than let this escape uncaught.
 */
export async function fetchRecentAnomalies(): Promise<AnomalyRow[]> {
  const sinceIso = new Date(Date.now() - LOOKBACK_MS).toISOString();
  const fromEdge = await edgeRecentAnomalies(sinceIso);
  if (fromEdge !== null) return fromEdge;
  if (!supabase) {
    throw new Error('Supabase is not configured (VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY unset)');
  }
  const { data, error } = await supabase
    .from('anomalies')
    .select('device_id,ts,metric,value,baseline_mean,baseline_stddev,z_score,iqr_lower,iqr_upper,method,sample_count')
    .gte('ts', sinceIso)
    .order('ts', { ascending: false });
  if (error) throw new Error(`Supabase anomalies fetch failed: ${error.message}`);
  return data ?? [];
}
