/**
 * Tests for server/archiveDrill.mjs — restoring a sealed day from the off-edge copy, and the drill
 * the weekly backup runs on one (RM-148/RM-149). A real archive in a temp directory, real sealed
 * files, and a bucket that is a Map.
 *
 *     node --test server/archiveDrill.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { openArchive } from './archiveDb.mjs';
import { sealDay, storagePathFor } from './archiveSeal.mjs';
import { drillDay } from './archiveDrill.mjs';

const DAY = '2026-08-16';
const D1 = Date.parse(`${DAY}T00:00:00Z`);
const SITE = 'site-a';
const BUCKET = 'ibems-archive';

const reading = (ms, over = {}) => ({
  device_id: 'co1', ts: new Date(ms).toISOString(), voltage: 226.6, current: 0.012, power_w: 1.4, energy_kwh_today: 0.021,
  online: true, total_energy_kwh: null, warn_power_w: null, power_type: null, net_state: null, fault: 0,
  capabilities: { switch_1: true }, ...over,
});

/** A live archive holding one day of readings, sealed and recorded as uploaded, and the bucket holding it. */
function sealedDay(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ibems-drill-test-'));
  const live = openArchive(path.join(dir, 'archive.sqlite'));
  t.after(() => { live.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); });
  for (let m = 0; m < 5; m++) live.insertTick({ readings: [reading(D1 + m * 60_000), reading(D1 + m * 60_000, { device_id: 'l1' })] });
  const seal = sealDay({ archive: live, stream: 'readings', day: DAY });
  const where = storagePathFor({ siteId: SITE, day: DAY, stream: 'readings' });
  live.recordSeal({ day: DAY, stream: 'readings', rows: seal.rows, sha256: seal.sha256, bytes: seal.gz.length, path: 'x' });
  live.markUploaded(DAY, 'readings', where);
  const objects = new Map([[`${BUCKET}/${where}`, seal.gz]]);
  const storage = {
    objects,
    async download(b, p) {
      if (!objects.has(`${b}/${p}`)) throw Object.assign(new Error('Storage GET -> 400: Object not found'), { status: 400 });
      return objects.get(`${b}/${p}`);
    },
  };
  return { live, storage, where, seal };
}

test('a sealed day comes back exactly as it was sealed', async (t) => {
  const { live, storage, seal } = sealedDay(t);
  const r = await drillDay({ storage, bucket: BUCKET, siteId: SITE, day: DAY, liveArchive: live });
  assert.equal(r.ok, true);
  const readings = r.streams.find((s) => s.stream === 'readings');
  assert.equal(readings.rows, 10);
  assert.equal(readings.sha256, seal.sha256);
  assert.equal(readings.resealed, seal.sha256);
  assert.equal(readings.recorded, seal.sha256);
});

test('a copy that differs from the recorded seal fails the drill', async (t) => {
  const { live, storage, where } = sealedDay(t);
  // Another day's content under this day's name: it restores and re-seals cleanly, and is still wrong.
  const other = openArchive(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ibems-drill-other-')), 'a.sqlite'));
  other.insertTick({ readings: [reading(D1 + 3_600_000, { power_w: 99 })] });
  storage.objects.set(`${BUCKET}/${where}`, sealDay({ archive: other, stream: 'readings', day: DAY }).gz);
  other.close();
  const r = await drillDay({ storage, bucket: BUCKET, siteId: SITE, day: DAY, liveArchive: live });
  assert.equal(r.ok, false);
});

test('a stream recorded as uploaded but missing from the bucket fails the drill', async (t) => {
  const { live, storage, where } = sealedDay(t);
  storage.objects.delete(`${BUCKET}/${where}`);
  const r = await drillDay({ storage, bucket: BUCKET, siteId: SITE, day: DAY, liveArchive: live });
  assert.equal(r.ok, false);
  assert.equal(r.streams.find((s) => s.stream === 'readings').ok, false);
});

test('streams never sealed are not failures, but a day with nothing at all is not a pass', async (t) => {
  const { live, storage } = sealedDay(t);
  const r = await drillDay({ storage, bucket: BUCKET, siteId: SITE, day: DAY, liveArchive: live });
  assert.ok(r.streams.some((s) => s.missing && s.ok), 'the totals and anomalies streams were never sealed here');
  const empty = await drillDay({ storage, bucket: BUCKET, siteId: SITE, day: '2026-08-20', liveArchive: live });
  assert.equal(empty.ok, false);
});
