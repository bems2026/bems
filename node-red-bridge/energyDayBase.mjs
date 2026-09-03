/**
 * Where each CT meter's daily energy counter STOOD when the local day began — the subtrahend
 * that turns `today_acc_energy` from an absolute into an increment.
 *
 * WHY IT EXISTS, measured on the live meter 2026-09-03. `658d7c2` started publishing each
 * meter's own `today_acc_energy<channel>` instead of the value integrated from watts, because
 * the device's figure is the better measurement — integration compounds a dead meter's last
 * wattage, which is the corruption fixed in Aug 2026. That was right about the source and wrong
 * about the arithmetic: it assumed every channel's counter resets at midnight, and one does not.
 *
 * One physical dual-channel meter backs `mtr_co_yellow` and `mtr_lo_yellow`. Its channel-1
 * register reset normally and read 3.477 kWh. Its channel-2 register read 3625.021 kWh and was
 * incrementing correctly on top of that offset — a ~3,625 kWh figure for a circuit that averages
 * 36 W. The dashboard showed it, `readings` stored it, and `enacc_mtr_lo_yellow` had banked
 * 3625.011 ready to fold into the week at the next local midnight.
 *
 * So: a daily counter is trustworthy as an INCREMENT and not as an ABSOLUTE, and nothing in this
 * system can tell the two apart without remembering where the day started. That is all this
 * node does.
 *
 * THE ANCHOR IS SEEDED FROM THE INTEGRATED VALUE, not from zero. A baseline established mid-day
 * would otherwise reset the published figure to 0 and lose the morning — visibly, on a dashboard
 * somebody is watching, every time this deploys or a device is enrolled. Seeding with
 * `counter - integrated` makes the first reading after a change equal to the last one before it.
 *
 * RE-ANCHORING HAPPENS ON TWO EVENTS, and both are necessary:
 *   - the local day rolls over, at the site's own offset (a UTC boundary would fold the previous
 *     day in partway through the local morning);
 *   - the counter goes BACKWARDS, which is a device-side reset or a reboot. Whatever the cause,
 *     today's figure may not go negative.
 *
 * Runs BEFORE `buildLatest`, on the same snapshot, so there is no one-tick lag between a counter
 * arriving and its baseline being known — unlike `snap.energyAcc`, which is a pass behind by
 * construction because it consumes the built rows.
 *
 * Kept as a source string because it is injected verbatim into a Node-RED function node, and
 * exported as a builder so `energy-day-base.test.mjs` can EXECUTE it rather than pattern-match
 * against it. Same reasoning as `arrivalTracker.mjs`: what ships is the string.
 *
 * NOTE: like the history ring and the week/month accumulator, this is only durable if
 * `settings.js` enables `contextStorage.localfilesystem`. Without it a restart wipes every
 * baseline, and the seeding rule above is what keeps that from showing up as a cliff.
 */

/** Prefix of every per-channel daily counter this fleet's CT meters report. */
export const DAILY_COUNTER_PREFIX = 'today_acc_energy';

/**
 * @param {number} offsetMinutes minutes east of UTC for the site — `SITE.utc_offset_minutes`.
 *        Substituted at build time rather than read at run time, exactly as `ACCUMULATE_ENERGY`
 *        does, because the function node has no imports and no guaranteed full-ICU build.
 */
export const energyDayBaseSrc = (offsetMinutes) => `
const now = new Date(Date.now() + ${offsetMinutes} * 60000);
const dayKey = now.getUTCFullYear() + '-' + (now.getUTCMonth() + 1) + '-' + now.getUTCDate();
const store = flow.get('energy_day_base') || {};
const meters = ((msg.snapshot || {}).energy || {}).meters || {};
const out = {};
for (const k of Object.keys(meters)) {
  const m = meters[k] || {};
  const dp = m.dp;
  // A meter whose parser has not decoded anything yet has no counter to baseline. Skipping it
  // leaves buildLatest on the integrated value, which is the pre-2026-09-03 behaviour.
  if (!dp || typeof dp !== 'object') continue;
  let entry = store[k];
  if (!entry || entry.dayKey !== dayKey) entry = { dayKey: dayKey, base: {} };
  const integrated = Number(m.e);
  for (const code of Object.keys(dp)) {
    if (code.indexOf('${DAILY_COUNTER_PREFIX}') !== 0) continue;
    const val = Number(dp[code]);
    if (!isFinite(val)) continue;
    const prev = entry.base[code];
    if (prev === undefined || val < prev) {
      // Seed from the integrated figure so the published value does not jump. Refuse a seed that
      // would make the baseline negative or the counter look smaller than it is.
      entry.base[code] = isFinite(integrated) && integrated >= 0 && integrated <= val
        ? val - integrated
        : val;
    }
  }
  store[k] = entry;
  out[k] = entry.base;
}
flow.set('energy_day_base', store);
msg.snapshot = msg.snapshot || {};
msg.snapshot.energyDayBase = out;
return msg;`;

/**
 * Runs the tracker against a fake flow context, for tests.
 *
 * `nowMs` is injected by overriding `Date.now` for the duration of the call rather than by
 * threading a parameter into the source, so the thing under test is byte-identical to the thing
 * that ships.
 */
export function runEnergyDayBase(store, snapshot, nowMs, offsetMinutes = 480) {
  const fn = new Function('flow', 'msg', energyDayBaseSrc(offsetMinutes));
  const flow = { get: (k) => store[k], set: (k, v) => { store[k] = v; } };
  const msg = { snapshot };
  const realNow = Date.now;
  if (typeof nowMs === 'number') Date.now = () => nowMs;
  try {
    return fn(flow, msg).snapshot.energyDayBase;
  } finally {
    Date.now = realNow;
  }
}
