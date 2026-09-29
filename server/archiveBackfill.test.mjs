/**
 * Tests for server/archiveBackfill.mjs — copying what the cloud already holds into the Pi's
 * archive (RM-148, Stage 2), before anything is pruned to 14 days.
 *
 * The cloud is a hand-rolled `fetchWindow` serving from an array, behaving as PostgREST does:
 * half-open time filter, oldest first, and a silent cap at `limit` rows — the cap is the whole
 * reason windows have to split, so the fake has it too.
 *
 *     node --test server/archiveBackfill.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { openArchive, ORIGIN } from './archiveDb.mjs';
import { windowsBetween, windowQuery, backfillStream, importNdjson } from './archiveBackfill.mjs';

const T0 = Date.parse('2026-09-01T00:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;

function tempArchive(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ibems-backfill-test-'));
  const archive = openArchive(path.join(dir, 'archive.sqlite'));
  t.after(() => { archive.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return archive;
}

const reading = (deviceId, ms) => ({
  device_id: deviceId, ts: new Date(ms).toISOString().replace('Z', '+00:00'), voltage: 226, current: 0.1, power_w: 12,
  energy_kwh_today: 0.3, online: true, total_energy_kwh: null, warn_power_w: null, power_type: null, net_state: null,
  fault: null, capabilities: { switch_1: true },
});

/** A cloud holding `rows`, answering the way PostgREST does, and counting its requests. */
function cloud(rows) {
  const calls = [];
  const fetchWindow = async (stream, { deviceId, sinceIso, untilIso, limit }) => {
    calls.push({ stream, deviceId, sinceIso, untilIso });
    const s = Date.parse(sinceIso);
    const e = Date.parse(untilIso);
    return rows
      .filter((r) => (deviceId === undefined || r.device_id === deviceId) && Date.parse(r.ts) >= s && Date.parse(r.ts) < e)
      .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
      .slice(0, limit);
  };
  return { calls, fetchWindow };
}

test('windows cover the range exactly, half-open, the last one cut short', () => {
  assert.deepEqual(windowsBetween(T0, T0 + 5 * HOUR, 2 * HOUR), [
    [T0, T0 + 2 * HOUR], [T0 + 2 * HOUR, T0 + 4 * HOUR], [T0 + 4 * HOUR, T0 + 5 * HOUR],
  ]);
  assert.deepEqual(windowsBetween(T0, T0, HOUR), []);
});

test('the query asks for the archive\'s own columns only, one device, one window, oldest first', () => {
  const q = windowQuery('readings', { deviceId: 'co1', sinceIso: '2026-09-01T00:00:00+00:00', untilIso: '2026-09-01T12:00:00+00:00', limit: 1000 });
  assert.match(q, /^select=device_id,ts,voltage,current,power_w,energy_kwh_today,online,total_energy_kwh,warn_power_w,power_type,net_state,fault,capabilities&/);
  assert.match(q, /&device_id=eq\.co1&/);
  assert.match(q, /&ts=gte\.2026-09-01T00%3A00%3A00%2B00%3A00&ts=lt\.2026-09-01T12%3A00%3A00%2B00%3A00&/, 'a "+" in a timestamp must not arrive as a space');
  assert.match(q, /&order=ts\.asc&limit=1000$/);
  assert.doesNotMatch(windowQuery('building_totals', { sinceIso: 'a', untilIso: 'b', limit: 5 }), /device_id=/);
});

test('every row the cloud holds is copied in, as cloud rows the uploader will never send back', async (t) => {
  const archive = tempArchive(t);
  const rows = [];
  for (let m = 0; m < 30; m++) for (const d of ['co1', 'l1']) rows.push(reading(d, T0 + m * MIN));
  const { fetchWindow } = cloud(rows);

  const result = await backfillStream({ archive, fetchWindow, stream: 'readings', deviceIds: ['co1', 'l1'], sinceMs: T0, untilMs: T0 + HOUR, windowMs: 10 * MIN, limit: 1000 });

  assert.deepEqual(result, { fetched: 60, inserted: 60, windows: 12 });
  assert.equal(archive.stats().readings, 60);
  assert.equal(archive.lag().readings, 0);
  const [one] = archive.pending('readings', 1);
  assert.equal(one, undefined);
  assert.equal(archive.countRange('readings', { sinceMs: T0, untilMs: T0 + HOUR, deviceId: 'l1' }), 30);
});

test('rows ingest already archived are not copied twice', async (t) => {
  const archive = tempArchive(t);
  const rows = [reading('co1', T0), reading('co1', T0 + MIN)];
  archive.insertTick({ readings: [rows[1]] });
  const { fetchWindow } = cloud(rows);
  const result = await backfillStream({ archive, fetchWindow, stream: 'readings', deviceIds: ['co1'], sinceMs: T0, untilMs: T0 + HOUR, windowMs: HOUR, limit: 1000 });
  assert.equal(result.fetched, 2);
  assert.equal(result.inserted, 1);
  assert.equal(archive.stats().readings, 2);
  assert.equal(archive.lag().readings, 1, 'the ingest row is still owed to the cloud; the copied one is not');
});

test('a window the cloud answers with a full page is split until every part fits', async (t) => {
  // PostgREST caps silently. A full page is indistinguishable from "all of it", so it is never trusted.
  const archive = tempArchive(t);
  const rows = [];
  for (let m = 0; m < 50; m++) rows.push(reading('co1', T0 + m * MIN));
  const { calls, fetchWindow } = cloud(rows);

  const result = await backfillStream({ archive, fetchWindow, stream: 'readings', deviceIds: ['co1'], sinceMs: T0, untilMs: T0 + HOUR, windowMs: HOUR, limit: 20 });

  assert.equal(result.fetched, 50);
  assert.equal(archive.stats().readings, 50);
  assert.ok(calls.length > 1);
});

test('a window that cannot be split small enough stops the backfill rather than copying part of it', async (t) => {
  const archive = tempArchive(t);
  const rows = Array.from({ length: 5 }, () => reading('co1', T0));
  const { fetchWindow } = cloud(rows);
  await assert.rejects(
    backfillStream({ archive, fetchWindow, stream: 'readings', deviceIds: ['co1'], sinceMs: T0, untilMs: T0 + 2 * MIN, windowMs: 2 * MIN, limit: 3 }),
    /cannot split/,
  );
});

test('a window whose rows do not land in that window stops the backfill', async (t) => {
  // The per-window check: the archive must hold at least what the cloud returned for the window it
  // was asked about. A filter that misbehaved, or a timestamp that parsed differently, fails here.
  const archive = tempArchive(t);
  const fetchWindow = async () => [reading('co1', T0 - HOUR)];
  await assert.rejects(
    backfillStream({ archive, fetchWindow, stream: 'readings', deviceIds: ['co1'], sinceMs: T0, untilMs: T0 + HOUR, windowMs: HOUR, limit: 1000 }),
    /holds 0 rows for a window the cloud returned 1 for/,
  );
});

test('building totals are copied without a device filter', async (t) => {
  const archive = tempArchive(t);
  const bt = (ms) => ({ ts: new Date(ms).toISOString(), site_id: 's', energy_kwh_today: 1, energy_kwh_week: null, energy_kwh_month: null, energy_kwh_today_integrated: null, energy_kwh_week_integrated: null, energy_kwh_month_integrated: null, total_power_w: 50, avg_voltage: 230, phase_current_red: null, phase_current_yellow: null, phase_current_blue: null });
  const { calls, fetchWindow } = cloud([bt(T0), bt(T0 + MIN)]);
  const result = await backfillStream({ archive, fetchWindow, stream: 'building_totals', sinceMs: T0, untilMs: T0 + HOUR, windowMs: HOUR, limit: 1000 });
  assert.equal(result.inserted, 2);
  assert.deepEqual(calls.map((c) => c.deviceId), [undefined]);
});

test('an export file is imported as rows the cloud never gets back', (t) => {
  const archive = tempArchive(t);
  const lines = [JSON.stringify(reading('co1', T0)), '', JSON.stringify(reading('co2', T0))];
  const result = importNdjson({ archive, stream: 'readings', lines, chunk: 1 });
  assert.deepEqual(result, { read: 2, inserted: 2 });
  assert.equal(archive.lag().readings, 0);
  assert.equal(archive.countRange('readings', { sinceMs: T0, untilMs: T0 + MIN }), 2);
  assert.ok(ORIGIN.import !== ORIGIN.ingest);
});
