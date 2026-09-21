import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fleetById, EMPTY_FLEET, fetchCloudFleet, type CloudDevice } from './tuyaFleet';

const bridge = vi.hoisted(() => ({ fetchJson: vi.fn() }));
vi.mock('./bridgeClient', () => ({ fetchJson: bridge.fetchJson }));

describe('fetchCloudFleet', () => {
  beforeEach(() => {
    bridge.fetchJson.mockReset();
  });

  it('carries which sources answered, so a lapsed subscription is a stated state rather than an empty list', async () => {
    const sources = {
      cloud: { status: 'unavailable', detail: 'code 28841002: IoT Core subscription expired' },
      imported: { count: 12, last_complete_at: '2026-09-22T01:00:00.000Z' },
      lan: { listening_since: '2026-09-22T00:00:00.000Z' },
    };
    bridge.fetchJson.mockResolvedValue({
      devices: [{ id: 'a1', name: 'CO9', credential_source: 'imported', on_lan: true, lan_version: '3.4' }],
      claimed_known: true,
      orphan_nodes: [],
      sources,
    });
    const fleet = await fetchCloudFleet();
    expect(fleet.status).toBe('ready');
    expect(fleet.sources).toEqual(sources);
    expect(fleet.byId.a1.on_lan).toBe(true);
  });

  it('reads a proxy that predates the sources block as having none, not as broken', async () => {
    bridge.fetchJson.mockResolvedValue({ devices: [], claimed_known: true, orphan_nodes: [] });
    expect((await fetchCloudFleet()).sources).toBeNull();
  });
});

describe('fleetById', () => {
  it('keys devices by their Tuya id — the one identifier both sides share', () => {
    const map = fleetById([
      { id: 'a1', name: 'CO1', online: true },
      { id: 'b2', name: 'L1', online: false },
    ]);
    expect(Object.keys(map).sort()).toEqual(['a1', 'b2']);
    expect(map.a1.online).toBe(true);
  });

  it('skips an entry with no id rather than creating an undefined key', () => {
    const map = fleetById([{ name: 'nameless' } as CloudDevice, { id: 'a1', name: 'CO1' }]);
    expect(Object.keys(map)).toEqual(['a1']);
  });

  it('handles an empty fleet', () => {
    expect(fleetById([])).toEqual({});
  });
});

describe('EMPTY_FLEET', () => {
  it('starts as loading, not as ready-and-empty', () => {
    // Ready-and-empty would render "no cloud device" against every row while the request is
    // still in flight, which is a claim rather than a waiting state.
    expect(EMPTY_FLEET.status).toBe('loading');
    expect(EMPTY_FLEET.byId).toEqual({});
  });
});
