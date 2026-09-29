import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./bridgeClient', () => ({ fetchJson: vi.fn() }));

import { fetchJson } from './bridgeClient';
import { edgeRawSource } from './edgeArchive';

/**
 * RM-148 — minute readings older than the cloud's raw window come from the edge's archive, through
 * the proxy. The edge answering nothing useful must not fail an export: it falls back to the cloud.
 */
describe('edgeRawSource', () => {
  const win = { startIso: '2026-09-01T00:00:00.000Z', endIso: '2026-09-08T00:00:00.000Z' };

  beforeEach(() => {
    vi.mocked(fetchJson).mockReset(); // braces: a value returned from beforeEach is run as a teardown
  });

  it('asks the proxy for one device and one window, and hands back its rows', async () => {
    const rows = [{ ts: '2026-09-01T00:00:00.000Z', voltage: 230, current: 0.1, power_w: 10, energy_kwh_today: 0.5, online: true }];
    vi.mocked(fetchJson).mockResolvedValue({ device_id: 'co1', rows });
    expect(await edgeRawSource('co1', win)).toEqual(rows);
    const [path] = vi.mocked(fetchJson).mock.calls[0];
    expect(path).toBe('/archive/readings?device_id=co1&since=2026-09-01T00%3A00%3A00.000Z&until=2026-09-08T00%3A00%3A00.000Z');
  });

  it('answers null when the edge cannot — no archive, an older proxy, or no proxy at all', async () => {
    vi.mocked(fetchJson).mockRejectedValue(new Error('HTTP 404'));
    expect(await edgeRawSource('co1', win)).toBeNull();
  });

  it('answers null for a reply that is not rows', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ unexpected: true });
    expect(await edgeRawSource('co1', win)).toBeNull();
  });
});
