/**
 * Tests for server/archiveSeal.mjs — each UTC day sealed into a file and copied off the edge
 * (RM-148, Stage 4). The janitor prunes a cloud day only when its sealed copy is off the edge, so
 * what is pinned here is that a seal is complete, reproducible, and restorable.
 *
 * A real archive in a temp directory; the file storage is a hand-rolled object with `upload`.
 *
 *     node --test server/archiveSeal.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import { openArchive, ORIGIN } from './archiveDb.mjs';
import {
  utcDay, dayStartMs, storagePathFor, encodeCsv, rowsFromCsv, sealDay, sealPass, sealGate, SEAL_GRACE_MS,
} from './archiveSeal.mjs';

const D1 = Date.parse('2026-08-16T00:00:00Z');
const DAY = 86_400_000;
const MIN = 60_000;

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ibems-seal-test-'));
  const archive = openArchive(path.join(dir, 'archive.sqlite'));
  t.after(() => { archive.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, archive, sealedDir: path.join(dir, 'sealed') };
}

const reading = (ms, over = {}) => ({
  device_id: 'co1', ts: new Date(ms).toISOString(), voltage: 226.6, current: 0.012, power_w: 1.4, energy_kwh_today: 0.021,
  online: true, total_energy_kwh: null, warn_power_w: null, power_type: null, net_state: null, fault: 0,
  capabilities: { switch_1: true, cycle_time: '', note: 'a "quoted", comma\nand newline' }, ...over,
});

function storage({ fail = false } = {}) {
  const objects = new Map();
  return {
    objects,
    upload: async (bucket, p, bytes) => {
      if (fail) throw Object.assign(new Error('Storage POST -> 503: down'), { status: 503 });
      objects.set(`${bucket}/${p}`, Buffer.from(bytes));
    },
  };
}

test('a UTC day, its start, and where its file lives off the edge', () => {
  assert.equal(utcDay(D1 + 5 * 3_600_000), '2026-08-16');
  assert.equal(dayStartMs('2026-08-16'), D1);
  assert.equal(storagePathFor({ siteId: 'site-a', day: '2026-08-16', stream: 'readings' }), 'site-a/raw/2026/08/2026-08-16.readings.csv.gz');
});

test('CSV keeps every value exactly: nulls, empty strings, quotes, commas, newlines, numbers and flags', () => {
  const rows = [
    { ...reading(D1), origin: ORIGIN.ingest },
    { ...reading(D1 + MIN, { device_id: 'l1', voltage: null, online: false, power_type: '', capabilities: null, fault: null }), origin: ORIGIN.cloud },
  ];
  const back = rowsFromCsv('readings', encodeCsv('readings', rows));
  assert.deepEqual(back, rows);
});

test('a sealed day holds every row of that UTC day, whatever its origin, and is the same file twice', (t) => {
  const { archive } = temp(t);
  archive.insertTick({ readings: [reading(D1 + MIN), reading(D1 - MIN)] });
  archive.insertTick({ readings: [reading(D1 + 2 * MIN, { device_id: 'co2' })] }, { origin: ORIGIN.cloud });
  const a = sealDay({ archive, stream: 'readings', day: '2026-08-16' });
  const b = sealDay({ archive, stream: 'readings', day: '2026-08-16' });
  assert.equal(a.rows, 2);
  assert.equal(a.sha256, b.sha256);
  assert.equal(zlib.gunzipSync(a.gz).toString('utf8'), a.csv);
  assert.equal(rowsFromCsv('readings', a.csv).length, 2);
});

test('a pass seals complete days only, copies them off the edge, and records both', async (t) => {
  const { archive, sealedDir } = temp(t);
  archive.insertTick({ readings: [reading(D1 + MIN)] });
  archive.insertTick({ readings: [reading(D1 + DAY + MIN)] });
  const store = storage();
  const nowMs = D1 + 2 * DAY - 1; // day 2 is not over yet

  const result = await sealPass({ archive, storage: store, bucket: 'ibems-archive', siteId: 'site-a', dir: sealedDir, nowMs });

  assert.deepEqual(result.sealed, ['2026-08-16 readings']);
  assert.deepEqual(result.uploaded, ['2026-08-16 readings']);
  assert.ok(fs.existsSync(path.join(sealedDir, '2026', '08', '2026-08-16.readings.csv.gz')));
  assert.ok(store.objects.has('ibems-archive/site-a/raw/2026/08/2026-08-16.readings.csv.gz'));
  assert.ok(archive.sealOf('2026-08-16', 'readings').uploaded_at > 0);
  assert.equal(archive.sealOf('2026-08-17', 'readings'), null);
});

test('a day is not sealed until an hour after it ends, so late rows are not left out', async (t) => {
  const { archive, sealedDir } = temp(t);
  archive.insertTick({ readings: [reading(D1 + MIN)] });
  const early = await sealPass({ archive, storage: storage(), bucket: 'b', siteId: 's', dir: sealedDir, nowMs: D1 + DAY + SEAL_GRACE_MS - 1 });
  assert.deepEqual(early.sealed, []);
  const due = await sealPass({ archive, storage: storage(), bucket: 'b', siteId: 's', dir: sealedDir, nowMs: D1 + DAY + SEAL_GRACE_MS });
  assert.deepEqual(due.sealed, ['2026-08-16 readings']);
});

test('a day that gains rows after it was sealed is sealed and copied again', async (t) => {
  const { archive, sealedDir } = temp(t);
  archive.insertTick({ readings: [reading(D1 + MIN)] });
  const store = storage();
  const nowMs = D1 + 3 * DAY;
  await sealPass({ archive, storage: store, bucket: 'b', siteId: 's', dir: sealedDir, nowMs });
  archive.insertRows('readings', [reading(D1 + 2 * MIN, { device_id: 'co2' })], { origin: ORIGIN.cloud });
  const again = await sealPass({ archive, storage: store, bucket: 'b', siteId: 's', dir: sealedDir, nowMs });
  assert.deepEqual(again.sealed, ['2026-08-16 readings']);
  assert.equal(archive.sealOf('2026-08-16', 'readings').rows, 2);
  assert.equal(rowsFromCsv('readings', zlib.gunzipSync(store.objects.get('b/s/raw/2026/08/2026-08-16.readings.csv.gz')).toString()).length, 2);
});

test('when the copy fails the seal stays, unuploaded, and the next pass copies it', async (t) => {
  const { archive, sealedDir } = temp(t);
  archive.insertTick({ readings: [reading(D1 + MIN)] });
  const nowMs = D1 + 3 * DAY;
  const failed = await sealPass({ archive, storage: storage({ fail: true }), bucket: 'b', siteId: 's', dir: sealedDir, nowMs });
  assert.deepEqual(failed.uploaded, []);
  assert.match(failed.errors.join(' '), /503/);
  assert.equal(archive.sealOf('2026-08-16', 'readings').uploaded_at, null);
  const retried = await sealPass({ archive, storage: storage(), bucket: 'b', siteId: 's', dir: sealedDir, nowMs });
  assert.deepEqual(retried.sealed, []);
  assert.deepEqual(retried.uploaded, ['2026-08-16 readings']);
});

test('with no file storage configured the day is sealed on the edge and the pass says it was not copied', async (t) => {
  const { archive, sealedDir } = temp(t);
  archive.insertTick({ readings: [reading(D1 + MIN)] });
  const result = await sealPass({ archive, storage: null, bucket: 'b', siteId: 's', dir: sealedDir, nowMs: D1 + 3 * DAY });
  assert.deepEqual(result.sealed, ['2026-08-16 readings']);
  assert.deepEqual(result.uploaded, []);
  assert.match(result.errors.join(' '), /no file storage/);
});

test('a pass seals at most a few days, oldest first, so a first run cannot hold up a tick', async (t) => {
  const { archive, sealedDir } = temp(t);
  for (let d = 0; d < 5; d++) archive.insertTick({ readings: [reading(D1 + d * DAY + MIN)] });
  const result = await sealPass({ archive, storage: storage(), bucket: 'b', siteId: 's', dir: sealedDir, nowMs: D1 + 10 * DAY, maxDays: 2 });
  assert.deepEqual(result.sealed, ['2026-08-16 readings', '2026-08-17 readings']);
});

test('the gate opens only when every day in the range is sealed, current and off the edge', async (t) => {
  const { archive, sealedDir } = temp(t);
  archive.insertTick({ readings: [reading(D1 + MIN)] });
  archive.insertTick({ readings: [reading(D1 + DAY + MIN)] });
  const gate = sealGate({ archive });
  assert.equal(gate('readings', D1, D1 + 2 * DAY).sealed, false);

  // Sealed on the edge but not copied off it: the card is still the only copy, so no.
  await sealPass({ archive, storage: storage({ fail: true }), bucket: 'b', siteId: 's', dir: sealedDir, nowMs: D1 + 3 * DAY });
  const unsent = gate('readings', D1, D1 + DAY);
  assert.equal(unsent.sealed, false);
  assert.match(unsent.reason, /not yet copied off the edge/);

  const store = storage();
  await sealPass({ archive, storage: store, bucket: 'b', siteId: 's', dir: sealedDir, nowMs: D1 + 3 * DAY });
  assert.deepEqual(gate('readings', D1 + MIN, D1 + DAY + 3_600_000), { sealed: true, reason: null });

  archive.insertRows('readings', [reading(D1 + 5 * MIN, { device_id: 'co3' })], { origin: ORIGIN.cloud });
  const stale = gate('readings', D1, D1 + DAY);
  assert.equal(stale.sealed, false);
  assert.match(stale.reason, /2026-08-16.*changed/);
});

test('a sealed day restores into an empty archive and seals to the same file again', async (t) => {
  // The restore drill in miniature: what goes off the edge is enough to rebuild the day exactly.
  const { archive } = temp(t);
  archive.insertTick({ readings: [reading(D1 + MIN), reading(D1 + MIN, { device_id: 'co2' })] });
  archive.insertTick({ readings: [reading(D1 + 2 * MIN)] }, { origin: ORIGIN.cloud });
  const original = sealDay({ archive, stream: 'readings', day: '2026-08-16' });

  const other = temp(t).archive;
  const rows = rowsFromCsv('readings', zlib.gunzipSync(original.gz).toString('utf8'));
  for (const origin of new Set(rows.map((r) => r.origin))) {
    other.insertRows('readings', rows.filter((r) => r.origin === origin).map(({ origin: _o, ...r }) => r), { origin });
  }
  assert.equal(sealDay({ archive: other, stream: 'readings', day: '2026-08-16' }).sha256, original.sha256);
});
