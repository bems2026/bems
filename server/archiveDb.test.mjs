/**
 * Tests for server/archiveDb.mjs — the Pi's permanent raw archive (RM-148).
 *
 * Every test opens a REAL SQLite file in a fresh temp directory, never `server/data/`: that
 * directory holds the live archive on the Pi, and a test run there must not be able to write
 * into it (server/testStatePaths.test.mjs guards the same boundary for the other state files).
 *
 *     node --test server/archiveDb.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { openArchive, ARCHIVE_SCHEMA_VERSION, ORIGIN } from './archiveDb.mjs';
import { splitLatestPayload, shapeAnomalyRows } from './shapeRows.mjs';

const AT = '2026-08-16T09:00:00+08:00';
const AT_MS = Date.parse(AT);

function tempArchive(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ibems-archive-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'nested', 'archive.sqlite');
  return { dir, file, archive: openArchive(file) };
}

const reading = (over = {}) => ({
  device_id: 'co1', ts: AT, voltage: 226.6, current: 0.012, power_w: 1.4, energy_kwh_today: 0.021, online: true,
  total_energy_kwh: null, warn_power_w: null, power_type: null, net_state: null, fault: 0,
  capabilities: { switch_1: true, cycle_time: '', relay_status: 'memory' },
  ...over,
});

const totals = (over = {}) => ({
  ts: AT, site_id: 'test-site', energy_kwh_today: 12.41, energy_kwh_week: 61.88, energy_kwh_month: 204.3,
  energy_kwh_today_integrated: null, energy_kwh_week_integrated: null, energy_kwh_month_integrated: null,
  total_power_w: 2951, avg_voltage: 223.1, phase_current_red: 6.1, phase_current_yellow: 4.9, phase_current_blue: null,
  ...over,
});

test('opening creates the file, its directory and the current schema, in WAL mode', (t) => {
  const { file, archive } = tempArchive(t);
  assert.ok(fs.existsSync(file));
  assert.equal(archive.schemaVersion(), ARCHIVE_SCHEMA_VERSION);
  assert.equal(archive.journalMode(), 'wal');
  archive.close();
});

test('reopening an existing archive keeps its rows and does not re-run the migration', (t) => {
  const { file, archive } = tempArchive(t);
  archive.insertTick({ readings: [reading()] });
  archive.close();
  const again = openArchive(file);
  assert.equal(again.stats().readings, 1);
  again.close();
});

test('a tick is stored and comes back as the same cloud rows, oldest first', (t) => {
  const { archive } = tempArchive(t);
  const later = new Date(AT_MS + 60_000).toISOString();
  const counts = archive.insertTick({
    readings: [reading(), reading({ device_id: 'l1', ts: later, voltage: null, current: null, power_w: null, energy_kwh_today: null, fault: null, capabilities: null })],
    totals: totals(),
  });
  assert.deepEqual(counts, { readings: 2, building_totals: 1, anomalies: 0 });

  const pending = archive.pending('readings', 10);
  assert.equal(pending.length, 2);
  const [first, second] = pending.map((p) => p.row);
  assert.equal(Date.parse(first.ts), AT_MS, 'the instant survives, whatever the offset it was written with');
  assert.deepEqual({ ...first, ts: AT }, reading());
  assert.equal(second.device_id, 'l1');
  assert.equal(second.online, true);
  assert.equal(second.capabilities, null);
  assert.ok(pending[0].id < pending[1].id);

  const [bt] = archive.pending('building_totals', 10).map((p) => p.row);
  assert.deepEqual({ ...bt, ts: AT }, totals());
  archive.close();
});

test('a row the bridge sends twice for the same minute is kept once', (t) => {
  const { archive } = tempArchive(t);
  archive.insertTick({ readings: [reading()] });
  const counts = archive.insertTick({ readings: [reading({ power_w: 99 })] });
  assert.equal(counts.readings, 0);
  assert.equal(archive.stats().readings, 1);
  assert.equal(archive.pending('readings', 10)[0].row.power_w, 1.4);
  archive.close();
});

test('a capability set repeated every minute is stored once', (t) => {
  const { archive } = tempArchive(t);
  for (let i = 0; i < 5; i++) {
    archive.insertTick({ readings: [reading({ ts: new Date(AT_MS + i * 60_000).toISOString() })] });
  }
  archive.insertTick({ readings: [reading({ ts: new Date(AT_MS + 6 * 60_000).toISOString(), capabilities: { switch_1: false } })] });
  assert.equal(archive.stats().readings, 6);
  assert.equal(archive.stats().capability_sets, 2);
  archive.close();
});

test('the whole tick is refused, and nothing kept, when one row carries a field the archive cannot hold', (t) => {
  // A column added to shapeRows but not to the archive would otherwise vanish from BOTH copies,
  // because the cloud row is rebuilt from the archive. Refusing sends the tick down the direct path.
  const { archive } = tempArchive(t);
  assert.throws(
    () => archive.insertTick({ readings: [reading(), reading({ device_id: 'co2', brand_new_column: 1 })], totals: totals() }),
    /brand_new_column/,
  );
  assert.deepEqual(archive.stats().readings, 0);
  assert.deepEqual(archive.stats().building_totals, 0);
  archive.close();
});

test('advancing the cursor removes rows from pending and from the lag', (t) => {
  const { archive } = tempArchive(t);
  archive.insertTick({ readings: [reading(), reading({ device_id: 'co2' }), reading({ device_id: 'co3' })] });
  assert.equal(archive.lag().readings, 3);
  const [a, b] = archive.pending('readings', 2);
  archive.advance('readings', b.id);
  assert.equal(archive.lag().readings, 1);
  assert.deepEqual(archive.pending('readings', 10).map((p) => p.row.device_id), ['co3']);
  assert.ok(a.id < b.id);
  archive.close();
});

test('the cursor never moves backwards', (t) => {
  const { archive } = tempArchive(t);
  archive.insertTick({ readings: [reading(), reading({ device_id: 'co2' })] });
  const [, b] = archive.pending('readings', 10);
  archive.advance('readings', b.id);
  archive.advance('readings', 0);
  assert.equal(archive.lag().readings, 0);
  archive.close();
});

test('rows copied from the cloud or imported from old files are kept but never uploaded', (t) => {
  const { archive } = tempArchive(t);
  archive.insertTick({ readings: [reading({ device_id: 'co2' })] }, { origin: ORIGIN.cloud });
  archive.insertTick({ readings: [reading({ device_id: 'co3' })] }, { origin: ORIGIN.import });
  archive.insertTick({ readings: [reading({ device_id: 'co4' })] }, { origin: ORIGIN.buffer });
  archive.insertTick({ readings: [reading({ device_id: 'co5' })] });
  assert.equal(archive.stats().readings, 4);
  assert.deepEqual(archive.pending('readings', 10).map((p) => p.row.device_id), ['co4', 'co5']);
  assert.equal(archive.lag().readings, 2);
  archive.close();
});

test('the old NDJSON outage buffer is taken in as rows still owed to the cloud', (t) => {
  // Entries are `{ table, rows, onConflict }`, as server/ingestBuffer.mjs wrote them. Rows the
  // old buffer was holding had never reached the cloud, so they must be uploaded, oldest first.
  const { archive } = tempArchive(t);
  const n = archive.importBufferEntries([
    { table: 'readings', rows: [reading(), reading({ device_id: 'co2' })], onConflict: 'device_id,ts' },
    { table: 'building_totals', rows: [totals()], onConflict: 'ts' },
    { table: 'devices', rows: [{ id: 'co1' }], onConflict: 'id' },
  ]);
  assert.deepEqual(n, { readings: 2, building_totals: 1, anomalies: 0, skipped: 1 });
  assert.deepEqual(archive.lag(), { readings: 2, building_totals: 1, anomalies: 0 });
  archive.close();
});

test('a quarantined row is recorded with its reason', (t) => {
  const { archive } = tempArchive(t);
  archive.insertTick({ readings: [reading()] });
  const [p] = archive.pending('readings', 10);
  archive.reject('readings', p.id, 'Supabase POST -> 400: violates check constraint');
  assert.deepEqual(archive.rejects().map((r) => [r.stream, r.row_id]), [['readings', p.id]]);
  archive.close();
});

test('anomalies round-trip and are keyed by device, minute and metric', (t) => {
  const { archive } = tempArchive(t);
  const [row] = shapeAnomalyRows([{ deviceId: 'co7', ts: AT, value: 63.8, detection: { baselineMean: 28.1, baselineStddev: 8.7, zScore: 4.06, iqrLower: 12.8, iqrUpper: 47.8, method: 'both', sampleCount: 12 } }]);
  archive.insertTick({ anomalies: [row, row] });
  const pending = archive.pending('anomalies', 10);
  assert.equal(pending.length, 1);
  assert.deepEqual({ ...pending[0].row, ts: AT }, row);
  archive.close();
});

test('everything splitLatestPayload produces can be archived and comes back unchanged', (t) => {
  // The drift guard: the day a new column is added to the ingest shape, this fails here, in a
  // test, rather than as a refused tick on the Pi.
  const { archive } = tempArchive(t);
  const latest = [
    { device_id: 'mtr_lo_yellow', ts: AT, voltage: 226, current: 0.1, power_w: 12.3, energy_kwh_today: 0.2, online: true,
      capabilities: { add_ele2: 0.01, cur_power2: 0, device_state2: 'monitor', all_energy: 286348.554 },
      channel_map: { rule: 'idle', assignment: 'direct' }, measurement_frozen: true, frozen_since: AT },
    { device_id: 'co1', ts: AT, voltage: 226.6, current: 0.01, power_w: 1.1, energy_kwh_today: 0.02, online: true },
    { device_id: '_totals', ts: AT, total_power_w: 746.5, avg_voltage: 233, phase_current: { red: 1, yellow: 2, blue: null } },
  ];
  const { readings, totals: tot } = splitLatestPayload(latest, AT_MS + 1000);
  archive.insertTick({ readings, totals: tot });
  const back = archive.pending('readings', 10).map((p) => ({ ...p.row, ts: AT }));
  assert.deepEqual(back, readings.map((r) => ({ ...r, ts: AT })));
  const [bt] = archive.pending('building_totals', 10).map((p) => ({ ...p.row, ts: AT }));
  assert.deepEqual(bt, { ...tot, ts: AT });
  archive.close();
});

test('a read-only handle can read but cannot write', (t) => {
  const { file, archive } = tempArchive(t);
  archive.insertTick({ readings: [reading()] });
  const ro = openArchive(file, { readOnly: true });
  assert.equal(ro.stats().readings, 1);
  assert.throws(() => ro.insertTick({ readings: [reading({ device_id: 'co2' })] }), /readonly|read-only/i);
  ro.close();
  archive.close();
});

test('stats report the file size and the time span held', (t) => {
  const { archive } = tempArchive(t);
  archive.insertTick({ readings: [reading(), reading({ ts: new Date(AT_MS + 3_600_000).toISOString() })] });
  const s = archive.stats();
  assert.ok(s.bytes > 0);
  assert.equal(Date.parse(s.oldest), AT_MS);
  assert.equal(Date.parse(s.newest), AT_MS + 3_600_000);
  archive.close();
});
