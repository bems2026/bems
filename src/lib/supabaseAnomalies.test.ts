import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * RM-158 — the alert bell's recent anomalies come from the edge first. Every open browser asked the
 * cloud once a minute, and each ask was a GET plus a CORS OPTIONS in the project's log: about 2,880
 * lines a day for the kiosk alone, when log ingestion was over the Free plan's 1 GB. The edge
 * archives each anomaly the minute it is found, so it holds the same rows. The cloud stays the
 * fallback, so a page served without the edge still has a bell.
 */

const cloud = vi.hoisted(() => {
  const calls: string[] = [];
  const result = { data: [] as unknown[], error: null as { message: string } | null };
  const builder = {
    select: (cols: string) => { calls.push(`select ${cols}`); return builder; },
    gte: (col: string, v: string) => { calls.push(`gte ${col} ${v}`); return builder; },
    order: () => Promise.resolve(result),
  };
  return { calls, result, client: { from: (table: string) => { calls.push(`from ${table}`); return builder; } } };
});

vi.mock('@/config/supabase', () => ({ supabase: cloud.client }));
vi.mock('./bridgeClient', () => ({ fetchJson: vi.fn() }));

import { fetchJson } from './bridgeClient';
import { fetchRecentAnomalies } from './supabaseAnomalies';

const row = (device_id: string) => ({
  device_id, ts: '2026-10-03T10:00:00.000Z', metric: 'power_w', value: 120, baseline_mean: 40, baseline_stddev: 10,
  z_score: 8, iqr_lower: 20, iqr_upper: 60, method: 'both' as const, sample_count: 60,
});

describe('fetchRecentAnomalies', () => {
  beforeEach(() => {
    vi.mocked(fetchJson).mockReset();
    cloud.calls.length = 0;
    cloud.result.data = [];
    cloud.result.error = null;
  });

  it('asks the edge for the last fifteen minutes, and does not ask the cloud when it answers', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ rows: [row('l1')] });
    expect(await fetchRecentAnomalies()).toEqual([row('l1')]);
    const [path] = vi.mocked(fetchJson).mock.calls[0];
    expect(path).toMatch(/^\/archive\/anomalies\?since=\d{4}-\d{2}-\d{2}T/);
    const sinceMs = Date.parse(decodeURIComponent(String(path).split('since=')[1]));
    expect(Date.now() - sinceMs).toBeGreaterThanOrEqual(15 * 60_000 - 1000);
    expect(Date.now() - sinceMs).toBeLessThan(15 * 60_000 + 5000);
    expect(cloud.calls).toEqual([]);
  });

  it('an edge with nothing recent is an answer too: an empty bell, not a cloud request', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ rows: [] });
    expect(await fetchRecentAnomalies()).toEqual([]);
    expect(cloud.calls).toEqual([]);
  });

  it('falls back to the cloud when the edge cannot answer — an older proxy, no archive, a development page', async () => {
    vi.mocked(fetchJson).mockRejectedValue(new Error('HTTP 404'));
    cloud.result.data = [row('co2')];
    expect(await fetchRecentAnomalies()).toEqual([row('co2')]);
    expect(cloud.calls[0]).toBe('from anomalies');
  });

  it('an answer without rows is not trusted as "nothing happened"', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ error: 'archive_unavailable' });
    cloud.result.data = [row('co3')];
    expect(await fetchRecentAnomalies()).toEqual([row('co3')]);
  });
});
