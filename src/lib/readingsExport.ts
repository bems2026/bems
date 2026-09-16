import { csvLine } from './csv';
import { boundDay, type HourAgg } from './boundedEnergy';

/**
 * Every reading behind a report, for export — RM-098.
 *
 * The operator asked for a CSV that shows each reading a circuit recorded over a week or a month —
 * time, voltage, current, power — not only the report's totals. Minute readings are kept for 30 days;
 * older hours survive only as hourly averages (retention, phase31), so the file holds a minute row where
 * one exists and an hourly row, labelled as one, for an hour that is only an average now. Which an hour
 * gets is decided by the data, not by a date: nothing here assumes where retention has reached.
 *
 * FETCHING A MONTH OF ONE METER IS 44,640 ROWS, and the API returns at most 1,000 per request without
 * saying it stopped. So:
 *   - pages are keyed on the timestamp (`ts > last`), never on an offset that shifts under inserts;
 *   - a page is fetched until one comes back EMPTY — a server with a cap below the page size would end a
 *     "stop on a short page" loop early and silently;
 *   - the cursor must move, or the export stops rather than looping;
 *   - the rows fetched must equal an exact count taken for the same window, or the export stops and says
 *     to try again, rather than writing a file with a hole in it.
 *
 * A COUNTER JUMP IS MARKED WHERE IT HAPPENED. The rule is `boundDay`'s, the one the reports are generated
 * with; the reading that carried the step is noted "not counted", so a reader of the raw file sees why
 * the report's figure is smaller than the counter.
 */

const PAGE = 1000;
const HOUR_MS = 3_600_000;

interface Result<T> {
  data: T[] | null;
  error: { message: string } | null;
  count?: number | null;
}

interface Query<T> extends PromiseLike<Result<T>> {
  select(columns: string, options?: { count?: 'exact'; head?: boolean }): Query<T>;
  eq(column: string, value: string): Query<T>;
  gte(column: string, value: string): Query<T>;
  lt(column: string, value: string): Query<T>;
  gt(column: string, value: string): Query<T>;
  order(column: string, options: { ascending: boolean }): Query<T>;
  limit(count: number): Query<T>;
  abortSignal(signal: AbortSignal): Query<T>;
}

/** The part of the Supabase client this uses — structural, so a test can hand in a fake. */
export interface ReadingsClient {
  from(table: 'readings'): Query<ExportReading>;
  from(table: 'readings_hourly'): Query<HourlyReading>;
}

export interface ExportReading {
  ts: string;
  voltage: number | null;
  current: number | null;
  power_w: number | null;
  energy_kwh_today: number | null;
  online: boolean;
}

export interface HourlyReading {
  hour: string;
  power_w_avg: number | null;
  power_w_max: number | null;
  voltage_avg: number | null;
  current_avg: number | null;
  energy_kwh_today_max: number | null;
  sample_count: number;
  online_sample_count: number;
}

export interface DeviceReadings {
  deviceId: string;
  raw: ExportReading[];
  /** Only hours with no minute readings left. */
  hourly: HourlyReading[];
}

export interface Window {
  startIso: string;
  endIso: string;
}

interface FetchOptions {
  signal?: AbortSignal;
  onRows?: (fetched: number) => void;
}

async function pageAll<T extends Record<string, unknown>>(
  query: () => Query<T>,
  key: keyof T & string,
  { signal, onRows }: FetchOptions,
  label: string
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  for (;;) {
    let q = query().order(key, { ascending: true }).limit(PAGE);
    if (cursor !== null) q = q.gt(key, cursor);
    if (signal) q = q.abortSignal(signal);
    const { data, error } = await q;
    if (error) throw new Error(`${label} could not be read: ${error.message}`);
    const page = data ?? [];
    if (page.length === 0) break;
    // The raw string, never a Date: a Date drops the microseconds the database keeps, and the next page
    // would start again inside the same second.
    const last = String(page[page.length - 1][key]);
    if (cursor !== null && last === cursor) throw new Error(`${label}: the page cursor did not advance, so the export stopped rather than loop.`);
    out.push(...page);
    cursor = last;
    onRows?.(out.length);
  }
  return out;
}

/** One device's minute readings for the window, and its hourly rows for hours with none left. */
export async function fetchDeviceReadings(client: ReadingsClient, deviceId: string, win: Window, options: FetchOptions = {}): Promise<DeviceReadings> {
  const { signal } = options;
  const rawQuery = () =>
    client.from('readings').select('ts,voltage,current,power_w,energy_kwh_today,online').eq('device_id', deviceId).gte('ts', win.startIso).lt('ts', win.endIso);
  const raw = await pageAll(rawQuery as () => Query<ExportReading & Record<string, unknown>>, 'ts', options, `The readings of ${deviceId}`);

  let counter = client.from('readings').select('ts', { count: 'exact', head: true }).eq('device_id', deviceId).gte('ts', win.startIso).lt('ts', win.endIso);
  if (signal) counter = counter.abortSignal(signal);
  const counted = await counter;
  if (counted.error) throw new Error(`The readings of ${deviceId} could not be counted: ${counted.error.message}`);
  if (typeof counted.count === 'number' && counted.count !== raw.length) {
    throw new Error(`The readings of ${deviceId} changed while exporting (${raw.length} fetched, ${counted.count} counted). Try again.`);
  }

  const hourlyQuery = () =>
    client
      .from('readings_hourly')
      .select('hour,power_w_avg,power_w_max,voltage_avg,current_avg,energy_kwh_today_max,sample_count,online_sample_count')
      .eq('device_id', deviceId)
      .gte('hour', win.startIso)
      .lt('hour', win.endIso);
  const hours = await pageAll(hourlyQuery as () => Query<HourlyReading & Record<string, unknown>>, 'hour', { signal }, `The hourly readings of ${deviceId}`);
  const rawHours = new Set(raw.map((r) => Math.floor(Date.parse(r.ts) / HOUR_MS)));
  const hourly = hours.filter((h) => !rawHours.has(Math.floor(Date.parse(h.hour) / HOUR_MS)));

  return { deviceId, raw, hourly };
}

/** Every device's readings, two at a time, with progress across all of them. */
export async function fetchReadingsForExport(
  client: ReadingsClient,
  deviceIds: readonly string[],
  win: Window,
  { signal, concurrency = 2, onProgress }: { signal?: AbortSignal; concurrency?: number; onProgress?: (p: { deviceId: string; fetched: number }) => void } = {}
): Promise<DeviceReadings[]> {
  const results: DeviceReadings[] = new Array(deviceIds.length);
  const done = new Map<string, number>();
  const total = () => [...done.values()].reduce((a, n) => a + n, 0);
  let next = 0;
  const worker = async () => {
    while (next < deviceIds.length) {
      const i = next++;
      const deviceId = deviceIds[i];
      results[i] = await fetchDeviceReadings(client, deviceId, win, {
        signal,
        onRows: (fetched) => {
          done.set(deviceId, fetched);
          onProgress?.({ deviceId, fetched: total() });
        },
      });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, deviceIds.length)) }, worker));
  return results;
}

/** `2026-09-08 02:36:00` — an instant in the building's own time, identical on every reader's machine. */
export function localStamp(iso: string, utcOffsetMinutes: number): string {
  const ms = Math.floor(Date.parse(iso) / 1000) * 1000 + utcOffsetMinutes * 60_000;
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

const round = (v: number | null | undefined, digits: number) => (v === null || v === undefined || !Number.isFinite(v) ? null : Number(Number(v).toFixed(digits)));

/** Local midnight, as an instant, of the local day an instant falls in. */
const localDayStart = (ms: number, offsetMs: number) => Math.floor((ms + offsetMs) / 86_400_000) * 86_400_000 - offsetMs;

/**
 * Where the counter jumped by more than the circuit could draw: minute rows by the reading that carried
 * the step, hourly rows by the hour. Keyed by timestamp string.
 */
function jumpNotes(readings: DeviceReadings, offsetMs: number): Map<string, string> {
  const notes = new Map<string, string>();
  const online = readings.raw.filter((r) => r.online).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

  // Minute rows, reduced to the hours the rule reads.
  const byHour = new Map<number, ExportReading[]>();
  for (const r of online) {
    const h = Math.floor(Date.parse(r.ts) / HOUR_MS) * HOUR_MS;
    (byHour.get(h) ?? byHour.set(h, []).get(h)!).push(r);
  }
  const aggs: HourAgg[] = [...byHour.entries()].map(([hourStartMs, rows]) => {
    const e = rows.map((r) => r.energy_kwh_today).filter((v): v is number => v !== null);
    const p = rows.map((r) => r.power_w).filter((v): v is number => v !== null);
    return {
      hourStartMs,
      energyMaxKwh: e.length > 0 ? Math.max(...e) : null,
      powerAvgW: p.length > 0 ? p.reduce((a, v) => a + v, 0) / p.length : null,
      powerMaxW: p.length > 0 ? Math.max(...p) : null,
    };
  });
  for (const h of readings.hourly) {
    aggs.push({ hourStartMs: Date.parse(h.hour), energyMaxKwh: h.energy_kwh_today_max, powerAvgW: h.power_w_avg, powerMaxW: h.power_w_max });
  }

  const days = new Map<number, HourAgg[]>();
  for (const a of aggs) {
    const d = localDayStart(a.hourStartMs, offsetMs);
    (days.get(d) ?? days.set(d, []).get(d)!).push(a);
  }

  for (const [dayStart, hours] of days) {
    for (const clip of boundDay(hours, dayStart).clipped) {
      const inHour = byHour.get(clip.hourStartMs);
      if (!inHour) {
        const hourRow = readings.hourly.find((h) => Date.parse(h.hour) === clip.hourStartMs);
        if (hourRow) notes.set(hourRow.hour, `counter jumped +${clip.riseKwh.toFixed(2)} kWh this hour — not counted`);
        continue;
      }
      // The reading that carried the step: the biggest single rise into this hour's readings.
      let best: { row: ExportReading; step: number } | null = null;
      for (const row of inHour) {
        const i = online.indexOf(row);
        const prev = i > 0 ? online[i - 1] : null;
        if (row.energy_kwh_today === null || !prev || prev.energy_kwh_today === null) continue;
        const step = row.energy_kwh_today - prev.energy_kwh_today;
        if (best === null || step > best.step) best = { row, step };
      }
      if (best && best.step > 0) {
        const draw = best.row.power_w === null ? '' : ` while drawing ${Math.round(best.row.power_w)} W`;
        notes.set(best.row.ts, `counter jumped +${best.step.toFixed(2)} kWh${draw} — not counted`);
      }
    }
  }
  return notes;
}

export const READINGS_CSV_HEADERS = (timezone: string) => [
  `Local time (${timezone})`,
  'Device ID',
  'Device',
  'Circuit',
  'Use',
  'Resolution',
  'Voltage (V)',
  'Current (A)',
  'Power (W)',
  'Highest power in hour (W)',
  'Energy counter today (kWh)',
  'Online',
  'Note',
];

/**
 * The CSV, as parts to hand to a Blob rather than one string — a month of eleven devices is half a
 * million rows, and building it as one string doubles the memory the kiosk needs for it.
 */
export function readingsCsvParts({
  devices,
  readings,
  utcOffsetMinutes,
  timezone,
}: {
  devices: readonly { id: string; name: string; circuit: string | null; use: string | null }[];
  readings: readonly DeviceReadings[];
  utcOffsetMinutes: number;
  timezone: string;
}): string[] {
  const offsetMs = utcOffsetMinutes * 60_000;
  const parts = [csvLine(READINGS_CSV_HEADERS(timezone))];
  for (const device of readings) {
    const d = devices.find((x) => x.id === device.deviceId);
    const name = d?.name ?? device.deviceId;
    const circuit = d?.circuit ?? null;
    const use = d?.use ?? null;
    const notes = jumpNotes(device, offsetMs);

    type Line = { at: number; cells: unknown[] };
    const lines: Line[] = [
      ...device.raw.map((r) => ({
        at: Date.parse(r.ts),
        cells: r.online
          ? [localStamp(r.ts, utcOffsetMinutes), device.deviceId, name, circuit, use, 'minute', round(r.voltage, 1), round(r.current, 3), round(r.power_w, 1), null, round(r.energy_kwh_today, 3), 'yes', notes.get(r.ts) ?? null]
          : // An offline row repeats the last value it had; it is not a reading, so it is not printed as one.
            [localStamp(r.ts, utcOffsetMinutes), device.deviceId, name, circuit, use, 'minute', null, null, null, null, null, 'no', 'offline — not a reading'],
      })),
      ...device.hourly.map((h) => ({
        at: Date.parse(h.hour),
        cells: [
          localStamp(h.hour, utcOffsetMinutes),
          device.deviceId,
          name,
          circuit,
          use,
          'hourly average',
          round(h.voltage_avg, 1),
          round(h.current_avg, 3),
          round(h.power_w_avg, 1),
          round(h.power_w_max, 1),
          round(h.energy_kwh_today_max, 3),
          `${h.online_sample_count} of ${h.sample_count} min`,
          notes.get(h.hour) ?? null,
        ],
      })),
    ].sort((a, b) => a.at - b.at);

    if (lines.length > 0) parts.push(`\r\n${lines.map((l) => csvLine(l.cells)).join('\r\n')}`);
  }
  return parts;
}
