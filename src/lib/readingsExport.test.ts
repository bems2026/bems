import { describe, it, expect } from 'vitest';
import { fetchDeviceReadings, fetchReadingsForExport, localStamp, readingsCsvParts, type ReadingsClient } from './readingsExport';

/**
 * RM-098 — every reading, for a week or a month.
 *
 * The API caps a response at 1,000 rows and says nothing when it does; a month of one meter is 44,640.
 * So the fetch pages by timestamp, stops only on an EMPTY page (a server with a smaller cap would end a
 * "short page" loop early and silently), checks the total against an exact count, and gives up loudly
 * rather than writing a file with a hole in it.
 */

interface Row {
  device_id: string;
  ts: string;
  voltage: number | null;
  current: number | null;
  power_w: number | null;
  energy_kwh_today: number | null;
  online: boolean;
}

interface HourRow {
  device_id: string;
  hour: string;
  power_w_avg: number | null;
  power_w_max: number | null;
  voltage_avg: number | null;
  current_avg: number | null;
  energy_kwh_today_max: number | null;
  sample_count: number;
  online_sample_count: number;
}

/**
 * A fake of the query builder the export uses, over in-memory tables, with a server row cap. `lie`
 * changes the exact count it reports, to prove the export checks it.
 */
function fakeClient(tables: { readings: Row[]; readings_hourly: HourRow[] }, { cap = 1000, lie = 0, stuck = false } = {}): ReadingsClient & { requests: number } {
  const client = {
    requests: 0,
    from(table: 'readings' | 'readings_hourly') {
      const key = table === 'readings' ? 'ts' : 'hour';
      const filters: ((r: Record<string, unknown>) => boolean)[] = [];
      let limit = Infinity;
      let head = false;
      let count = false;
      const builder = {
        select(_cols: string, opts?: { count?: 'exact'; head?: boolean }) {
          head = opts?.head ?? false;
          count = opts?.count === 'exact';
          return builder;
        },
        eq(col: string, v: unknown) {
          filters.push((r) => r[col] === v);
          return builder;
        },
        gte(col: string, v: string) {
          filters.push((r) => Date.parse(String(r[col])) >= Date.parse(v));
          return builder;
        },
        lt(col: string, v: string) {
          filters.push((r) => Date.parse(String(r[col])) < Date.parse(v));
          return builder;
        },
        gt(col: string, v: string) {
          // A stuck server ignores the cursor, which must be caught rather than looped on forever.
          if (!stuck) filters.push((r) => Date.parse(String(r[col])) > Date.parse(v));
          return builder;
        },
        order() {
          return builder;
        },
        limit(n: number) {
          limit = n;
          return builder;
        },
        abortSignal(signal: AbortSignal) {
          if (signal.aborted) throw new DOMException('aborted', 'AbortError');
          return builder;
        },
        then(resolve: (v: unknown) => void) {
          client.requests += 1;
          const all = (tables[table] as unknown as Record<string, unknown>[])
            .filter((r) => filters.every((f) => f(r)))
            .sort((a, b) => Date.parse(String(a[key])) - Date.parse(String(b[key])));
          if (head) return resolve({ data: null, error: null, count: count ? all.length + lie : null });
          return resolve({ data: all.slice(0, Math.min(limit, cap)), error: null, count: null });
        },
      };
      return builder;
    },
  };
  return client as unknown as ReadingsClient & { requests: number };
}

const WIN = { startIso: '2026-09-07T16:00:00Z', endIso: '2026-09-08T16:00:00Z' };
const minute = (i: number) => new Date(Date.parse('2026-09-07T18:00:00Z') + i * 60_000).toISOString().replace('.000Z', '+00:00');
const reading = (device_id: string, i: number, o: Partial<Row> = {}): Row => ({
  device_id,
  ts: minute(i),
  voltage: 230,
  current: 0.2,
  power_w: 49,
  energy_kwh_today: 0.1 + i * 0.001,
  online: true,
  ...o,
});

describe('fetchDeviceReadings', () => {
  it('pages past a server cap by timestamp, and returns every row in order', async () => {
    const rows = Array.from({ length: 1234 }, (_, i) => reading('m1', i));
    const client = fakeClient({ readings: rows, readings_hourly: [] }, { cap: 500 });
    const got = await fetchDeviceReadings(client, 'm1', WIN);
    expect(got.raw).toHaveLength(1234);
    expect(got.raw[0].ts).toBe(rows[0].ts);
    expect(got.raw.at(-1)?.ts).toBe(rows.at(-1)?.ts);
  });

  it('refuses a result the exact count disagrees with, rather than writing a file with a hole in it', async () => {
    const client = fakeClient({ readings: Array.from({ length: 10 }, (_, i) => reading('m1', i)), readings_hourly: [] }, { lie: 3 });
    await expect(fetchDeviceReadings(client, 'm1', WIN)).rejects.toThrow(/changed while exporting|try again/i);
  });

  it('stops, loudly, when the cursor does not move', async () => {
    const client = fakeClient({ readings: Array.from({ length: 5 }, (_, i) => reading('m1', i)), readings_hourly: [] }, { stuck: true });
    await expect(fetchDeviceReadings(client, 'm1', WIN)).rejects.toThrow(/did not advance/);
  });

  it('keeps an hourly row only for an hour that has no minute readings left', async () => {
    const hourly = (hour: string): HourRow => ({ device_id: 'm1', hour, power_w_avg: 40, power_w_max: 50, voltage_avg: 230, current_avg: 0.2, energy_kwh_today_max: 0.05, sample_count: 60, online_sample_count: 52 });
    const client = fakeClient({ readings: [reading('m1', 0)], readings_hourly: [hourly('2026-09-07T17:00:00+00:00'), hourly('2026-09-07T18:00:00+00:00')] });
    const got = await fetchDeviceReadings(client, 'm1', WIN);
    expect(got.hourly.map((h) => h.hour)).toEqual(['2026-09-07T17:00:00+00:00']);
  });

  it('can be cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const client = fakeClient({ readings: [reading('m1', 0)], readings_hourly: [] });
    await expect(fetchDeviceReadings(client, 'm1', WIN, { signal: controller.signal })).rejects.toThrow();
  });
});

describe('fetchReadingsForExport', () => {
  it('reads every device and reports its progress', async () => {
    const client = fakeClient({ readings: [...Array.from({ length: 3 }, (_, i) => reading('m1', i)), ...Array.from({ length: 2 }, (_, i) => reading('m2', i))], readings_hourly: [] });
    const seen: number[] = [];
    const got = await fetchReadingsForExport(client, ['m1', 'm2'], WIN, { onProgress: (p) => seen.push(p.fetched) });
    expect(got.map((d) => [d.deviceId, d.raw.length])).toEqual([
      ['m1', 3],
      ['m2', 2],
    ]);
    expect(Math.max(...seen)).toBe(5);
  });
});

describe('readingsCsvParts', () => {
  const devices = [{ id: 'm1', name: 'Lighting meter', circuit: 'Lights B', use: 'Lighting' }];

  it('writes one row per reading, in the building’s own time, with its units in the header', () => {
    const csv = readingsCsvParts({ devices, readings: [{ deviceId: 'm1', raw: [reading('m1', 0), reading('m1', 1)], hourly: [] }], utcOffsetMinutes: 480, timezone: 'Asia/Manila' }).join('');
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(
      'Local time (Asia/Manila),Device ID,Device,Circuit,Use,Resolution,Voltage (V),Current (A),Power (W),Highest power in hour (W),Energy counter today (kWh),Online,Note'
    );
    expect(lines[1]).toBe('2026-09-08 02:00:00,m1,Lighting meter,Lights B,Lighting,minute,230,0.2,49,,0.1,yes,');
    expect(lines).toHaveLength(3);
  });

  it('leaves an offline row’s figures empty and says why, never a repeated value as a reading', () => {
    const csv = readingsCsvParts({ devices, readings: [{ deviceId: 'm1', raw: [reading('m1', 0, { online: false })], hourly: [] }], utcOffsetMinutes: 480, timezone: 'Asia/Manila' }).join('');
    expect(csv.split('\r\n')[1]).toBe('2026-09-08 02:00:00,m1,Lighting meter,Lights B,Lighting,minute,,,,,,no,offline — not a reading');
  });

  it('marks the reading where the counter jumped by more than the circuit could draw', () => {
    // The live shape: 0.111 -> 67.391 in a minute at 49 W.
    const raw = [reading('m1', 0, { energy_kwh_today: 0.111 }), reading('m1', 1, { energy_kwh_today: 67.391 }), reading('m1', 2, { energy_kwh_today: 67.392 })];
    const lines = readingsCsvParts({ devices, readings: [{ deviceId: 'm1', raw, hourly: [] }], utcOffsetMinutes: 480, timezone: 'Asia/Manila' }).join('').split('\r\n');
    expect(lines[2]).toMatch(/counter jumped \+67\.28 kWh while drawing 49 W — not counted$/);
    expect(lines[1]).toMatch(/,$/);
    expect(lines[3]).toMatch(/,$/);
  });

  it('writes an hour that only survives as an average as one hourly row, and says so', () => {
    const csv = readingsCsvParts({
      devices,
      readings: [{ deviceId: 'm1', raw: [], hourly: [{ hour: '2026-09-07T17:00:00+00:00', power_w_avg: 40, power_w_max: 50, voltage_avg: 230, current_avg: 0.2, energy_kwh_today_max: 0.05, sample_count: 60, online_sample_count: 52 }] }],
      utcOffsetMinutes: 480,
      timezone: 'Asia/Manila',
    }).join('');
    expect(csv.split('\r\n')[1]).toBe('2026-09-08 01:00:00,m1,Lighting meter,Lights B,Lighting,hourly average,230,0.2,40,50,0.05,52 of 60 min,');
  });

  it('neutralises a device name a spreadsheet would run as a formula', () => {
    const csv = readingsCsvParts({ devices: [{ ...devices[0], name: '=HYPERLINK("x")' }], readings: [{ deviceId: 'm1', raw: [reading('m1', 0)], hourly: [] }], utcOffsetMinutes: 480, timezone: 'Asia/Manila' }).join('');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

describe('localStamp', () => {
  it('writes an instant in the building’s own time, the same on every reader’s machine', () => {
    expect(localStamp('2026-09-07T18:36:00+00:00', 480)).toBe('2026-09-08 02:36:00');
    expect(localStamp('2026-09-07T18:36:00.123456+00:00', 480)).toBe('2026-09-08 02:36:00');
  });
});
