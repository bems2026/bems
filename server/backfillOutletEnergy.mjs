#!/usr/bin/env node
/**
 * Recompute the outlets' stored `energy_kwh_today` — the history RM-047 left behind.
 *
 * WHAT WAS WRONG. The bridge's outlet parser accumulated `add_ele` on every poll, and a poll
 * returns the device's whole RETAINED dp table, so the same increment was banked again every
 * sixty seconds. Measured across 2026-08-17 to 09-07: the seven outlets reported **344.8 kWh**
 * between them against **11.6 kWh** actually drawn. co5 alone reported 74.01 kWh for 2026-09-05.
 *
 * WHY RECOMPUTING IS NOT FABRICATION HERE, which is the objection that has to be answered before
 * rewriting a production table. `pc_outlet` has no energy register at all — all 17 of its dps are
 * switches, countdowns, coefficients, diagnostics and that one increment. So this column has
 * NEVER held a device measurement for an outlet: it has always been a value the bridge derived
 * from power. This recomputes that same derived quantity with the corrected formula, from
 * `power_w`, which is measured and is not touched. For the CT meters — which do have their own
 * counter — nothing here applies and nothing here runs.
 *
 * THE RULE MIRRORS THE DEPLOYED PARSER, deliberately, so that history and future are the same
 * quantity computed the same way and a chart can cross the boundary without a step in it:
 * trapezoid over both endpoints, and a gap beyond `MAX_INTEGRATION_GAP_MS` skipped rather than
 * clamped.
 *
 * PLUS ONE GUARD THE LIVE PATH GETS FOR FREE. A live parser only integrates when a packet
 * arrives, so a device that goes quiet contributes nothing. History has no such protection: the
 * bridge keeps serving a departed device's last wattage, and integrating that would invent
 * energy on a scale larger than the fault being fixed. Measured — co5 on 2026-08-28 has 1,440
 * rows with `online: false` and `power_w` frozen at exactly 513.9 W for every one of them, which
 * naively integrates to 12.33 kWh a day and did so for eight consecutive days. So an interval is
 * counted only when the device was online at BOTH ends. The data records this honestly, and
 * `buildLatest` already excludes offline devices from the building totals for the same reason.
 *
 *     node server/backfillOutletEnergy.mjs              # dry run, prints what would change
 *     node server/backfillOutletEnergy.mjs --apply
 *
 * Idempotent: running it twice produces the same numbers, because it reads only `power_w`,
 * `online` and `ts`, none of which it writes.
 */

import { pathToFileURL } from 'node:url';
import { MAX_INTEGRATION_GAP_MS } from '../node-red-bridge/dpParserPlan.mjs';

/**
 * One wattage, or `null` if there isn't one.
 *
 * `Number(null)` is 0 and `Number.isFinite(0)` is true, so the obvious spelling of this check
 * silently turns a missing reading into a real zero — the exact conflation
 * `server/scrubTelemetry.mjs` exists to stop, one layer down. A string is accepted because
 * PostgREST may serialise `numeric` either way depending on the column and the driver.
 */
function watt(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Which local day a timestamp falls in, as a key, at a fixed UTC offset. */
export function localDayKey(ts, offsetMinutes) {
  return new Date(Date.parse(ts) + offsetMinutes * 60000).toISOString().slice(0, 10);
}

/**
 * The corrected running `energy_kwh_today` for one device's rows.
 *
 * @param {Array<{ts: string, power_w: number|null, online: boolean}>} rows ordered by ts ascending
 * @param {number} offsetMinutes the site's UTC offset, for the local-midnight reset
 * @returns {Array<{ts: string, energy_kwh_today: number}>} one entry per input row
 */
export function recomputeDailyEnergy(rows, offsetMinutes) {
  const out = [];
  let running = 0;
  let day = null;
  let prev = null;

  for (const row of rows) {
    const key = localDayKey(row.ts, offsetMinutes);
    if (key !== day) {
      // The local-midnight rollover, matching the parser's own `${ctx}_last_day` reset. The first
      // row of a day carries no interval, so the day opens at zero rather than at a fraction
      // inherited from the last interval of the previous one.
      running = 0;
      day = key;
      prev = null;
    }

    if (prev) {
      const hours = (Date.parse(row.ts) - Date.parse(prev.ts)) / 3600000;
      const bothOnline = prev.online === true && row.online === true;
      const usable = hours > 0 && hours <= MAX_INTEGRATION_GAP_MS / 3600000;
      if (bothOnline && usable) {
        // A missing endpoint is absent, not zero. Skipping the interval under-counts by a known
        // amount; calling it 0 W would assert the socket was idle, which nothing measured.
        const a = watt(prev.power_w);
        const b = watt(row.power_w);
        if (a !== null && b !== null) running += ((a + b) / 2 / 1000) * hours;
      }
    }

    out.push({ ts: row.ts, energy_kwh_today: Math.round(running * 1e6) / 1e6 });
    prev = row;
  }
  return out;
}

/**
 * Which devices this may touch. Named by class rather than hard-coded, so a site with a
 * different number of outlets needs no edit — and so it can never reach a meter, whose
 * `energy_kwh_today` comes from the device's own `today_acc_energy` and must not be recomputed
 * from anything.
 */
export function outletIdsFrom(registry) {
  return registry.filter((d) => d.class === 'outlet_dual').map((d) => d.id);
}

// ---------------------------------------------------------------------------
// The runner. Everything above is pure and tested; this is the I/O around it.
// ---------------------------------------------------------------------------

/**
 * Reads every stored row for one device, in pages.
 *
 * PostgREST silently caps a response at `db-max-rows` and gives no signal that it did — the
 * failure `supabase/phase9_history_buckets.sql` documents at length, and one this session has
 * already made once. Paging until a short page arrives is what makes "this is all of it" a claim
 * rather than an assumption.
 */
async function readAll(client, deviceId) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await client.select(
      'readings',
      `select=device_id,ts,voltage,current,power_w,energy_kwh_today,online&device_id=eq.${deviceId}&order=ts.asc&limit=1000&offset=${offset}`,
    );
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

async function main() {
  const apply = process.argv.includes('--apply');
  const { makeSupabaseClient } = await import('./supabaseRest.mjs');
  const { DEVICE_REGISTRY, SITE } = await import('../shared/registry.mjs');

  const client = makeSupabaseClient({
    url: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    timeoutMs: 60000,
  });

  console.log(apply
    ? '[backfill] APPLYING — rewriting energy_kwh_today for the outlets'
    : '[backfill] DRY RUN — nothing will be written. Re-run with --apply.');

  let totalRows = 0, totalChanged = 0, reportedSum = 0, correctedSum = 0;

  for (const id of outletIdsFrom(DEVICE_REGISTRY)) {
    const rows = await readAll(client, id);
    if (rows.length === 0) { console.log(`  ${id.padEnd(5)} no rows`); continue; }

    const corrected = recomputeDailyEnergy(rows, SITE.utc_offset_minutes);
    const changed = [];
    let repDayMax = 0, corDayMax = 0, day = null;
    for (let i = 0; i < rows.length; i++) {
      const before = rows[i].energy_kwh_today === null ? null : Number(rows[i].energy_kwh_today);
      const after = corrected[i].energy_kwh_today;
      // Per-local-day peaks, which is what the reports and the dashboard tiles actually show.
      const key = localDayKey(rows[i].ts, SITE.utc_offset_minutes);
      if (key !== day) { reportedSum += repDayMax; correctedSum += corDayMax; repDayMax = 0; corDayMax = 0; day = key; }
      if (before !== null && before > repDayMax) repDayMax = before;
      if (after > corDayMax) corDayMax = after;

      if (before === null || Math.abs(before - after) > 1e-6) {
        changed.push({ ...rows[i], energy_kwh_today: after });
      }
    }
    reportedSum += repDayMax; correctedSum += corDayMax;
    totalRows += rows.length;
    totalChanged += changed.length;
    console.log(`  ${id.padEnd(5)} ${String(rows.length).padStart(6)} rows, ${String(changed.length).padStart(6)} would change`);

    if (apply) {
      for (let i = 0; i < changed.length; i += 500) {
        await client.upsert('readings', changed.slice(i, i + 500), { onConflict: 'device_id,ts' });
      }
      console.log(`  ${id.padEnd(5)} written`);
    }
  }

  console.log(`\n  ${totalChanged} of ${totalRows} outlet rows differ`);
  console.log(`  daily peaks summed: ${reportedSum.toFixed(1)} kWh reported -> ${correctedSum.toFixed(1)} kWh corrected`);
  if (!apply) console.log('\n  Dry run. Re-run with --apply to write it.');
}

// `pathToFileURL` rather than hand-building a file:// string — it is the only spelling that is
// correct on both a POSIX path and a Windows one, and it needs no escapes.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error('[backfill] failed:', err); process.exit(1); });
}
