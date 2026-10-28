/**
 * Energy a held meter counted but did not report, recovered as an estimate — RM-165, 2026-10-28.
 *
 * WHAT WAS MEASURED (E-260). From 15 to 28 October the site network had no internet and the four circuit meters
 * repeated one reading each, voltage included; power-cycling them did not help. They resumed by themselves within
 * minutes of the internet returning, and their LIFETIME registers had kept counting: CARE ACU's stepped from
 * 152.972 to 185.945 kWh in one reading, L.O Red's from 4.854 to 6.306. The reports bank each day's register
 * (`energy_kwh_today`, phase53), which sat still, so those kWh were in no day at all.
 *
 * WHAT THIS DOES. The step, less what the recovery day's own register already counts, is spread over the held
 * days in proportion to what the meter usually uses on that kind of day (weekday or weekend, the median of the
 * healthy days before), each part day by the share of it that was held. The parts sum exactly to the step. Every
 * row says it is an estimate and from what; the reports carry it as a separate, labelled figure.
 *
 * WHAT IT REFUSES. A step that falls, or one faster than any branch can draw (`MAX_BRANCH_W`), is not a count:
 * the dual-channel meter's lifetime register (C.O Yellow, L.O Yellow) reads hundreds of thousands and jumps by
 * thousands a day, so those two holds stay a gap, and the report says so.
 */

import { CAPABILITY_PROFILES } from '../shared/deviceCapabilities.mjs';

/** Above any one branch circuit here (a 45 A breaker at 230 V is about 10 kW). */
export const MAX_BRANCH_W = 10_000;
const DAY_MS = 86_400_000;
const KWH_MS_PER_W = 3.6e9;
/** How far back a hold's start is looked for, before the still stretch that found it. */
const LOOK_BACK_MS = DAY_MS;

/**
 * Whether a device's `total_energy_kwh` counts its own circuit. The dual-channel meter (C.O Yellow and L.O
 * Yellow, a profile with two channels) reports one lifetime figure for both clamps, and it reads hundreds of
 * thousands and jumps by thousands a day (E-260): never a basis for an estimate. The frontend's
 * `voltageIsShared` reads the same profile field.
 */
export function hasOwnLifetimeRegister(device) {
  if (device?.class !== 'meter') return false;
  return (CAPABILITY_PROFILES[device.capability_profile]?.channels ?? 1) === 1;
}

/**
 * When the lifetime register stopped: the still stretch begins where EVERY value last changed, and the daily
 * counter goes on resetting at midnight while a meter is held (14 Oct: register still from 13:22, stretch from
 * 23:59). Walks back up to a day over readings with the held register value.
 */
function registerStoppedAt(archive, deviceId, stillFrom, heldTotal) {
  if (!Number.isFinite(heldTotal)) return stillFrom;
  let from = stillFrom;
  const earlier = [...archive.rowsBetween('readings', { sinceMs: stillFrom - LOOK_BACK_MS, untilMs: stillFrom, deviceId })]
    .filter((r) => r.online !== false && Number.isFinite(r.total_energy_kwh));
  for (let i = earlier.length - 1; i >= 0; i--) {
    if (earlier[i].total_energy_kwh !== heldTotal) break;
    from = Date.parse(earlier[i].ts);
  }
  return from;
}

/** How far back the profile looks for healthy days. */
export const PROFILE_DAYS = 28;
/** A day whose power took fewer distinct values than this was not read live. */
const LIVE_DISTINCT_POWERS = 10;

const offsetMs = (offsetMinutes) => offsetMinutes * 60_000;

/** The site's local midnight at or before `ms`. */
export function dayStartMs(ms, offsetMinutes) {
  const o = offsetMs(offsetMinutes);
  return Math.floor((ms + o) / DAY_MS) * DAY_MS - o;
}

/** `YYYY-MM-DD`, the site's local day of `ms`. */
export function localDay(ms, offsetMinutes) {
  return new Date(ms + offsetMs(offsetMinutes)).toISOString().slice(0, 10);
}

const isWeekend = (day) => {
  const d = new Date(`${day}T00:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
};

function median(values) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * The meter's usual day, from its archived readings: the median of each healthy day's highest
 * `energy_kwh_today`, weekdays and weekends apart. A day is healthy when its power was read live (it took many
 * values); a held day is not, whatever its register says.
 *
 * @param {Iterable<{ ts: string, power_w: number|null, energy_kwh_today: number|null, online: boolean }>} rows
 * @returns {{ weekday: number|null, weekend: number|null }}
 */
export function dailyProfile(rows, offsetMinutes) {
  const days = new Map(); // day -> { max, powers: Set }
  for (const r of rows) {
    if (r.online === false) continue;
    const day = localDay(Date.parse(r.ts), offsetMinutes);
    let d = days.get(day);
    if (!d) days.set(day, (d = { max: 0, powers: new Set() }));
    if (Number.isFinite(r.energy_kwh_today)) d.max = Math.max(d.max, r.energy_kwh_today);
    if (Number.isFinite(r.power_w)) d.powers.add(r.power_w);
  }
  const weekday = [];
  const weekend = [];
  for (const [day, d] of days) {
    if (d.powers.size < LIVE_DISTINCT_POWERS) continue;
    (isWeekend(day) ? weekend : weekday).push(d.max);
  }
  return { weekday: median(weekday), weekend: median(weekend) };
}

/**
 * `kwh` over `[fromMs, toMs)`, by local day, weighted by the profile and the share of each day held. Rounded to
 * the watt-hour, the remainder on the largest part, so the parts sum to `kwh` exactly as rounded.
 *
 * @returns {Array<{ day: string, kwh: number }>}
 */
export function spreadHeldEnergy({ kwh, fromMs, toMs, profile, offsetMinutes }) {
  if (!(kwh > 0) || !(toMs > fromMs)) return [];
  const known = [profile?.weekday, profile?.weekend].filter((v) => Number.isFinite(v));
  const fallback = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 1;
  const parts = [];
  for (let start = dayStartMs(fromMs, offsetMinutes); start < toMs; start += DAY_MS) {
    const held = Math.min(toMs, start + DAY_MS) - Math.max(fromMs, start);
    if (held <= 0) continue;
    const day = localDay(start, offsetMinutes);
    const usual = isWeekend(day) ? profile?.weekend : profile?.weekday;
    parts.push({ day, fraction: held / DAY_MS, usual: Number.isFinite(usual) ? usual : fallback });
  }
  let weights = parts.map((p) => p.fraction * p.usual);
  let total = weights.reduce((a, b) => a + b, 0);
  if (!(total > 0)) {
    // The profile says nothing is used on these days, and something was: by time held, then.
    weights = parts.map((p) => p.fraction);
    total = weights.reduce((a, b) => a + b, 0);
  }
  const target = Math.round(kwh * 1000);
  const milli = weights.map((w) => Math.round((target * w) / total));
  const largest = milli.indexOf(Math.max(...milli));
  milli[largest] += target - milli.reduce((a, b) => a + b, 0);
  return parts.map((p, i) => ({ day: p.day, kwh: milli[i] / 1000 })).filter((p) => p.kwh > 0);
}

/**
 * What one ended hold left uncounted, from the meter's own readings around it.
 *
 * `rows` are the device's readings from the hold's start to a little after it ended, oldest first. The held
 * reading is the first; the recovery is the first whose lifetime register differs. When the recovery falls on a
 * later day than the hold began, that day's own register (`energy_kwh_today`) already counts its part, so the
 * step less that is spread over the held days before it.
 *
 * @returns {{ ok: true, kwh: number, fromMs: number, toMs: number, stepKwh: number, recoveredAt: string }
 *   | { ok: false, reason: 'no-readings'|'no-recovery'|'implausible'|'nothing-to-spread', stepKwh?: number }}
 */
export function heldStep(rows, { fromMs, offsetMinutes, maxW = MAX_BRANCH_W }) {
  const list = rows.filter((r) => r.online !== false && Number.isFinite(r.total_energy_kwh));
  if (list.length === 0) return { ok: false, reason: 'no-readings' };
  const held = list[0];
  const after = list.find((r) => r.total_energy_kwh !== held.total_energy_kwh);
  if (!after) return { ok: false, reason: 'no-recovery' };
  const afterMs = Date.parse(after.ts);
  const stepKwh = after.total_energy_kwh - held.total_energy_kwh;
  if (!(stepKwh >= 0) || stepKwh > (maxW * Math.max(0, afterMs - fromMs)) / KWH_MS_PER_W) {
    return { ok: false, reason: 'implausible', stepKwh };
  }
  const recoveryDay = dayStartMs(afterMs, offsetMinutes);
  const todayAfter = Number.isFinite(after.energy_kwh_today) ? after.energy_kwh_today : 0;
  const todayHeld = Number.isFinite(held.energy_kwh_today) ? held.energy_kwh_today : 0;
  const [counted, toMs] = recoveryDay > fromMs ? [todayAfter, recoveryDay] : [Math.max(0, todayAfter - todayHeld), afterMs];
  const kwh = Math.round((stepKwh - counted) * 1000) / 1000;
  if (!(kwh >= 0.001)) return { ok: false, reason: 'nothing-to-spread', stepKwh };
  return { ok: true, kwh, fromMs, toMs, stepKwh, recoveredAt: after.ts };
}

/**
 * The estimate rows for one ended hold, as `energy_estimates` stores them (`supabase/phase57_energy_estimates.sql`).
 */
export function estimateRows({ siteId, deviceId, frozenSince, step, profile, offsetMinutes }) {
  const basis = `meter held from ${frozenSince} to ${step.recoveredAt}; its lifetime register rose ${step.stepKwh.toFixed(3)} kWh across the hold, `
    + `${step.kwh.toFixed(3)} kWh of it before the recovery day, spread by its usual weekday and weekend use`;
  return spreadHeldEnergy({ kwh: step.kwh, fromMs: step.fromMs, toMs: step.toMs, profile, offsetMinutes }).map((p) => ({
    site_id: siteId,
    device_id: deviceId,
    local_day: p.day,
    held_from: frozenSince,
    held_to: step.recoveredAt,
    kwh: p.kwh,
    basis,
  }));
}

/** How long after a hold's end the recovery reading is looked for. */
const RECOVERY_WINDOW_MS = 30 * 60_000;

/**
 * One ended hold, from the archive to estimate rows: the readings across it for the step, the healthy days
 * before it for the profile. `archive` is `server/archiveDb.mjs`'s handle (only `rowsBetween` is used).
 *
 * @returns {{ rows: object[], step: ReturnType<typeof heldStep> }}
 */
export function estimateHold(archive, { siteId, deviceId, frozenSince, endedAtMs, offsetMinutes }) {
  const stillFrom = Date.parse(frozenSince);
  const held = [...archive.rowsBetween('readings', { sinceMs: stillFrom, untilMs: endedAtMs + RECOVERY_WINDOW_MS, deviceId })];
  const fromMs = registerStoppedAt(archive, deviceId, stillFrom, held[0]?.total_energy_kwh);
  const step = heldStep(held, { fromMs, offsetMinutes });
  if (!step.ok) return { rows: [], step };
  const profile = dailyProfile(archive.rowsBetween('readings', { sinceMs: dayStartMs(fromMs, offsetMinutes) - PROFILE_DAYS * DAY_MS, untilMs: dayStartMs(fromMs, offsetMinutes), deviceId }), offsetMinutes);
  // Keyed by the still stretch's start, which is what the bridge and the backfill both name the hold by.
  return { rows: estimateRows({ siteId, deviceId, frozenSince, step, profile, offsetMinutes }), step };
}

/**
 * Every ended hold of `meters` since `sinceMs`, estimated — for `server/held-energy-backfill.mjs`. A hold is a
 * still stretch (`frozenStretches`); one whose held figure stepped (CARE ACU's 15.5 -> 15.8 W) shows up as two
 * stretches back to back, so stretches that follow each other within `STRETCH_JOIN_MS` are one hold. A stretch
 * starting before the previous estimate's recovery is the same hold too, and is skipped. `already` holds
 * `device_id|held_from` keys estimated before, which are not made again.
 */
/** Stretches this close are one hold whose held figure stepped: the next held reading followed the last. */
const STRETCH_JOIN_MS = 15 * 60_000;

function joinStretches(stretches) {
  const out = [];
  for (const s of stretches) {
    const last = out[out.length - 1];
    if (last && Date.parse(s.frozenSince) - Date.parse(last.toTs) <= STRETCH_JOIN_MS) last.toTs = s.toTs;
    else out.push({ frozenSince: s.frozenSince, toTs: s.toTs });
  }
  return out;
}

export function findHoldEstimates(archive, { meters, sinceMs, untilMs, siteId, offsetMinutes, stillAfterMs, frozenStretches, already = new Set() }) {
  const holds = [];
  for (const deviceId of meters) {
    const rows = [...archive.rowsBetween('readings', { sinceMs, untilMs, deviceId })];
    let coveredUntil = -Infinity;
    for (const s of joinStretches(frozenStretches(rows, { stillAfterMs }))) {
      const fromMs = Date.parse(s.frozenSince);
      if (fromMs < coveredUntil) continue;
      const frozenSince = new Date(fromMs).toISOString();
      if (already.has(`${deviceId}|${frozenSince}`)) {
        holds.push({ deviceId, frozenSince, toTs: s.toTs, skipped: 'estimated before', rows: [] });
        continue;
      }
      const { rows: est, step } = estimateHold(archive, { siteId, deviceId, frozenSince, endedAtMs: Date.parse(s.toTs), offsetMinutes });
      if (step.ok) coveredUntil = Date.parse(step.recoveredAt);
      holds.push({ deviceId, frozenSince, toTs: s.toTs, step, rows: est });
    }
  }
  return holds;
}
