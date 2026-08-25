import { describe, it, expect } from 'vitest';
import { connectivityRowsToMap, flapSeverity, fleetStuck, isFleetStuck, type ConnectivityRow } from './deviceConnectivity';

const row = (o: Partial<ConnectivityRow>): ConnectivityRow => ({
  device_id: 'co1',
  samples: 1440,
  online_samples: 1440,
  transitions: 0,
  last_change: null,
  currently_online: true,
  ...o,
});

describe('flapSeverity', () => {
  it('calls a device with no transitions steady', () => {
    expect(flapSeverity(row({ transitions: 0 }))).toBe('steady');
  });

  it('does not call a single transition flapping — coming back up once is a recovery', () => {
    expect(flapSeverity(row({ transitions: 1 }))).toBe('steady');
  });

  it('flags repeated transitions', () => {
    expect(flapSeverity(row({ transitions: 6 }))).toBe('unstable');
  });

  it('escalates when a device is changing state many times in the window', () => {
    expect(flapSeverity(row({ transitions: 40 }))).toBe('severe');
  });

  it('judges an empty window as unknown rather than steady', () => {
    // Zero transitions across zero samples is not evidence of stability.
    expect(flapSeverity(row({ samples: 0, online_samples: 0, transitions: 0 }))).toBe('unknown');
  });
});

describe('connectivityRowsToMap', () => {
  it('keys rows by device id', () => {
    const map = connectivityRowsToMap([row({ device_id: 'co1' }), row({ device_id: 'l1' })]);
    expect(Object.keys(map).sort()).toEqual(['co1', 'l1']);
    expect(map.co1.samples).toBe(1440);
  });

  it('survives an empty result without throwing', () => {
    expect(connectivityRowsToMap([])).toEqual({});
  });

  it('coerces the bigint-shaped counts PostgREST may return as strings', () => {
    // Postgres `bigint` comes back as a JSON string through PostgREST when it exceeds the
    // safe integer range, and supabase-js does not coerce it. Counts here are small, but
    // relying on that is how a number silently becomes a string concatenation later.
    const map = connectivityRowsToMap([
      { ...row({}), samples: '120' as unknown as number, online_samples: '60' as unknown as number, transitions: '3' as unknown as number },
    ]);
    expect(map.co1.samples).toBe(120);
    expect(map.co1.transitions).toBe(3);
    expect(flapSeverity(map.co1)).toBe('unstable');
  });
});

/**
 * The fleet-stuck signal.
 *
 * WHY IT IS NOT JUST "COUNT THE OFFLINE DEVICES": on 2026-08-25 a Node-RED restart recovered
 * five devices that a written diagnosis had called a hardware fault — `l6` had `EHOSTUNREACH`
 * at every protocol version and a roadmap entry saying it needed eyes on the fixture. A tuya
 * node that has given up stays given up and looks exactly like an unplugged device, so the
 * remedy is cheap and remote and nothing surfaced it.
 *
 * But two devices on this site are offline permanently BY DESIGN — the IR blaster and the
 * outside-temp sensor are not in the Tuya cloud project and are deliberately quiesced. Counting
 * them would pin this alert on forever, which is how a warning becomes something people stop
 * reading. `online_samples` separates the two cases with evidence rather than a hardcoded
 * exclusion list: a device that was up at some point in the window CAN be up, so its being down
 * now is a change. One that has never been up in 24h is not news.
 */
describe('fleetStuck', () => {
  const map = (rows: ConnectivityRow[]) => connectivityRowsToMap(rows);

  it('counts a device that was online in the window and is not now', () => {
    const r = fleetStuck(map([row({ device_id: 'co1', currently_online: false, online_samples: 900 })]));
    expect(r.stuck).toEqual(['co1']);
  });

  it('ignores a device that has never been online in the window — that is not news', () => {
    // The quiesced IR blaster and outside-temp sensor live here permanently.
    const r = fleetStuck(map([row({ device_id: 'sens_outside_temp', currently_online: false, online_samples: 0 })]));
    expect(r.stuck).toEqual([]);
    expect(r.chronic).toEqual(['sens_outside_temp']);
  });

  it('ignores devices that are online', () => {
    expect(fleetStuck(map([row({ device_id: 'l1', currently_online: true })])).stuck).toEqual([]);
  });

  it('does not call a single dropped device a fleet event', () => {
    // One flaky device is RM-013 being RM-013. Three at once is something that happened.
    const r = fleetStuck(map([row({ device_id: 'co1', currently_online: false, online_samples: 900 })]));
    expect(isFleetStuck(r)).toBe(false);
  });

  it('calls three simultaneous drops a fleet event', () => {
    const r = fleetStuck(map([
      row({ device_id: 'co1', currently_online: false, online_samples: 900 }),
      row({ device_id: 'co2', currently_online: false, online_samples: 900 }),
      row({ device_id: 'co3', currently_online: false, online_samples: 900 }),
    ]));
    expect(isFleetStuck(r)).toBe(true);
  });

  it('is not tripped by chronic devices even when there are many of them', () => {
    const r = fleetStuck(map([
      row({ device_id: 'a', currently_online: false, online_samples: 0 }),
      row({ device_id: 'b', currently_online: false, online_samples: 0 }),
      row({ device_id: 'c', currently_online: false, online_samples: 0 }),
      row({ device_id: 'd', currently_online: false, online_samples: 0 }),
    ]));
    expect(isFleetStuck(r)).toBe(false);
    expect(r.chronic).toHaveLength(4);
  });

  it('handles an empty map — no data is not an emergency', () => {
    expect(isFleetStuck(fleetStuck({}))).toBe(false);
  });
});
