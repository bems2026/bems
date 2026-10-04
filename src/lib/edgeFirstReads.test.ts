import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * RM-159 — what a screen reads on a timer comes from the edge, and from the cloud only when the edge
 * cannot answer. Each browser read of Supabase is a request and a CORS OPTIONS in the project's log,
 * and the kiosk never closes: the connectivity RPC and the three trouble queries cost about 2,300
 * lines a day for that one screen, and the Analytics week left open about 6,300 more.
 */

const cloud = vi.hoisted(() => {
  const calls: string[] = [];
  const chain = (): Record<string, unknown> => {
    const self: Record<string, unknown> = {};
    for (const m of ['select', 'gte', 'neq', 'eq', 'in', 'order']) self[m] = () => self;
    self.range = () => Promise.resolve({ data: [], error: null });
    return self;
  };
  return {
    calls,
    client: {
      from: (table: string) => { calls.push(`from ${table}`); return chain(); },
      rpc: (fn: string) => { calls.push(`rpc ${fn}`); return Promise.resolve({ data: [], error: null }); },
    },
  };
});

vi.mock('@/config/supabase', () => ({ supabase: cloud.client }));
vi.mock('./bridgeClient', () => ({ fetchJson: vi.fn() }));

import { fetchJson } from './bridgeClient';
import { fetchTroubleEpisodes } from './supabaseCapabilityHistory';
import { fetchDeviceConnectivity } from './deviceConnectivity';
import { getLongHistory } from './supabaseHistory';

beforeEach(() => {
  vi.mocked(fetchJson).mockReset();
  cloud.calls.length = 0;
});

describe('trouble episodes', () => {
  it('come from the edge when it answers, with no cloud request', async () => {
    const ts = new Date(Date.now() - 60 * 60_000).toISOString();
    vi.mocked(fetchJson).mockResolvedValue({ fault: [{ device_id: 'co2', ts, fault: 4 }], power_type: [], net_state: [] });
    const episodes = await fetchTroubleEpisodes();
    expect(episodes.map((e) => e.device_id)).toEqual(['co2']);
    expect(String(vi.mocked(fetchJson).mock.calls[0][0])).toMatch(/^\/archive\/trouble\?since=/);
    expect(cloud.calls).toEqual([]);
  });

  it('fall back to the cloud when the edge cannot answer', async () => {
    vi.mocked(fetchJson).mockRejectedValue(new Error('HTTP 404'));
    await fetchTroubleEpisodes();
    expect(cloud.calls).toEqual(['from readings', 'from readings', 'from readings']);
  });
});

describe('device connectivity', () => {
  it('comes from the edge when it answers, with no cloud request', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ rows: [{ device_id: 'co1', samples: 1440, online_samples: 1400, transitions: 3, last_change: null, currently_online: true, expected_samples: 1440 }] });
    const map = await fetchDeviceConnectivity(24);
    expect(map.co1.transitions).toBe(3);
    expect(vi.mocked(fetchJson).mock.calls[0][0]).toBe('/archive/connectivity?hours=24');
    expect(cloud.calls).toEqual([]);
  });

  it('falls back to the RPC when the edge cannot answer', async () => {
    vi.mocked(fetchJson).mockRejectedValue(new Error('timeout'));
    await fetchDeviceConnectivity(24);
    expect(cloud.calls).toEqual(['rpc device_connectivity']);
  });
});

describe('the Analytics week', () => {
  it('comes from the edge in 15-minute buckets when it answers, with no cloud request', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ rows: [
      { ts: '2026-10-04T00:00:00.000Z', power_w: 20, voltage: 230, current: 0.1, sample_count: 15, online_count: 15 },
      { ts: '2026-10-04T00:15:00.000Z', power_w: null, voltage: null, current: null, sample_count: 15, online_count: 0 },
    ] });
    const points = await getLongHistory('co1', '7d');
    expect(points).toEqual([{ ts: '2026-10-04T00:00:00.000Z', power_w: 20, voltage: 230, current: 0.1, coverage: { online: 15, samples: 15 } }]);
    expect(String(vi.mocked(fetchJson).mock.calls[0][0])).toMatch(/^\/archive\/buckets\?device_id=co1&since=.+&bucket_s=900$/);
    expect(cloud.calls).toEqual([]);
  });

  it('falls back to readings_buckets when the edge cannot answer', async () => {
    vi.mocked(fetchJson).mockRejectedValue(new Error('HTTP 503'));
    await getLongHistory('co1', '7d');
    expect(cloud.calls).toEqual(['rpc readings_buckets']);
  });
});
