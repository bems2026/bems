/**
 * One retention pass of RM-148's hot tier: seal the archive's complete days and copy them off the
 * edge, then prune each raw cloud table only where the edge holds it (`archiveJanitor.mjs`).
 *
 * Sealing comes first on purpose. The janitor's last gate is "sealed and copied off the edge", so
 * the day a pass seals is the day the same pass may prune. Run by `server/ingest.mjs` on its
 * retention cadence when it has an archive; without one, the daemon keeps the pre-RM-148 30-day
 * window instead (`server/retention.mjs`).
 *
 * Each table is guarded on its own, as `ingest.mjs`'s retention always has been: one table failing
 * is reported, and the other still runs.
 */

import { sealPass, sealGate } from './archiveSeal.mjs';
import { runVerifiedPrune } from './archiveJanitor.mjs';

/**
 * @param {{ client: object, archive: object, storage: object|null, bucket: string, siteId: string,
 *           sealedDir: string, hotDays: number, nowMs?: number }} args
 */
export async function runHotTierPass({ client, archive, storage, bucket, siteId, sealedDir, hotDays, nowMs = Date.now() }) {
  let seal;
  try {
    seal = await sealPass({ archive, storage, bucket, siteId, dir: sealedDir, nowMs });
  } catch (err) {
    seal = { sealed: [], uploaded: [], errors: [`sealing failed: ${String(err?.message ?? err)}`] };
  }
  const gate = sealGate({ archive });
  const out = { seal };
  for (const stream of ['readings', 'building_totals']) {
    try {
      out[stream] = await runVerifiedPrune({ client, archive, stream, retentionDays: hotDays, nowMs, gate });
    } catch (err) {
      out[stream] = { ran: false, steps: 0, rolled: 0, deleted: 0, backfilled: 0, blocked: null, reason: 'failed', error: String(err?.message ?? err) };
    }
  }
  return out;
}
