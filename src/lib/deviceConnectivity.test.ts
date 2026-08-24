import { describe, it, expect } from 'vitest';
import { connectivityRowsToMap, uptimeRatio, flapSeverity, connectivityCoverage, type ConnectivityRow } from './deviceConnectivity';

const row = (o: Partial<ConnectivityRow>): ConnectivityRow => ({
  device_id: 'co1',
  samples: 1440,
  online_samples: 1440,
  transitions: 0,
  last_change: null,
  currently_online: true,
  ...o,
});

describe('uptimeRatio', () => {
  it('is the share of samples that were online', () => {
    expect(uptimeRatio(row({ samples: 100, online_samples: 75 }))).toBe(0.75);
  });

  it('returns null when the window holds no samples at all, rather than 0', () => {
    // A device with no rows has unknown uptime, not zero uptime. Rendering 0% would assert
    // it was down all day, which is a different and much stronger claim than "no data".
    expect(uptimeRatio(row({ samples: 0, online_samples: 0 }))).toBeNull();
  });
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
    expect(uptimeRatio(map.co1)).toBe(0.5);
    expect(flapSeverity(map.co1)).toBe('unstable');
  });
});

/**
 * Added after the first version shipped and its own output showed the flaw: outlets carry a
 * device-reported `ts` (`buildLatest.mjs:72`), `readings` is keyed `(device_id, ts)`, and ingest
 * upserts — so a device whose clock stalls overwrites its own row instead of adding one. Its
 * `samples` then undercounts the window, and "73% up over 40 samples" was being rendered
 * alongside "58% up over 60" as though they were the same measurement.
 */
describe('coverage', () => {
  it('is complete when the window holds every sample it should', () => {
    const c = connectivityCoverage(row({ samples: 60, expected_samples: 60 }));
    expect(c?.band).toBe('complete');
  });

  it('is sparse when most of the window has no row at all', () => {
    const c = connectivityCoverage(row({ samples: 12, expected_samples: 60 }));
    expect(c?.band).toBe('sparse');
    expect(c?.ratio).toBeCloseTo(0.2);
  });

  it('is unknown when the function did not report an expected count', () => {
    // A row from the pre-phase-15b RPC has no expected_samples. Guessing one would invent the
    // very denominator this exists to make explicit.
    expect(connectivityCoverage(row({ expected_samples: undefined }))).toBeNull();
  });

  it('measures rows recorded, not rows online — a device fully offline was still observed', () => {
    const c = connectivityCoverage(row({ samples: 60, online_samples: 0, expected_samples: 60 }));
    expect(c?.band).toBe('complete');
  });
});

describe('uptime and coverage together', () => {
  it('keeps uptime a statement about what was recorded, not about the whole window', () => {
    // 40 of 60 minutes recorded, 30 of those online. Uptime is 30/40, not 30/60: the 20
    // unrecorded minutes are unknown, and folding them in either direction would be a guess.
    const r = row({ samples: 40, online_samples: 30, expected_samples: 60 });
    expect(uptimeRatio(r)).toBe(0.75);
    expect(connectivityCoverage(r)?.band).toBe('partial');
  });
});
