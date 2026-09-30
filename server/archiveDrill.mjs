/**
 * Restoring sealed days from the off-edge copy, and the drill that proves it works — RM-148/RM-149.
 *
 * A backup that has never been restored is a hope. `npm run archive:restore -- --day=…` runs the drill
 * by hand, and the weekly backup cycle (`server/backupCycle.mjs`) runs it on a day picked at random,
 * so a copy that has quietly stopped restoring is found within a week rather than on the day it is
 * needed.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { openArchive, STREAMS } from './archiveDb.mjs';
import { rowsFromCsv, sealDay, storagePathFor } from './archiveSeal.mjs';

/**
 * One day's streams from the bucket into `archive`.
 * @returns {Promise<Array<{ stream: string, missing?: true, rows?: number, sha256?: string }>>}
 */
export async function restoreDay({ storage, bucket, siteId, archive, day }) {
  const out = [];
  for (const stream of Object.keys(STREAMS)) {
    const where = storagePathFor({ siteId, day, stream });
    let bytes;
    try {
      bytes = await storage.download(bucket, where);
    } catch (err) {
      if (err.status === 400 || err.status === 404) { out.push({ stream, missing: true }); continue; }
      throw err;
    }
    const csv = zlib.gunzipSync(bytes).toString('utf8');
    const rows = rowsFromCsv(stream, csv);
    for (const origin of new Set(rows.map((r) => r.origin))) {
      archive.insertRows(stream, rows.filter((r) => r.origin === origin).map(({ origin: _o, ...r }) => r), { origin });
    }
    out.push({ stream, rows: rows.length, sha256: crypto.createHash('sha256').update(csv).digest('hex') });
  }
  return out;
}

/**
 * The drill: download one day, load it into a throwaway archive, seal it again, and compare. It
 * passes only when the download, the re-seal and the seal the live archive recorded all agree, and
 * at least one stream was actually found. Writes nothing outside a temporary directory.
 *
 * @param {{ storage: object, bucket: string, siteId: string, day: string, liveArchive?: object|null }} io
 * @returns {Promise<{ ok: boolean, streams: object[] }>}
 */
export async function drillDay({ storage, bucket, siteId, day, liveArchive = null }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ibems-restore-drill-'));
  const scratch = openArchive(path.join(dir, 'archive.sqlite'));
  const streams = [];
  try {
    for (const r of await restoreDay({ storage, bucket, siteId, archive: scratch, day })) {
      if (r.missing) {
        // Missing is a failure only where the live archive says it was sealed and uploaded.
        const recorded = liveArchive?.sealOf(day, r.stream) ?? null;
        streams.push({ ...r, ok: !recorded?.uploaded_at, recorded: recorded?.sha256 ?? null });
        continue;
      }
      const resealed = sealDay({ archive: scratch, stream: r.stream, day }).sha256;
      const recorded = liveArchive?.sealOf(day, r.stream)?.sha256 ?? null;
      streams.push({ ...r, resealed, recorded, ok: resealed === r.sha256 && (recorded === null || recorded === r.sha256) });
    }
  } finally {
    scratch.close();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
  const found = streams.filter((s) => !s.missing);
  return { ok: found.length > 0 && streams.every((s) => s.ok), streams };
}
