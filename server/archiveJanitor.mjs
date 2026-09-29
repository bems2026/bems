/**
 * Verify, then prune — RM-148's retention for the cloud's raw tables, Stage 4.
 *
 * The cloud keeps a short window of raw rows (`shared/retention.mjs`); the edge's archive keeps them
 * all. That split is only safe if nothing leaves the cloud that the edge does not hold, so a day of
 * raw rows is pruned only when three things are true of it:
 *
 *   1. UPLOADED — no archived row older than the step is still waiting to reach the cloud. Its hour
 *      would otherwise be rolled up without it (`roll_up_and_prune_*` rolls, then deletes, and a raw
 *      row arriving after its hour was rolled is deleted uncounted).
 *   2. COVERED — for every device and hour, the archive holds at least as many rows as the cloud's
 *      manifest (`phase48`) says it has. A shortfall is copied down from the cloud first, and a
 *      shortfall that cannot be filled stops the prune.
 *   3. SEALED — the day is sealed with its current rows and copied off the edge (`archiveSeal.mjs`),
 *      so the SD card is never the only copy.
 *
 * It steps one UTC day at a time towards an hour-aligned cutoff, each step its own statement, so the
 * one-time move from 30 days to 14 is a few dozen short deletes rather than one long one. It uses the
 * existing rollup functions unchanged: the rollup and the delete still share a transaction.
 *
 * A blocked step is not an error. The pass reports why and stops, and the cloud keeps its rows until
 * the next pass: holding a day longer costs a few MB, and pruning it wrongly costs the day.
 */

import { backfillStream, windowQuery, PAGE_LIMIT } from './archiveBackfill.mjs';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const floorTo = (ms, unit) => Math.floor(ms / unit) * unit;
const iso = (ms) => new Date(ms).toISOString();

const FUNCTIONS = {
  readings: { prune: 'roll_up_and_prune_readings', manifest: 'readings_manifest' },
  building_totals: { prune: 'roll_up_and_prune_building_totals', manifest: 'building_totals_manifest' },
};

/** Steps one pass may take. The first pass after the change from 30 days meets about 16. */
export const MAX_STEPS_PER_PASS = 20;

/**
 * @param {{
 *   client: { select: Function, rpc: Function }, archive: object, stream: 'readings'|'building_totals',
 *   retentionDays: number, nowMs?: number, gate: (stream: string, fromMs: number, toMs: number) => { sealed: boolean, reason: string|null },
 *   maxSteps?: number,
 * }} args
 * @returns {Promise<{ ran: boolean, steps: number, rolled: number, deleted: number, backfilled: number, blocked: string|null, reason: string }>}
 */
export async function runVerifiedPrune({ client, archive, stream, retentionDays, nowMs = Date.now(), gate, maxSteps = MAX_STEPS_PER_PASS }) {
  const fns = FUNCTIONS[stream];
  if (!fns) throw new Error(`no verified prune for ${stream}`);
  const cutoff = floorTo(nowMs - retentionDays * DAY_MS, HOUR_MS);
  const out = { ran: false, steps: 0, rolled: 0, deleted: 0, backfilled: 0, blocked: null, reason: '' };
  const finish = (reason, blocked = null) => ({ ...out, ran: out.steps > 0, reason, blocked });

  for (;;) {
    const oldest = await client.select(stream, 'select=ts&order=ts.asc&limit=1');
    const oldestTs = Array.isArray(oldest) && oldest.length ? oldest[0].ts : null;
    if (oldestTs === null) return finish(`no ${stream} in the cloud`);
    const oldestMs = Date.parse(oldestTs);
    if (Number.isNaN(oldestMs)) return finish('stopped', `unparseable oldest ${stream} ts ${oldestTs}`);
    if (oldestMs >= cutoff) return finish(`nothing older than the ${retentionDays}-day window`);
    if (out.steps >= maxSteps) return finish(`step budget of ${maxSteps} spent; the next pass continues`);

    const since = floorTo(oldestMs, HOUR_MS);
    const until = Math.min(cutoff, floorTo(oldestMs, DAY_MS) + DAY_MS);

    // 1. Uploaded.
    const owed = archive.pendingBefore(stream, until);
    if (owed > 0) return finish('blocked', `${owed} archived ${stream} row(s) older than ${iso(until)} still to upload`);

    // 2. Covered.
    let short = await coverageShortfall({ client, archive, stream, fns, since, until });
    if (short.length) {
      const fetchWindow = (s, w) => client.select(s, windowQuery(s, { ...w, limit: PAGE_LIMIT }));
      for (const { deviceId, hourMs } of short) {
        const r = await backfillStream({
          archive, fetchWindow, stream, deviceIds: deviceId ? [deviceId] : undefined,
          sinceMs: hourMs, untilMs: hourMs + HOUR_MS, windowMs: HOUR_MS,
        });
        out.backfilled += r.inserted;
      }
      short = await coverageShortfall({ client, archive, stream, fns, since, until });
      if (short.length) {
        const s = short[0];
        return finish('blocked', `${stream} ${s.deviceId || 'building'} ${iso(s.hourMs)}: the archive holds ${s.held} of ${s.cloud} row(s) the cloud has, and the cloud did not fill it`);
      }
    }

    // 3. Sealed and off the edge.
    const sealed = gate(stream, since, until);
    if (!sealed.sealed) return finish('blocked', sealed.reason);

    const result = await client.rpc(fns.prune, { p_before: iso(until) });
    const row = Array.isArray(result) ? result[0] : result;
    out.steps += 1;
    out.rolled += Number(row?.rolled ?? 0);
    out.deleted += Number(row?.deleted ?? 0);
  }
}

/** Device-hours where the archive holds fewer rows than the cloud's manifest says the cloud has. */
export async function coverageShortfall({ client, archive, stream, since, until, fns = FUNCTIONS[stream] }) {
  const manifest = await client.rpc(fns.manifest, { p_since: iso(since), p_until: iso(until) });
  const held = archive.countsByDeviceHour(stream, { sinceMs: since, untilMs: until });
  const out = [];
  for (const m of manifest ?? []) {
    const deviceId = m.device_id ?? '';
    const hourMs = Date.parse(m.hour);
    const have = held.get(`${deviceId}|${hourMs}`) ?? 0;
    if (have < Number(m.n)) out.push({ deviceId, hourMs, held: have, cloud: Number(m.n) });
  }
  return out;
}
