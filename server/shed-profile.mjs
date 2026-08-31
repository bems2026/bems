#!/usr/bin/env node
/**
 * `npm run shed:profile` — what load shedding could actually achieve here. RM-006c.
 *
 * WHY THIS EXISTS. Assigning load-shed tiers is described in `ROADMAP.md` as "the highest-value
 * single decision on this list", and it is a judgement about the building rather than a
 * technical question. But it is a judgement that deserves numbers, and the numbers turned out to
 * contradict the intuition everyone starts with — including mine, and including the order this
 * was first asked for ("lights, then outlets").
 *
 * Measured over 14 days of office hours on 2026-08-31, this building drew ~919 W of metered
 * demand. Lighting was 1.8% of it. Everything a relay can switch came to under 5%. The single
 * largest controllable load is the aircon, which is not on a relay at all — it is reached by IR
 * setpoint, so it sits outside the shed tiers entirely.
 *
 * That does not make tiers pointless: a tier is PERMISSION, not size. An outlet averaging 1 W
 * may be 400 W the afternoon somebody plugs a kettle into it, and the tier is what says whether
 * that may be dropped. But it does mean auto-shed cannot be relied on to hold this building
 * under a threshold as it is currently instrumented, and anyone planning around it should know
 * that before rather than after.
 *
 * READ-ONLY. Uses the same service-role key `ingest.mjs` does and writes nothing.
 *
 * HONESTY NOTES, both learned the hard way while writing this:
 *   - Per-device averages come from `readings_buckets`, which averages `filter (where online)`.
 *     A frozen reading from an offline device must never be counted; the first draft of this
 *     analysis summed a 513.9 W value from a device that had been offline for days, which is
 *     the exact failure RM-024 and EX-107 exist to prevent.
 *   - Coverage is printed beside every figure. A device observed for 1 hour in 336 has an
 *     average, and that average means nothing (EX-033's rule).
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  try {
    return Object.fromEntries(
      readFileSync(join(HERE, '.env'), 'utf8')
        .split(/\r?\n/)
        .filter((l) => l && !l.startsWith('#'))
        .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
    );
  } catch {
    return {};
  }
}

const env = { ...loadEnv(), ...process.env };
const URL_ = env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed (server/.env). Read-only; nothing is written.');
  process.exit(2);
}

const DAYS = Number(process.env.SHED_DAYS ?? 14);
/** The window a shed event would actually happen in. Outside it there is nothing to shed. */
const OFFICE_START = Number(process.env.SHED_OFFICE_START ?? 8);
const OFFICE_END = Number(process.env.SHED_OFFICE_END ?? 17);

const { SITE, DEVICE_REGISTRY, CIRCUITS } = await import('../shared/registry.mjs');
const hourAtSite = (iso) => new Date(Date.parse(iso) + SITE.utc_offset_minutes * 60000).getUTCHours();

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const buckets = async (id, since) => {
  const r = await fetch(`${URL_}/rest/v1/rpc/readings_buckets`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ p_device_id: id, p_since: since, p_bucket_seconds: 3600 }),
  });
  return r.ok ? r.json() : [];
};

const since = new Date(Date.now() - DAYS * 864e5).toISOString();
const possible = DAYS * 24;

const meters = DEVICE_REGISTRY.filter((d) => d.class === 'meter');
const relayable = DEVICE_REGISTRY.filter((d) => d.class === 'outlet_dual' || d.class === 'switch');
const circuitName = (id) => CIRCUITS.find((c) => c.meter_device_id === id)?.name ?? id;

async function profile(id) {
  const rows = await buckets(id, since);
  const observed = rows.filter((r) => typeof r.power_w === 'number');
  const inHours = observed.filter((r) => {
    const h = hourAtSite(r.ts);
    return h >= OFFICE_START && h < OFFICE_END;
  });
  return {
    id,
    observedHours: observed.length,
    officeAvg: inHours.length ? inHours.reduce((a, r) => a + Number(r.power_w), 0) / inHours.length : null,
    peak: observed.length ? Math.max(...observed.map((r) => Number(r.power_w))) : null,
  };
}

const w = (v) => (v === null ? '    —' : String(Math.round(v)).padStart(5));
const cov = (n) => `${String(n).padStart(3)}/${possible} h`;

console.log(`\n${SITE.display_name} — what load shedding could reach`);
console.log(`${DAYS} days, office hours ${OFFICE_START}:00–${OFFICE_END}:00 ${SITE.timezone}, online samples only\n`);

const meterRows = [];
for (const m of meters) meterRows.push({ ...(await profile(m.id)), name: circuitName(m.id) });
const metered = meterRows.reduce((a, r) => a + (r.officeAvg ?? 0), 0);

console.log('BRANCH CIRCUITS — what the building draws');
console.log('  circuit                        avg W    peak W   observed');
for (const r of meterRows.sort((a, b) => (b.officeAvg ?? -1) - (a.officeAvg ?? -1))) {
  const pct = metered ? ((r.officeAvg ?? 0) / metered) * 100 : 0;
  console.log(`  ${r.name.padEnd(22)} ${w(r.officeAvg)} W  ${w(r.peak)} W  ${cov(r.observedHours)}   ${pct.toFixed(1).padStart(5)}%`);
}
console.log(`  ${'TOTAL METERED'.padEnd(22)} ${w(metered)} W`);

const relayRows = [];
for (const d of relayable) relayRows.push({ ...(await profile(d.id)), name: d.display_name, cls: d.class });
const switchable = relayRows.reduce((a, r) => a + (r.officeAvg ?? 0), 0);

console.log('\nWHAT A RELAY CAN ACTUALLY SWITCH');
console.log('  device                         avg W    peak W   observed');
for (const r of relayRows) {
  const thin = r.observedHours < possible / 10 ? '  <- barely reporting; treat the average as unknown' : '';
  const unmetered = r.cls === 'switch' ? '  (relay only, no metering of its own)' : '';
  console.log(`  ${r.id.padEnd(6)} ${r.name.padEnd(15)} ${w(r.officeAvg)} W  ${w(r.peak)} W  ${cov(r.observedHours)}${thin}${unmetered}`);
}
console.log(`  ${'SUM OF SWITCHABLE'.padEnd(22)} ${w(switchable)} W`);

console.log('\nWHAT THAT MEANS');
if (metered > 0) {
  console.log(`  Metered office-hours demand              ${w(metered)} W`);
  console.log(`  Reachable by a relay                     ${w(switchable)} W   ${((switchable / metered) * 100).toFixed(1)}% of it`);
  const acu = meterRows.find((r) => /acu/i.test(r.name) || /acu/i.test(r.id));
  if (acu?.officeAvg) {
    console.log(`  The aircon alone                         ${w(acu.officeAvg)} W   ${((acu.officeAvg / metered) * 100).toFixed(1)}% — reached by IR setpoint, NOT by a relay,`);
    console.log('                                                   so it sits outside the shed tiers entirely.');
  }
  // The gap between a branch meter and the switchable devices on it is the part of that circuit
  // plugged into ordinary sockets. It is the single most useful number here for planning.
  const outletBranch = meterRows.find((r) => /c\.o|outlet/i.test(r.name));
  const outletSum = relayRows.filter((r) => r.cls === 'outlet_dual').reduce((a, r) => a + (r.officeAvg ?? 0), 0);
  if (outletBranch?.officeAvg && outletBranch.officeAvg > outletSum) {
    const pct = (1 - outletSum / outletBranch.officeAvg) * 100;
    console.log(`\n  The outlet branch draws ${Math.round(outletBranch.officeAvg)} W; its switchable outlets account for ${Math.round(outletSum)} W.`);
    console.log(`  ${pct.toFixed(0)}% of that circuit is on ordinary sockets and cannot be shed at all.`);
  }
}
console.log('\n  A TIER IS PERMISSION, NOT SIZE. An outlet averaging 1 W may be 400 W the afternoon');
console.log('  somebody plugs a kettle into it. These figures say what shedding can achieve today,');
console.log('  not which loads it is acceptable to drop — that part is nobody\'s call but yours.\n');
