/**
 * Per-space totals — RM-030. Reads `node_totals`, the RPC added in
 * `supabase/phase22_node_totals.sql`.
 *
 * "How much did the lab use?" was unanswerable until RM-028 gave rooms structure. This is the
 * client half of making them add up.
 *
 * THE HONESTY RULE TRAVELS WITH THE DATA. The RPC returns NULL power for a scope it did not
 * observe — a room with no devices, or one whose devices were all offline for the window — and
 * nothing here may turn that into 0. A meter that stops reporting keeps its last value in
 * `readings`, so a 0 would be a reading nobody took, which is the failure shape RM-024 and
 * EX-107 exist to prevent. `coverageOf` is what lets a caller say so rather than guess.
 */
import { supabase } from '@/config/supabase';

export interface NodeTotals {
  /** Devices placed anywhere in this subtree, metered or not. */
  deviceCount: number;
  /** Of those, the ones that produced any reading in the window. */
  reportingCount: number;
  sampleCount: number;
  onlineSampleCount: number;
  /** NULL when nothing was observed. NEVER 0 — see the module header. */
  avgPowerW: number | null;
  peakPowerW: number | null;
}

interface NodeTotalsRow {
  device_count: number | string;
  reporting_count: number | string;
  sample_count: number | string;
  online_sample_count: number | string;
  avg_power_w: number | string | null;
  peak_power_w: number | string | null;
}

/** `count(*)` is `bigint`, and supabase-js hands a bigint back as a STRING. Arithmetic on that
 * concatenates instead of adding, silently, so every numeric field is coerced on the way in. */
const num = (v: number | string) => Number(v);
const maybeNum = (v: number | string | null) => (v === null ? null : Number(v));

export function rowToNodeTotals(row: NodeTotalsRow): NodeTotals {
  return {
    deviceCount: num(row.device_count),
    reportingCount: num(row.reporting_count),
    sampleCount: num(row.sample_count),
    onlineSampleCount: num(row.online_sample_count),
    avgPowerW: maybeNum(row.avg_power_w),
    peakPowerW: maybeNum(row.peak_power_w),
  };
}

/**
 * What fraction of the samples considered were actually observed, or null when none were
 * considered at all.
 *
 * THE NULL CASE IS NOT ZERO AND NOT ONE. "We looked and saw nothing reporting" (0) and "there
 * was nothing to look at" (null) are different facts, and a caller that renders them the same
 * tells the operator a room is dark when the truth is that no reading exists for that window.
 * Same distinction the Reports page draws for a sparse month (EX-033).
 */
export function coverageOf(t: Pick<NodeTotals, 'sampleCount' | 'onlineSampleCount'>): number | null {
  if (t.sampleCount === 0) return null;
  return t.onlineSampleCount / t.sampleCount;
}

function requireSupabase() {
  if (supabase === null) throw new Error('Supabase is not configured — per-space totals need it.');
  return supabase;
}

/**
 * Totals for a space and everything beneath it, over a half-open window: `since` inclusive,
 * `until` exclusive. The RPC walks the subtree itself, so passing a floor includes its rooms.
 */
export async function fetchNodeTotals(nodeId: string, since: Date, until: Date = new Date()): Promise<NodeTotals> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('node_totals', {
    p_node_id: nodeId,
    p_since: since.toISOString(),
    p_until: until.toISOString(),
  });
  if (error) throw new Error(`Supabase node_totals failed: ${error.message}`);
  // The function returns exactly one row. An empty array would mean the node does not exist —
  // reported as such rather than defaulted to zeroes, which would invent a reading.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error(`node_totals returned no row for ${nodeId} — the space may have been deleted.`);
  return rowToNodeTotals(row as NodeTotalsRow);
}
