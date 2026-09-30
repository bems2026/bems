/**
 * Tests for server/backupCycle.mjs — the weekly backup of the database into the project's file
 * storage, and the restore drill that runs with it (RM-149).
 *
 * A temp directory is the edge's disk; the bucket is a hand-rolled Map that answers `upload`,
 * `download`, `list` and `remove` the way Storage does.
 *
 *     node --test server/backupCycle.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import { runBackupCycle, foldersToDrop, pickDrillDay, backupFolder } from './backupCycle.mjs';

const NOW = Date.parse('2026-10-04T19:30:00Z');
const TODAY = '2026-10-04';
const SITE = 'site-a';
const BUCKET = 'ibems-archive';
const TABLES = [
  { table: 'sites', order: 'id' },
  { table: 'commands', order: 'requested_at,id' },
  { table: 'readings_hourly', order: 'hour,device_id' },
];
const ROWS = {
  sites: [{ id: SITE, name: 'A "quoted" site' }],
  commands: [{ id: 'c1', device_id: 'l1', action: 'on' }, { id: 'c2', device_id: 'l1', action: 'off' }],
  readings_hourly: [],
};

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ibems-backup-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  return dir;
}

/** A bucket as Storage presents it: flat object keys, listed one folder level at a time. */
function bucket() {
  const objects = new Map();
  const uploads = [];
  const key = (b, p) => `${b}/${p}`;
  return {
    objects,
    uploads,
    async upload(b, p, bytes, contentType) {
      uploads.push({ path: p, contentType });
      objects.set(key(b, p), Buffer.from(bytes));
    },
    async download(b, p) {
      if (!objects.has(key(b, p))) throw Object.assign(new Error('Storage GET -> 400: Object not found'), { status: 400 });
      return objects.get(key(b, p));
    },
    async list(b, prefix) {
      const base = `${key(b, prefix)}/`;
      const seen = new Map();
      for (const [k, v] of objects) {
        if (!k.startsWith(base)) continue;
        const rest = k.slice(base.length).split('/');
        if (rest.length > 1) seen.set(rest[0], { name: rest[0], id: null });
        else seen.set(rest[0], { name: rest[0], id: 'obj', metadata: { size: v.length } });
      }
      return [...seen.values()].sort((a, c) => a.name.localeCompare(c.name));
    },
    async remove(b, paths) {
      for (const p of paths) objects.delete(key(b, p));
      return paths.map((name) => ({ name }));
    },
  };
}

const exportTable = async (table) => ROWS[table];

function run(t, over = {}) {
  const localDir = over.localDir ?? tempDir(t);
  const storage = over.storage ?? bucket();
  return {
    localDir,
    storage,
    result: runBackupCycle({
      exportTable, tables: TABLES, storage, bucket: BUCKET, siteId: SITE, localDir, nowMs: NOW, ...over,
    }),
  };
}

test('every table goes up gzipped, the manifest last, and every copy is read back and checked', async (t) => {
  const { storage, localDir, result } = run(t);
  const r = await result;
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.equal(r.day, TODAY);
  assert.equal(r.verified, TABLES.length);
  const folder = backupFolder(SITE, TODAY);
  for (const { table } of TABLES) {
    const gz = storage.objects.get(`${BUCKET}/${folder}/${table}.ndjson.gz`);
    assert.ok(gz, `${table} is in the bucket`);
    const lines = zlib.gunzipSync(gz).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.deepEqual(lines, ROWS[table]);
    assert.ok(fs.existsSync(path.join(localDir, TODAY, `${table}.ndjson.gz`)), `${table} is kept on the edge too`);
  }
  assert.equal(storage.uploads.at(-1).path, `${folder}/manifest.json`, 'the manifest goes last: its presence means complete');
  assert.equal(storage.uploads.at(-1).contentType, 'application/json');
  const manifest = JSON.parse(storage.objects.get(`${BUCKET}/${folder}/manifest.json`).toString('utf8'));
  assert.equal(manifest.tables.commands.rows, 2);
  assert.match(manifest.tables.commands.sha256, /^[0-9a-f]{64}$/);
  assert.equal(manifest.tables.readings_hourly.rows, 0);
});

/** Ten weekly backups already in the bucket, and a sealed day beside them. */
function seeded() {
  const storage = bucket();
  for (let w = 1; w <= 10; w++) {
    const day = new Date(NOW - w * 7 * 86_400_000).toISOString().slice(0, 10);
    storage.objects.set(`${BUCKET}/${backupFolder(SITE, day)}/sites.ndjson.gz`, zlib.gzipSync(''));
    storage.objects.set(`${BUCKET}/${backupFolder(SITE, day)}/manifest.json`, Buffer.from('{}'));
  }
  storage.objects.set(`${BUCKET}/${SITE}/backup/notes/readme.txt`, Buffer.from('not a backup'));
  storage.objects.set(`${BUCKET}/${SITE}/raw/2026/08/2026-08-16.readings.csv.gz`, Buffer.from('sealed'));
  return storage;
}
const datedFolders = async (storage) => (await storage.list(BUCKET, `${SITE}/backup`)).map((e) => e.name).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n));

test('after a complete backup the bucket keeps the newest eight and the edge the newest four', async (t) => {
  const storage = seeded();
  const localDir = tempDir(t);
  for (let w = 1; w <= 6; w++) fs.mkdirSync(path.join(localDir, new Date(NOW - w * 7 * 86_400_000).toISOString().slice(0, 10)));
  fs.mkdirSync(path.join(localDir, 'keep-me'));

  const r = await run(t, { storage, localDir }).result;

  assert.equal(r.ok, true, r.errors.join('; '));
  const kept = await datedFolders(storage);
  assert.equal(kept.length, 8);
  assert.equal(kept.at(-1), TODAY);
  assert.equal(r.dropped.length, 3);
  assert.ok(storage.objects.has(`${BUCKET}/${SITE}/raw/2026/08/2026-08-16.readings.csv.gz`), 'a sealed day is never touched');
  assert.ok(storage.objects.has(`${BUCKET}/${SITE}/backup/notes/readme.txt`), 'only dated folders rotate');
  const local = fs.readdirSync(localDir).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort();
  assert.equal(local.length, 4);
  assert.equal(local.at(-1), TODAY);
  assert.ok(fs.existsSync(path.join(localDir, 'keep-me')));
});

test('a table that cannot be read makes the backup incomplete, and nothing older is removed', async (t) => {
  const storage = seeded();
  const r = await run(t, {
    storage,
    exportTable: async (table) => { if (table === 'commands') throw new Error('GET commands -> 500: boom'); return ROWS[table]; },
  }).result;
  assert.equal(r.ok, false);
  assert.match(r.errors.join('; '), /commands.*boom/);
  const manifest = JSON.parse(storage.objects.get(`${BUCKET}/${backupFolder(SITE, TODAY)}/manifest.json`).toString('utf8'));
  assert.match(manifest.tables.commands.error, /boom/, 'the manifest says what is missing');
  assert.equal((await datedFolders(storage)).length, 11, 'every older backup stays');
  assert.deepEqual(r.dropped, []);
});

test('a copy that does not read back as written fails the backup, and nothing older is removed', async (t) => {
  const storage = seeded();
  const download = storage.download;
  storage.download = async (b, p) => (p.endsWith('commands.ndjson.gz') ? zlib.gzipSync('{"not":"what was sent"}\n') : download(b, p));
  const r = await run(t, { storage }).result;
  assert.equal(r.ok, false);
  assert.equal(r.verified, TABLES.length - 1);
  assert.match(r.errors.join('; '), /commands.*does not match/);
  assert.equal((await datedFolders(storage)).length, 11);
});

test('the restore drill runs with the backup, and a failed drill fails the cycle', async (t) => {
  const passed = await run(t, { drill: async () => ({ day: '2026-09-01', ok: true, streams: [] }) }).result;
  assert.equal(passed.ok, true);
  assert.equal(passed.drill.day, '2026-09-01');

  const failed = await run(t, { drill: async () => ({ day: '2026-09-01', ok: false, streams: [{ stream: 'readings', ok: false }] }) }).result;
  assert.equal(failed.ok, false);
  assert.match(failed.errors.join('; '), /restore drill.*2026-09-01/);

  const thrown = await run(t, { drill: async () => { throw new Error('Storage GET -> 503'); } }).result;
  assert.equal(thrown.ok, false);
  assert.match(thrown.errors.join('; '), /restore drill.*503/);
});

test('rotation keeps the newest dated folders and ignores anything else', () => {
  assert.deepEqual(foldersToDrop(['2026-08-01', 'notes', '2026-09-01', '2026-07-01', '2026-10-01'], 2), ['2026-08-01', '2026-07-01']);
  assert.deepEqual(foldersToDrop(['2026-08-01'], 8), []);
  assert.deepEqual(foldersToDrop(['2026-08-01', '2026-09-01'], 0), ['2026-08-01'], 'keeping none is refused: the newest always stays');
});

test('the drill picks a day that was sealed and copied off the edge, never one only sealed', () => {
  const seals = [
    { day: '2026-08-16', stream: 'readings', uploaded_at: 1 },
    { day: '2026-08-17', stream: 'readings', uploaded_at: null },
    { day: '2026-08-18', stream: 'readings', uploaded_at: 2 },
  ];
  assert.equal(pickDrillDay(seals, () => 0), '2026-08-16');
  assert.equal(pickDrillDay(seals, () => 0.99), '2026-08-18');
  assert.equal(pickDrillDay([{ day: '2026-08-17', uploaded_at: null }], () => 0), null);
});
