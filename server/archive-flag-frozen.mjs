#!/usr/bin/env node
/**
 * RM-163's one-off correction: marks the CT meters' frozen stretches in the archive, so they reach the
 * cloud and the reports as frozen rather than as measurements. Run on the edge.
 *
 *     touch server/data/ingest.pause                                       (uploads stop; archiving does not)
 *     npm run archive:flag-frozen                                          dry run: what it would mark
 *     npm run archive:flag-frozen -- --apply                               back up the archive, then mark
 *     rm server/data/ingest.pause                                          uploads resume, flags included
 *
 * Options: `--since=YYYY-MM-DD` (site-local day to start from, default 2026-10-07, the outage's first day),
 * `--min-hours=N` (default 12: see `frozenStretches.mjs` for why).
 *
 * WHY (E-256). With the site offline from 7 to 14 October the four CT meters answered the flow's poll with
 * identical figures for 2.5 to 6 days. The live freeze rule caught the two drawing power; the two at 0 W were
 * stored as real readings, five days of them. None had reached the cloud yet: the upload stopped when the
 * internet did. This marks them before it resumes.
 *
 * SAFETY. The dry run opens the archive read-only. `--apply` refuses without the pause file (so the uploader
 * cannot send a row mid-change), backs the archive up first with `VACUUM INTO` (never overwriting a backup),
 * forgets the seal of every UTC day it touches (so the sealing pass writes and copies it again), and sends
 * again any marked row the cloud already holds — the upload is an upsert, so the flag lands.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnv } from '../node-red-bridge/nodeRedAdmin.mjs';
import { openArchive } from './archiveDb.mjs';
import { frozenStretches, STILL_AFTER_MS } from './frozenStretches.mjs';
import { readingsForCloud } from './cloudCapabilities.mjs';
import { makeSupabaseClient } from './supabaseRest.mjs';
import { DEVICE_REGISTRY, SITE } from '../shared/registry.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
loadDotEnv(path.join(HERE, '..'));
loadDotEnv(HERE);

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const APPLY = process.argv.includes('--apply');
const ARCHIVE_PATH = process.env.ARCHIVE_DB_PATH || path.join(HERE, 'data', 'archive', 'archive.sqlite');
const PAUSE_PATH = process.env.INGEST_PAUSE_PATH || path.join(HERE, 'data', 'ingest.pause');
const BACKUP_DIR = process.env.ARCHIVE_BACKUP_DIR || path.dirname(ARCHIVE_PATH);
const OFFSET_MS = (SITE.utc_offset_minutes ?? 480) * 60_000;
const sinceDay = arg('since', '2026-10-07');
const sinceMs = Date.parse(`${sinceDay}T00:00:00Z`) - OFFSET_MS;
const minHours = Number(arg('min-hours', String(STILL_AFTER_MS / 3_600_000)));
if (!/^\d{4}-\d{2}-\d{2}$/.test(sinceDay) || Number.isNaN(sinceMs) || !(minHours > 0)) {
  console.error('Usage: npm run archive:flag-frozen [-- --since=YYYY-MM-DD] [--min-hours=N] [--apply]');
  process.exit(2);
}
if (APPLY && !fs.existsSync(PAUSE_PATH)) {
  console.error(`Refusing: ingest is not paused (${PAUSE_PATH} does not exist). touch it first, so nothing uploads mid-change.`);
  process.exit(2);
}

const local = (iso) => new Date(Date.parse(iso) + OFFSET_MS).toISOString().replace('T', ' ').slice(0, 16);
const utcDays = (fromMs, toMs) => {
  const days = [];
  for (let d = Math.floor(fromMs / 86_400_000) * 86_400_000; d <= toMs; d += 86_400_000) days.push(new Date(d).toISOString().slice(0, 10));
  return days;
};

const meters = DEVICE_REGISTRY.filter((d) => d.class === 'meter').map((d) => d.id);
const archive = openArchive(ARCHIVE_PATH, { readOnly: !APPLY });
let exitCode = 0;
try {
  const found = [];
  for (const deviceId of meters) {
    const rows = [...archive.rowsBetween('readings', { sinceMs, untilMs: Date.now() + 3_600_000, deviceId })];
    for (const s of frozenStretches(rows, { stillAfterMs: minHours * 3_600_000 })) {
      const inside = rows.filter((r) => r.ts >= s.fromTs && r.ts <= s.toTs);
      const flagged = inside.filter((r) => r.capabilities?.measurement_frozen === true).length;
      found.push({ deviceId, ...s, alreadyFlagged: flagged });
    }
  }

  console.log(`Frozen stretches since ${sinceDay} (site time), at least ${minHours} h of identical readings:`);
  if (!found.length) console.log('  none');
  for (const f of found) {
    const hours = (Date.parse(f.toTs) - Date.parse(f.frozenSince)) / 3_600_000;
    console.log(`  ${f.deviceId.padEnd(16)} ${local(f.frozenSince)} -> ${local(f.toTs)}  ${hours.toFixed(1)} h, ${f.rows} row(s) after the last real value, ${f.alreadyFlagged} already flagged`);
  }

  if (!APPLY) {
    console.log(`\nDry run: nothing written. With ${PAUSE_PATH} in place, add --apply to back up the archive and mark them.`);
  } else if (found.length) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = path.join(BACKUP_DIR, `archive-before-flag-frozen-${stamp}.sqlite`);
    archive.backupTo(backup);
    console.log(`\nBacked up the archive to ${backup}`);

    let flagged = 0;
    const resend = [];
    const days = new Set();
    for (const f of found) {
      const r = archive.flagFrozen(f.deviceId, { fromMs: Date.parse(f.fromTs), toMs: Date.parse(f.toTs), frozenSince: f.frozenSince });
      flagged += r.flagged;
      resend.push(...r.uploadedIds);
      for (const d of utcDays(Date.parse(f.fromTs), Date.parse(f.toTs))) days.add(d);
    }
    for (const d of days) archive.forgetSeal(d, 'readings');
    console.log(`Marked ${flagged} row(s) frozen; ${days.size} day(s) will be sealed again.`);

    if (resend.length) {
      const url = process.env.SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) {
        console.error(`${resend.length} marked row(s) are already in the cloud, unmarked, and no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY is set to send them again.`);
        exitCode = 1;
      } else {
        const client = makeSupabaseClient({ url, serviceRoleKey: key, timeoutMs: 60_000 });
        const rows = readingsForCloud(archive.readingsByIds(resend));
        let sent = 0;
        try {
          for (let i = 0; i < rows.length; i += 100) {
            await client.upsert('readings', rows.slice(i, i + 100), { onConflict: 'device_id,ts' });
            sent += Math.min(100, rows.length - i);
          }
          console.log(`Sent ${sent} already-uploaded row(s) again, now marked.`);
        } catch (err) {
          console.error(`Sent ${sent} of ${rows.length} already-uploaded row(s) again before: ${err?.message ?? err}. Re-run --apply when the link answers; marking again is a no-op.`);
          exitCode = 1;
        }
      }
    }
    console.log(`\nDone. Remove ${PAUSE_PATH} and ingest resumes, uploading the marked rows.`);
  }
} finally {
  archive.close();
}
process.exitCode = exitCode;
