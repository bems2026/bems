/**
 * The weekly backup of the database into the project's file storage — RM-149.
 *
 * `server/backup.mjs` has exported the tables that cannot be rebuilt since RM-006d, but only when
 * somebody ran it, and the Free plan keeps no backups of its own. This runs it every week from a
 * timer (`ibems-backup.timer`), and puts the copy where the Pi's card is not: the private bucket
 * that already holds the sealed raw days (RM-148), under `<site>/backup/<UTC day>/`.
 *
 * WHAT A RUN DOES, IN ORDER, AND WHY:
 *
 * 1. Each table in `BACKUP_TABLES` is exported, gzipped NDJSON, written to the edge first, then
 *    uploaded. One table failing does not cost the others, as in backup.mjs.
 * 2. The manifest (rows and sha256 per table, or the error) goes up LAST, so a folder with a
 *    manifest is a finished backup and one without is an interrupted one.
 * 3. Every uploaded file is downloaded again and its sha256 compared: a copy is not counted until it
 *    has been read back.
 * 4. Only when all of that held are older backups removed: the newest eight weeks in the bucket
 *    (about 5 MB each after a year), the newest four on the edge. A failed week removes nothing, so
 *    a run of failures never eats the last good copy. Sealed days are never touched.
 * 5. The restore drill (`server/archiveDrill.mjs`) runs on a sealed day picked at random, so a copy
 *    that has quietly stopped restoring is found within a week rather than on the day it is needed.
 *
 * All I/O is passed in; the CLI (`server/backup-cycle.mjs`) wires the real thing.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { BACKUP_TABLES } from './backup.mjs';

export const BACKUP_KEEP_WEEKS = 8;
export const BACKUP_KEEP_LOCAL = 4;

const DATED = /^\d{4}-\d{2}-\d{2}$/;

export const backupPrefix = (siteId) => `${siteId}/backup`;
export const backupFolder = (siteId, day) => `${backupPrefix(siteId)}/${day}`;

/** The dated folders beyond the newest `keep`. Anything not named like a date is left alone, and the newest always stays. */
export function foldersToDrop(names, keep) {
  const dated = names.filter((n) => DATED.test(n)).sort().reverse();
  return dated.slice(Math.max(1, keep));
}

/**
 * A day that was sealed AND copied off the edge, at random; null when there is none. A day whose
 * readings were sealed is preferred: they are nearly all of the archive, and some early days hold
 * only anomalies because their raw minutes were pruned before the archive existed.
 */
export function pickDrillDay(seals, random = Math.random) {
  const uploaded = seals.filter((s) => s.uploaded_at);
  const withReadings = uploaded.filter((s) => s.stream === 'readings');
  const days = [...new Set((withReadings.length ? withReadings : uploaded).map((s) => s.day))].sort();
  return days.length ? days[Math.min(days.length - 1, Math.floor(random() * days.length))] : null;
}

function writeAtomically(file, bytes) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, file);
}

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

/**
 * @param {{
 *   exportTable: (table: string, order: string) => Promise<object[]>,
 *   tables?: Array<{ table: string, order: string }>,
 *   storage: { upload: Function, download: Function, list: Function, remove: Function },
 *   bucket: string, siteId: string, localDir: string,
 *   nowMs?: number, keepWeeks?: number, keepLocal?: number,
 *   drill?: (() => Promise<{ day: string|null, ok: boolean, streams?: object[] }>) | null,
 *   log?: (line: string) => void,
 * }} io
 */
export async function runBackupCycle({
  exportTable, tables = BACKUP_TABLES, storage, bucket, siteId, localDir,
  nowMs = Date.now(), keepWeeks = BACKUP_KEEP_WEEKS, keepLocal = BACKUP_KEEP_LOCAL, drill = null, log = () => {},
}) {
  const day = new Date(nowMs).toISOString().slice(0, 10);
  const folder = backupFolder(siteId, day);
  const dir = path.join(localDir, day);
  fs.mkdirSync(dir, { recursive: true });

  const errors = [];
  const manifest = { exported_at: new Date(nowMs).toISOString(), site_id: siteId, tables: {} };
  const sent = [];
  let bytes = 0;

  // 1. Export, keep on the edge, upload.
  for (const { table, order } of tables) {
    try {
      const rows = await exportTable(table, order);
      const ndjson = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
      const gz = zlib.gzipSync(Buffer.from(ndjson, 'utf8'), { level: 9 });
      const name = `${table}.ndjson.gz`;
      writeAtomically(path.join(dir, name), gz);
      await storage.upload(bucket, `${folder}/${name}`, gz, 'application/gzip');
      manifest.tables[table] = { rows: rows.length, bytes: gz.length, sha256: sha256(ndjson) };
      sent.push({ table, name, sha256: manifest.tables[table].sha256 });
      bytes += gz.length;
      log(`${table}: ${rows.length} row(s), ${gz.length} byte(s)`);
    } catch (err) {
      manifest.tables[table] = { error: String(err?.message ?? err) };
      errors.push(`${table}: ${String(err?.message ?? err)}`);
    }
  }

  // 2. The manifest, last.
  const manifestJson = JSON.stringify(manifest, null, 2) + '\n';
  writeAtomically(path.join(dir, 'manifest.json'), manifestJson);
  try {
    await storage.upload(bucket, `${folder}/manifest.json`, Buffer.from(manifestJson, 'utf8'), 'application/json');
  } catch (err) {
    errors.push(`manifest: ${String(err?.message ?? err)}`);
  }

  // 3. Read every copy back.
  let verified = 0;
  for (const { table, name, sha256: expected } of sent) {
    try {
      const back = zlib.gunzipSync(await storage.download(bucket, `${folder}/${name}`)).toString('utf8');
      if (sha256(back) === expected) verified++;
      else errors.push(`${table}: the copy in the bucket does not match what was sent`);
    } catch (err) {
      errors.push(`${table}: could not read the copy back: ${String(err?.message ?? err)}`);
    }
  }

  // 4. Rotate, only after a backup that is complete and read back.
  const dropped = [];
  const droppedLocal = [];
  if (errors.length === 0) {
    try {
      const entries = await storage.list(bucket, backupPrefix(siteId));
      for (const old of foldersToDrop(entries.filter((e) => e.id === null).map((e) => e.name), keepWeeks)) {
        const files = (await storage.list(bucket, backupFolder(siteId, old))).filter((e) => e.id !== null);
        await storage.remove(bucket, files.map((f) => `${backupFolder(siteId, old)}/${f.name}`));
        dropped.push(old);
      }
    } catch (err) {
      errors.push(`rotation: ${String(err?.message ?? err)}`);
    }
    for (const old of foldersToDrop(fs.readdirSync(localDir), keepLocal)) {
      fs.rmSync(path.join(localDir, old), { recursive: true, force: true });
      droppedLocal.push(old);
    }
  }

  // 5. The restore drill.
  let drillResult = null;
  if (drill) {
    try {
      drillResult = await drill();
      if (drillResult && !drillResult.ok) {
        const bad = (drillResult.streams ?? []).filter((s) => !s.ok).map((s) => s.stream).join(', ');
        errors.push(`restore drill of ${drillResult.day} failed${bad ? ` (${bad})` : ''}`);
      }
    } catch (err) {
      errors.push(`restore drill: ${String(err?.message ?? err)}`);
    }
  }

  return { ok: errors.length === 0, day, folder, bytes, verified, dropped, droppedLocal, drill: drillResult, errors, manifest };
}
