import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { openArchive } from './archiveDb.mjs';

/**
 * `npm run archive:flag-frozen` — RM-163's one-off correction of the outage backlog (E-256): the CT meters'
 * stuck stretches marked frozen before they upload. Every path is redirected under the temp directory: the
 * real archive is the building's only copy of its raw history.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL = join(HERE, 'archive-flag-frozen.mjs');
const T0 = Date.parse('2026-10-08T12:00:00+08:00');

function fixture() {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'ibems-flag-frozen-'));
  const file = join(dir, 'archive.sqlite');
  const archive = openArchive(file);
  const reading = (i, over) => ({ device_id: 'mtr_lo_red', ts: new Date(T0 + i * 60_000).toISOString(), voltage: 228 + (i % 5) / 10,
    current: 0, power_w: 0, energy_kwh_today: 0.001, online: true, total_energy_kwh: 51.2, warn_power_w: null, power_type: null,
    net_state: null, fault: 0, capabilities: { sync_request: 'request' }, ...over });
  // Ten live minutes, then 13 hours of one held reading, then live again.
  for (let i = 0; i < 10; i++) archive.insertTick({ readings: [reading(i)] });
  for (let i = 10; i < 10 + 13 * 60; i++) archive.insertTick({ readings: [reading(i, { voltage: 227.8 })] });
  archive.insertTick({ readings: [reading(10 + 13 * 60, { voltage: 229.1 })] });
  archive.recordSeal({ day: '2026-10-08', stream: 'readings', rows: 1, sha256: 'x', bytes: 1, path: 'p' });
  archive.close();
  return {
    dir, file,
    env: {
      ...process.env,
      ARCHIVE_DB_PATH: file,
      INGEST_PAUSE_PATH: join(dir, 'ingest.pause'),
      ARCHIVE_BACKUP_DIR: join(dir, 'backups'),
      SUPABASE_URL: 'http://127.0.0.1:1',
      SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    },
  };
}

const run = (env, ...args) => spawnSync(process.execPath, [TOOL, '--since=2026-10-08', ...args], { env, encoding: 'utf8' });
const flaggedRows = (file) => {
  const a = openArchive(file, { readOnly: true });
  try {
    return a.pending('readings', 10_000).filter((p) => p.row.capabilities?.measurement_frozen === true).length;
  } finally {
    a.close();
  }
};

test('a dry run names the stretch and writes nothing', (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const r = run(f.env);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /mtr_lo_red\s+2026-10-08 12:10 -> 2026-10-09 01:09\s+13\.0 h, 779 row\(s\)/);
  assert.match(r.stdout, /Dry run/);
  assert.equal(flaggedRows(f.file), 0);
  assert.equal(fs.existsSync(join(f.dir, 'backups')), false);
});

test('--apply refuses unless uploads are paused', (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const r = run(f.env, '--apply');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /not paused/);
  assert.equal(flaggedRows(f.file), 0);
});

test('--apply backs up first, marks the repeats, forgets the touched seals, and a second run marks nothing', (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  fs.writeFileSync(f.env.INGEST_PAUSE_PATH, '');
  const r = run(f.env, '--apply');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /Marked 779 row\(s\) frozen/);
  assert.equal(flaggedRows(f.file), 779);
  const backups = fs.readdirSync(join(f.dir, 'backups'));
  assert.equal(backups.length, 1);
  const copy = openArchive(join(f.dir, 'backups', backups[0]), { readOnly: true });
  try {
    assert.equal(copy.pending('readings', 10_000).filter((p) => p.row.capabilities?.measurement_frozen).length, 0, 'the backup is the archive before the change');
  } finally {
    copy.close();
  }
  const a = openArchive(f.file, { readOnly: true });
  try {
    assert.equal(a.sealOf('2026-10-08', 'readings'), null, 'the day is sealed again by the next pass');
  } finally {
    a.close();
  }
  const again = run(f.env, '--apply');
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /Marked 0 row\(s\) frozen/);
});
