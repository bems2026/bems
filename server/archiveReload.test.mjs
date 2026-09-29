/**
 * Tests for server/archiveReload.mjs — refilling the cloud's hot window from the archive, the last
 * step of RM-148's one-time reset (pause, TRUNCATE, reload, resume).
 *
 *     node --test server/archiveReload.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { openArchive, ORIGIN } from './archiveDb.mjs';
import { reloadWindow } from './archiveReload.mjs';

const T0 = Date.parse('2026-09-20T00:00:00Z');
const MIN = 60_000;

function tempArchive(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ibems-reload-test-'));
  const archive = openArchive(path.join(dir, 'archive.sqlite'));
  t.after(() => { archive.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return archive;
}

const reading = (ms, device = 'l1') => ({
  device_id: device, ts: new Date(ms).toISOString(), voltage: null, current: null, power_w: null, energy_kwh_today: null,
  online: true, total_energy_kwh: null, warn_power_w: null, power_type: null, net_state: null, fault: null,
  capabilities: { switch_1: true, cycle_time: '', relay_status: 'off' },
});

test('every row in the window goes back up, whatever its origin, oldest first, in batches, as the cloud stores it', async (t) => {
  const archive = tempArchive(t);
  archive.insertRows('readings', [reading(T0 - MIN)], { origin: ORIGIN.cloud }); // before the window
  archive.insertRows('readings', [reading(T0), reading(T0 + MIN)], { origin: ORIGIN.cloud });
  archive.insertTick({ readings: [reading(T0 + 2 * MIN)] });
  const sent = [];
  const send = async (stream, rows, onConflict) => { sent.push({ stream, rows, onConflict }); };

  const result = await reloadWindow({ archive, send, stream: 'readings', sinceMs: T0, untilMs: T0 + 10 * MIN, batchSize: 2 });

  assert.deepEqual(result, { sent: 3, batches: 2 });
  assert.deepEqual(sent.map((b) => b.rows.map((r) => Date.parse(r.ts) - T0)), [[0, MIN], [2 * MIN]]);
  assert.equal(sent[0].onConflict, 'device_id,ts');
  assert.equal('origin' in sent[0].rows[0], false, 'origin is the archive\'s own column, not the cloud\'s');
  assert.deepEqual(sent[0].rows[0].capabilities, { switch_1: true }, 'reloaded rows are slimmed like live ones');
});

test('a failed batch stops the reload with the error, and running it again is safe', async (t) => {
  const archive = tempArchive(t);
  archive.insertRows('readings', [reading(T0), reading(T0 + MIN)], { origin: ORIGIN.cloud });
  let calls = 0;
  const send = async () => { if (++calls === 2) throw new Error('fetch failed'); };
  await assert.rejects(reloadWindow({ archive, send, stream: 'readings', sinceMs: T0, untilMs: T0 + 10 * MIN, batchSize: 1 }), /fetch failed/);
  const again = await reloadWindow({ archive, send: async () => {}, stream: 'readings', sinceMs: T0, untilMs: T0 + 10 * MIN, batchSize: 1 });
  assert.equal(again.sent, 2);
});

test('building totals reload without slimming, keyed on ts', async (t) => {
  const archive = tempArchive(t);
  archive.insertRows('building_totals', [{
    ts: new Date(T0).toISOString(), site_id: 's', energy_kwh_today: 1, energy_kwh_week: null, energy_kwh_month: null,
    energy_kwh_today_integrated: null, energy_kwh_week_integrated: null, energy_kwh_month_integrated: null,
    total_power_w: 10, avg_voltage: 230, phase_current_red: null, phase_current_yellow: null, phase_current_blue: null,
  }], { origin: ORIGIN.cloud });
  const sent = [];
  await reloadWindow({ archive, send: async (s, rows, c) => sent.push({ s, rows, c }), stream: 'building_totals', sinceMs: T0, untilMs: T0 + MIN });
  assert.equal(sent[0].c, 'ts');
  assert.equal(sent[0].rows[0].total_power_w, 10);
});
