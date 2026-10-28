#!/usr/bin/env node
/**
 * RM-165's one-shot: estimates the energy of every meter hold that already ended, from the archive. Run on the
 * edge.
 *
 *     npm run held-energy:backfill                       dry run: each hold, its register step, what it would add
 *     npm run held-energy:backfill -- --apply            queue the rows; ingest uploads them after its next upload
 *
 * Options: `--since=YYYY-MM-DD` (site-local day to start from, default 2026-10-01).
 *
 * WHY (E-260). The circuit meters hold their readings while the site network has no internet, and their lifetime
 * registers keep counting; when they resume, ingest estimates the hold (`server/heldEnergy.mjs`). The holds that
 * ended before that existed — 7 to 14 October, and 14 to 28 October — need this once.
 *
 * SAFETY. The archive is opened read-only. `--apply` only appends to the queue ingest drains
 * (`server/estimateOutbox.mjs`), skipping any hold already on its record, so running it twice adds nothing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openArchive } from './archiveDb.mjs';
import { frozenStretches, STILL_AFTER_MS } from './frozenStretches.mjs';
import { findHoldEstimates, hasOwnLifetimeRegister } from './heldEnergy.mjs';
import { createEstimateOutbox } from './estimateOutbox.mjs';
import { DEVICE_REGISTRY, SITE } from '../shared/registry.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const APPLY = process.argv.includes('--apply');
const ARCHIVE_PATH = process.env.ARCHIVE_DB_PATH || path.join(HERE, 'data', 'archive', 'archive.sqlite');
const PENDING = process.env.ESTIMATES_PENDING_PATH || path.join(HERE, 'data', 'energy-estimates-pending.ndjson');
const RECORD = process.env.ESTIMATES_RECORD_PATH || path.join(HERE, 'data', 'energy-estimates.ndjson');
const offsetMinutes = Number(SITE.utc_offset_minutes ?? 480);
const sinceDay = arg('since', '2026-10-01');
const sinceMs = Date.parse(`${sinceDay}T00:00:00Z`) - offsetMinutes * 60_000;
if (!/^\d{4}-\d{2}-\d{2}$/.test(sinceDay) || Number.isNaN(sinceMs)) {
  console.error('Usage: npm run held-energy:backfill [-- --since=YYYY-MM-DD] [--apply]');
  process.exit(2);
}

const already = new Set();
if (fs.existsSync(RECORD)) {
  for (const line of fs.readFileSync(RECORD, 'utf8').split('\n')) {
    try {
      const r = JSON.parse(line);
      already.add(`${r.device_id}|${new Date(Date.parse(r.held_from)).toISOString()}`);
    } catch { /* a blank or partial line */ }
  }
}

const local = (iso) => new Date(Date.parse(iso) + offsetMinutes * 60_000).toISOString().replace('T', ' ').slice(0, 16);
const archive = openArchive(ARCHIVE_PATH, { readOnly: true });
try {
  const holds = findHoldEstimates(archive, {
    meters: DEVICE_REGISTRY.filter(hasOwnLifetimeRegister).map((d) => d.id),
    sinceMs, untilMs: Date.now(), siteId: SITE.id, offsetMinutes, stillAfterMs: STILL_AFTER_MS, frozenStretches, already,
  });
  const rows = [];
  for (const h of holds) {
    const head = `${h.deviceId}: held ${local(h.frozenSince)} to ${local(h.toTs)}`;
    if (h.skipped) console.log(`${head} — ${h.skipped}`);
    else if (h.step.ok) {
      console.log(`${head} — register stepped ${h.step.stepKwh.toFixed(3)} kWh at ${local(h.step.recoveredAt)}; ${h.step.kwh.toFixed(3)} kWh over ${h.rows.length} day(s)`);
      for (const r of h.rows) console.log(`    ${r.local_day}  ${r.kwh.toFixed(3)} kWh`);
      rows.push(...h.rows);
    } else console.log(`${head} — no estimate: ${h.step.reason}${h.step.stepKwh !== undefined ? ` (register step ${h.step.stepKwh})` : ''}`);
  }
  if (holds.length === 0) console.log('No ended holds found.');
  const shared = DEVICE_REGISTRY.filter((d) => d.class === 'meter' && !hasOwnLifetimeRegister(d)).map((d) => d.id);
  if (shared.length) console.log(`Not estimated: ${shared.join(', ')} (one lifetime register for both clamps; their holds stay a gap).`);
  if (APPLY && rows.length) {
    createEstimateOutbox({ pending: PENDING, record: RECORD }).add(rows);
    console.log(`Queued ${rows.length} row(s); ingest sends them after its next upload that goes through.`);
  } else if (rows.length) {
    console.log(`Dry run: ${rows.length} row(s) would be queued. Add --apply to queue them.`);
  }
} finally {
  archive.close?.();
}
