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
 * RE-ANCHORING HAPPENS ON THREE EVENTS, and all three are necessary:
 *   - the local day rolls over, at the site's own offset (a UTC boundary would fold the previous
 *     day in partway through the local morning);
 *   - the counter goes BACKWARDS, which is a device-side reset or a reboot. Whatever the cause,
 *     today's figure may not go negative;
 *   - the counter goes FORWARD faster than the branch could physically draw. Measured on the
 *     live meter 2026-09-08: the channel-2 register was baselined correctly at local midnight
 *     when it read 0, climbed normally to 0.111 kWh, then reported **67.391 at 18:36 while the
 *     circuit drew 49.1 W**, and 77.317 ten minutes later. The baseline was right and the
 *     counter acquired an offset in the middle of the day, so `val - base` carried it straight
 *     through — 77.5 kWh on a circuit whose whole day integrates to 0.302.
 *
 * THE THIRD ONE SLIPPED UNDER THE EXISTING BACKSTOP, which is why a rate is needed rather than a
 * larger bound. `max_branch_kwh_per_day` is 100, so `buildLatest` did not reject 77.5 — while the
 * SAME meter's channel 1 jumped to 3,676 the same day, was rejected, fell back to the integrated
 * value and read correctly throughout. A bound wide enough to be safe cannot catch a value that
 * is merely wrong; a bound on how fast it may change can, because no branch here can draw more
 * than `telemetry_bounds.power_w.max` and therefore none can add more kW-hours than that in an
 * hour. The jump is absorbed into the baseline rather than rejected, so the published figure
 * stays continuous across it — the same courtesy the first-sight seeding pays.
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
 * @param {number} [maxBranchKw] the most a single branch here can draw, in kW — from
 *        `SITE.telemetry_bounds.power_w.max`. Threaded in for the same reason. It is the RATE
 *        ceiling above; the default reproduces this site's value for a caller that omits it.
 */
export const energyDayBaseSrc = (offsetMinutes, maxBranchKw = 25) => `
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
    // THE RATE CHECK. A counter that advanced by more than the branch could physically draw in
    // the elapsed time did not measure electricity — it acquired an offset. Absorb the excess
    // into the baseline so today's published figure carries straight on, and so the counter's
    // own subsequent increments still count.
    const seen = entry.seen || {};
    const before = seen[code];
    if (before !== undefined && isFinite(val) && val > before.val) {
      const hours = (Date.now() - before.at) / 3600000;
      // A non-positive or absent span cannot bound anything; allow it and wait for the next tick.
      const ceiling = hours > 0 ? ${maxBranchKw} * hours : Infinity;
      if (val - before.val > ceiling) {
        const bumped = entry.base[code];
        entry.base[code] = (bumped === undefined ? 0 : bumped) + (val - before.val);
      }
    }
    seen[code] = { val: val, at: Date.now() };
    entry.seen = seen;

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
export function runEnergyDayBase(store, snapshot, nowMs, offsetMinutes = 480, maxBranchKw = 25) {
  const fn = new Function('flow', 'msg', energyDayBaseSrc(offsetMinutes, maxBranchKw));
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
