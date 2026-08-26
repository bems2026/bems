import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PRESENCE_ON_SEGMENT, PRESENCE_ABSENT, presenceSplit, fetchDevicePresence, type DevicePresence } from './devicePresence';

const dev = (name: string, cloud_online: boolean, presence: string | null, arp_state: string | null = null) => ({
  id: name.toLowerCase(),
  name,
  cloud_online,
  presence,
  arp_state,
});

const ready = (devices: ReturnType<typeof dev>[], arpReadable = true): DevicePresence => ({
  devices,
  arpReadable,
  status: 'ready',
});

afterEach(() => vi.unstubAllGlobals());

describe('presenceSplit', () => {
  it('separates the config change from the journey', () => {
    // This is the entire value of the endpoint. "Dark and still answering ARP" is a static
    // deviceIp away from working; "dark and absent" needs somebody to walk to the outlet.
    // Collapsing them is what sends a person to the office for a device that never needed one.
    const split = presenceSplit(ready([
      dev('CO5', false, PRESENCE_ON_SEGMENT, 'STALE'),
      dev('CO4', false, PRESENCE_ABSENT),
      dev('CO6', false, PRESENCE_ABSENT),
      dev('CO7', true, PRESENCE_ON_SEGMENT, 'REACHABLE'),
    ]));
    expect(split.onSegment.map((d) => d.name)).toEqual(['CO5']);
    expect(split.absent.map((d) => d.name)).toEqual(['CO4', 'CO6']);
  });

  it('never lists a device the cloud can still reach', () => {
    // Cloud-online means the device is up and talking over the internet. Whatever ARP says,
    // it is not the thing anyone needs to act on, and listing it would bury the ones that are.
    const split = presenceSplit(ready([dev('L1', true, PRESENCE_ABSENT)]));
    expect(split.onSegment).toEqual([]);
    expect(split.absent).toEqual([]);
  });

  it('claims nothing at all when the ARP table could not be read', () => {
    // The fixture deliberately carries REAL presence values alongside arpReadable: false —
    // the combination a server that forgot to withhold them would send, or an older one that
    // never had the flag. Written the obvious way, with presence: null, this test passed with
    // the guard deleted: the groups came out empty either way, so it proved nothing. It is the
    // function that decides whether a screen tells somebody to drive to the office, so it has
    // to distrust the payload rather than rely on the server having been careful.
    const split = presenceSplit(ready([
      dev('CO4', false, PRESENCE_ABSENT),
      dev('CO5', false, PRESENCE_ON_SEGMENT, 'STALE'),
    ], false));
    expect(split.onSegment).toEqual([]);
    expect(split.absent).toEqual([]);
  });
});

describe('fetchDevicePresence', () => {
  it('reads unconfigured apart from broken', async () => {
    // Same reasoning as fetchCloudFleet: a site never given Tuya credentials is not faulty,
    // and showing it an error for a feature it does not have is noise.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 501, text: async () => '501' }));
    expect((await fetchDevicePresence()).status).toBe('unconfigured');
  });

  it('carries arp_readable through rather than defaulting it to true', async () => {
    // Defaulting a missing flag to true would make an older server, or a truncated reply,
    // render as a confident segment survey. The safe default is "cannot say".
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ devices: [dev('CO4', false, null)] }),
    }));
    const out = await fetchDevicePresence();
    expect(out.status).toBe('ready');
    expect(out.arpReadable).toBe(false);
  });
});

describe('presence literals', () => {
  it('match the server, which is where they are actually produced', () => {
    // These strings cross a process boundary as data, so nothing type-checks them. The server
    // owns them; a rename there would silently empty every group here, and an empty list reads
    // as "nothing to do" — the most dangerous wrong answer this feature can give.
    const source = readFileSync(join(process.cwd(), 'server', 'macPresence.mjs'), 'utf8');
    expect(source).toContain(`ON_SEGMENT: '${PRESENCE_ON_SEGMENT}'`);
    expect(source).toContain(`ABSENT: '${PRESENCE_ABSENT}'`);
  });
});
