/**
 * Tests for server/archiveUpload.mjs — draining the archive to Supabase (RM-148).
 *
 * A real archive in a temp directory and a hand-rolled `send` — the plain recording function
 * this repo uses instead of a mocking library. What these pin is the order and the cursor:
 * a row reaches the cloud once, oldest first, and the cursor only ever covers rows that did.
 *
 *     node --test server/archiveUpload.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { openArchive } from './archiveDb.mjs';
import { drainArchive, isTransientFailure, uploadDue, uploadIntervalFrom } from './archiveUpload.mjs';

const AT_MS = Date.parse('2026-08-16T09:00:00+08:00');

function tempArchive(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ibems-upload-test-'));
  const archive = openArchive(path.join(dir, 'archive.sqlite'));
  t.after(() => { archive.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return archive;
}

const reading = (i, over = {}) => ({
  device_id: `co${(i % 7) + 1}`, ts: new Date(AT_MS + i * 60_000).toISOString(), voltage: 226, current: 0.01,
  power_w: i, energy_kwh_today: 0.02, online: true, total_energy_kwh: null, warn_power_w: null,
  power_type: null, net_state: null, fault: 0, capabilities: null, ...over,
});

function fill(archive, n, over) {
  for (let i = 0; i < n; i++) archive.insertTick({ readings: [reading(i, over?.(i))] });
}

const refused = (status, message = 'refused') => Object.assign(new Error(`Supabase POST -> ${status}: ${message}`), { status });

/** A send that records every call and answers through `decide(stream, rows)`. */
function recorder(decide = () => {}) {
  const calls = [];
  const send = async (stream, rows, onConflict) => {
    const call = { stream, powers: rows.map((r) => r.power_w), onConflict, failed: false };
    calls.push(call);
    try {
      await decide(stream, rows);
    } catch (err) {
      call.failed = true;
      throw err;
    }
  };
  return { calls, send };
}

test('drains every stream oldest first, then the lag is zero', async (t) => {
  const archive = tempArchive(t);
  fill(archive, 3);
  archive.insertTick({ totals: { ts: new Date(AT_MS).toISOString(), site_id: 's', energy_kwh_today: 1, energy_kwh_week: null, energy_kwh_month: null, energy_kwh_today_integrated: null, energy_kwh_week_integrated: null, energy_kwh_month_integrated: null, total_power_w: 5, avg_voltage: 230, phase_current_red: null, phase_current_yellow: null, phase_current_blue: null } });
  const { calls, send } = recorder();

  const result = await drainArchive({ archive, send });

  assert.equal(result.ok, true);
  assert.deepEqual(result.uploaded, { readings: 3, building_totals: 1, anomalies: 0 });
  assert.deepEqual(calls.map((c) => [c.stream, c.onConflict]), [['readings', 'device_id,ts'], ['building_totals', 'ts']]);
  assert.deepEqual(calls[0].powers, [0, 1, 2]);
  assert.deepEqual(archive.lag(), { readings: 0, building_totals: 0, anomalies: 0 });
});

test('a backlog goes up in batches of the configured size', async (t) => {
  const archive = tempArchive(t);
  fill(archive, 5);
  const { calls, send } = recorder();
  await drainArchive({ archive, send, batchSize: 2 });
  assert.deepEqual(calls.map((c) => c.powers), [[0, 1], [2, 3], [4]]);
});

test('an unreachable database stops the drain and leaves every row pending', async (t) => {
  const archive = tempArchive(t);
  fill(archive, 3);
  const { send } = recorder(() => { throw new TypeError('fetch failed'); });

  const result = await drainArchive({ archive, send });

  assert.equal(result.ok, false);
  assert.match(result.error, /fetch failed/);
  assert.equal(archive.lag().readings, 3);
  assert.deepEqual(archive.rejects(), []);
});

test('a batch that succeeded stays uploaded when a later batch fails', async (t) => {
  const archive = tempArchive(t);
  fill(archive, 4);
  let n = 0;
  const { send } = recorder(() => { if (++n === 2) throw refused(503, 'upstream'); });
  const result = await drainArchive({ archive, send, batchSize: 2 });
  assert.equal(result.ok, false);
  assert.equal(result.uploaded.readings, 2);
  assert.equal(archive.lag().readings, 2);
});

test('one row the database refuses for good is quarantined, and the rows around it still go up', async (t) => {
  // The wedge readingCapabilities.mjs's header describes: one constraint violation used to be
  // replayed at the head of every cycle for ever, holding up every row behind it.
  const archive = tempArchive(t);
  fill(archive, 6);
  const { calls, send } = recorder((stream, rows) => {
    if (rows.some((r) => r.power_w === 3)) throw refused(400, 'violates check constraint');
  });

  const result = await drainArchive({ archive, send });

  assert.equal(result.ok, true);
  assert.equal(result.rejected, 1);
  const uploadedPowers = calls.filter((c) => !c.failed).flatMap((c) => c.powers).sort((a, b) => a - b);
  assert.deepEqual(uploadedPowers, [0, 1, 2, 4, 5]);
  assert.deepEqual(archive.rejects().map((r) => r.stream), ['readings']);
  assert.match(archive.rejects()[0].reason, /check constraint/);
  assert.equal(archive.lag().readings, 0);
});

test('when every row is refused the fault is the table, not a row: nothing is quarantined or skipped', async (t) => {
  // A missing column or table fails every row alike. Bisecting that down to single rows and
  // quarantining them all would throw away a whole outage's data for a deployment mistake.
  const archive = tempArchive(t);
  fill(archive, 4);
  const { send } = recorder(() => { throw refused(400, 'Could not find the table'); });

  const result = await drainArchive({ archive, send });

  assert.equal(result.ok, false);
  assert.match(result.error, /Could not find the table/);
  assert.equal(result.rejected, 0);
  assert.deepEqual(archive.rejects(), []);
  assert.equal(archive.lag().readings, 4);
});

test('an outage in the middle of isolating a bad row quarantines nothing', async (t) => {
  const archive = tempArchive(t);
  fill(archive, 4);
  let call = 0;
  const { send } = recorder(() => {
    call++;
    if (call === 1) throw refused(400, 'violates check constraint');
    throw new TypeError('fetch failed');
  });
  const result = await drainArchive({ archive, send });
  assert.equal(result.ok, false);
  assert.deepEqual(archive.rejects(), []);
  assert.equal(archive.lag().readings, 4);
});

test('the drain stops starting new batches once its time budget is spent', async (t) => {
  // The tick waits for the drain, and a tick that overruns its minute skips the next sample.
  const archive = tempArchive(t);
  fill(archive, 6);
  let clock = 0;
  const { calls, send } = recorder(() => { clock += 10_000; });
  const result = await drainArchive({ archive, send, batchSize: 2, budgetMs: 15_000, now: () => clock });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(archive.lag().readings, 2);
});

test('an upload is due every interval, at once for an anomaly, and not in between', () => {
  // RM-149: every request to the cloud is a line in its log, and the Free plan's log quota is the
  // tight one. The archive holds every minute already, so the cloud can take them five at a time;
  // an anomaly still goes up at once, because the kiosk shows the last fifteen minutes of them.
  const every = 5 * 60_000;
  assert.equal(uploadDue({ nowMs: 1_000_000, lastUploadMs: null, intervalMs: every, hasAnomalies: false }), true, 'the first tick uploads');
  assert.equal(uploadDue({ nowMs: 1_000_000 + 60_000, lastUploadMs: 1_000_000, intervalMs: every, hasAnomalies: false }), false);
  assert.equal(uploadDue({ nowMs: 1_000_000 + 60_000, lastUploadMs: 1_000_000, intervalMs: every, hasAnomalies: true }), true);
  assert.equal(uploadDue({ nowMs: 1_000_000 + every - 2_000, lastUploadMs: 1_000_000, intervalMs: every, hasAnomalies: false }), true,
    'a tick a moment early still counts: ticks are a minute apart, and waiting for the next one would make the interval six');
  assert.equal(uploadDue({ nowMs: 1_000_000 + 60_000, lastUploadMs: 1_000_000, intervalMs: 0, hasAnomalies: false }), true, 'an interval of 0 uploads every tick');
});

test('the upload interval from the environment: 0 is kept, nonsense is not', () => {
  // `Number(x) || default` would turn 0 back into five minutes, and a typo into NaN, which never
  // compares due: the cloud would then hear only about anomalies.
  assert.equal(uploadIntervalFrom(undefined), 5 * 60_000);
  assert.equal(uploadIntervalFrom(''), 5 * 60_000);
  assert.equal(uploadIntervalFrom('0'), 0);
  assert.equal(uploadIntervalFrom('120000'), 120_000);
  assert.equal(uploadIntervalFrom('5min'), 5 * 60_000);
  assert.equal(uploadIntervalFrom('-1'), 5 * 60_000);
});

test('which failures are worth retrying and which are the row', () => {
  assert.equal(isTransientFailure(new TypeError('fetch failed')), true, 'no status: the network');
  assert.equal(isTransientFailure(Object.assign(new Error('aborted'), { name: 'AbortError' })), true);
  for (const status of [408, 425, 429, 500, 502, 503, 504]) assert.equal(isTransientFailure(refused(status)), true, String(status));
  for (const status of [400, 404, 409, 413, 422]) assert.equal(isTransientFailure(refused(status)), false, String(status));
});
