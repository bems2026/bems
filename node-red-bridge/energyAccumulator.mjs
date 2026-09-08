/**
 * Per-device week and month energy — the running bases the browser's "By branch" split is
 * built from, one completed day at a time.
 *
 * WHY IT IS A MODULE NOW. It lived as a string constant in `build-flow.mjs` and nothing could
 * execute it, so it carried two faults for as long as it existed. Both were found on the live
 * bridge on 2026-09-08 by reading `enacc_*` out of flow context and doing the arithmetic by
 * hand; neither would have survived a test that ran the code. Same move, and same reasoning, as
 * `energyDayBase.mjs` and `arrivalTracker.mjs`: what ships is the string, so the test must run
 * the string.
 *
 * FAULT 1 — an offset the counter acquired mid-day was banked whole. `mtr_lo_yellow`'s
 * channel-2 register was baselined correctly at local midnight, climbed to 0.111 kWh, then read
 * 67.391 at 02:36 local while the circuit drew 49.1 W, and 77.317 ten minutes later. Repairing
 * `energy_day_base` dropped the published daily figure back to 0.301 — and the old
 * "counter went backwards, so bank what it reached" rule read THAT as a completed run and
 * folded 77.502 kWh into both bases. The week then served 79.278 kWh against a real 1.5, which
 * is 80 % of a four-branch split. The same 77.502 would have folded at the next local midnight
 * even if nobody had touched it; the correction changed when, not whether.
 *
 * WHY THIS IS WORSE THAN A BAD DAILY FIGURE, and why the guard belongs here as well as in
 * `energyDayBase.mjs`: a wrong `energy_kwh_today` is transient — the next local midnight
 * re-anchors it and the dashboard heals itself. A wrong `weekBase` is durable. It is a number
 * this system wrote down, and nothing recomputes it. L.O Yellow's daily figure was correct
 * within hours of the fault and its week was still wrong a day later.
 *
 * So this accrues from BOUNDED INCREMENTS and never from an absolute it has not bounded. A
 * counter that advances by more than `maxBranchKw` × the elapsed time did not measure
 * electricity, it acquired an offset, and an offset is not banked. Increments arriving on TOP
 * of a bogus offset still are — the register kept counting real watt-hours either side of its
 * jump, and refusing those would trade an over-count for an under-count.
 *
 * FAULT 2 — found while tracing the first, and off by exactly one day on every device at every
 * boundary. The period keys were rolled BEFORE the completed day was folded, so the day that
 * ended a week was zeroed out of that week and then added to the next one. Measured:
 * `mtr_co_yellow`'s `weekBase` read 9.720 = Monday's 8.165 + Sunday's 1.555, exactly, and
 * `mtr_lo_yellow`'s 1.475 = 1.236 + 0.238 likewise. Folding first and rolling after is the
 * whole fix: a completed day belongs to the week and month it ended in.
 *
 * WHAT IS DELIBERATELY GIVEN UP. At a day rollover the new day starts from zero rather than
 * from whatever the counter reads, because at that one moment a lagging counter still carries
 * the old day and adopting it would fold the day twice. The cost is the energy drawn between
 * local midnight and the first poll after it — at most one sample interval, tens of seconds.
 * Under-counting a sliver is the safe direction; the fault above is what over-counting looks
 * like.
 *
 * The building's own `bems_energy_week`/`bems_energy_month` come from the legacy flow and are
 * not touched here — see `EnergySection.tsx`, which says why the two need not agree exactly.
 *
 * NOTE: like the history ring and the day baselines, this is only durable if `settings.js`
 * enables `contextStorage.localfilesystem`.
 */

/**
 * @param {number} offsetMinutes minutes east of UTC for the site — `SITE.utc_offset_minutes`.
 *        Substituted at build time rather than read at run time because the function node has
 *        no imports and no guaranteed full-ICU build.
 * @param {number} [maxBranchKw] the most a single branch here can draw, in kW — from
 *        `SITE.telemetry_bounds.power_w.max`. The rate ceiling. Same value, same reason, as
 *        `energyDayBaseSrc`; the default reproduces this site's for a caller that omits it.
 */
export const energyAccumulatorSrc = (offsetMinutes, maxBranchKw = 25) => `
const rows = Array.isArray(msg.payload) ? msg.payload : [];
// Local wall-clock at the site's own UTC offset, matching iso8() — a UTC day boundary would
// fold the previous day in partway through the local morning, attributing hours to the wrong day.
const now = new Date(Date.now() + ${offsetMinutes} * 60000);
const y = now.getUTCFullYear();
const dayKey = y + '-' + (now.getUTCMonth() + 1) + '-' + now.getUTCDate();
const monthKey = y + '-' + (now.getUTCMonth() + 1);
// ISO-ish week key: Monday-start, identified by the Monday's own date.
const dow = (now.getUTCDay() + 6) % 7; // 0 = Monday
const monday = new Date(now.getTime() - dow * 86400000);
const weekKey = monday.getUTCFullYear() + '-' + (monday.getUTCMonth() + 1) + '-' + monday.getUTCDate();
// How much of the local day has elapsed. No branch can have drawn more than its maximum for
// this long, which is the ceiling every path that adopts an absolute is held to.
const dayHours = (now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds()) / 3600;
const CEILING = ${maxBranchKw} * dayHours;

for (const r of rows) {
  if (r.device_id === '_totals') continue;
  const val = r.energy_kwh_today;
  if (typeof val !== 'number' || !isFinite(val) || val < 0) continue;
  const key = 'enacc_' + r.device_id;
  const a = flow.get(key) || {
    lastToday: 0, weekBase: 0, monthBase: 0,
    weekKey: weekKey, monthKey: monthKey, dayKey: dayKey,
    // First sight adopts the day already in progress, so enrolling a device or deploying at
    // noon does not reset a visible figure to zero. The ceiling below still bounds it.
    banked: val, at: 0,
  };
  // An accumulator stored by an older build has no 'banked'; 'lastToday' was the same quantity.
  if (typeof a.banked !== 'number' || !isFinite(a.banked)) a.banked = a.lastToday;

  if (a.dayKey !== dayKey) {
    // The day we were tracking has ended. Fold BEFORE rolling the period keys below.
    a.weekBase += a.banked;
    a.monthBase += a.banked;
    a.dayKey = dayKey;
    a.banked = 0;
    a.at = 0;
  } else if (val < a.lastToday) {
    // The counter went backwards inside the day. Two different things look like this: a device
    // reboot or Tuya-side reset, where what it had reached is real consumption that must be
    // banked before the register starts again; and a corrected baseline, where the new figure
    // SUPERSEDES the old one and banking it would double-count. Banking the excess of what we
    // had accrued over what is now reported settles both — a reset banks nearly all of it, a
    // correction banks none.
    a.weekBase += Math.max(0, a.banked - val);
    a.monthBase += Math.max(0, a.banked - val);
    a.banked = val;
  } else if (a.at) {
    // THE RATE CHECK. An increment larger than the branch could physically have drawn in the
    // elapsed time is an offset the counter acquired, not electricity anybody used.
    const hours = (Date.now() - a.at) / 3600000;
    const delta = val - a.lastToday;
    if (hours > 0 && delta <= ${maxBranchKw} * hours) a.banked += delta;
  }

  // Roll the period keys only now, so the fold above landed in the period it belonged to.
  if (a.weekKey !== weekKey) { a.weekBase = 0; a.weekKey = weekKey; }
  if (a.monthKey !== monthKey) { a.monthBase = 0; a.monthKey = monthKey; }

  if (a.banked > CEILING) a.banked = CEILING;
  a.lastToday = val;
  a.at = Date.now();
  flow.set(key, a);
}
return null;`;

/**
 * Runs the accumulator against a fake flow context, for tests.
 *
 * `nowMs` is injected by overriding `Date.now` for the duration of the call rather than by
 * threading a parameter into the source, so the thing under test is byte-identical to the
 * thing that ships — same approach as `runEnergyDayBase`.
 */
export function runEnergyAccumulator(store, rows, nowMs, offsetMinutes = 480, maxBranchKw = 25) {
  const fn = new Function('flow', 'msg', energyAccumulatorSrc(offsetMinutes, maxBranchKw));
  const flow = { get: (k) => store[k], set: (k, v) => { store[k] = v; } };
  const realNow = Date.now;
  if (typeof nowMs === 'number') Date.now = () => nowMs;
  try {
    fn(flow, { payload: rows });
  } finally {
    Date.now = realNow;
  }
  return store;
}
