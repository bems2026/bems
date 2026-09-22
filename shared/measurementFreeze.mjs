/**
 * RM-079 — how long a metered device's measurement may hold byte-identical, while it draws power
 * and reports online, before it is called frozen.
 *
 * WHY THERE IS SUCH A THING. On 2026-09-12 L.O Red repeated 19.1 W / 228.2 V / 0.576 A from 06:00
 * to 20:59 while both of its own energy registers stood still, and it stayed `online: true` because
 * it kept sending messages. The legacy integrator multiplied the held watts by the hours, and the
 * page accused the bridge of losing 100 % of that branch's energy (ROADMAP RM-077).
 *
 * WHY THREE HOURS, measured rather than chosen — and measured twice. Over the seven days to
 * 2026-09-14, across all eleven metered devices, healthy identical runs reached 61 minutes: the
 * outlets refresh power, voltage and current about once an hour, and co1 held 60 minutes or more
 * nineteen times. None reached 120. The faults were 540, 657 and 942 minutes. Three hours is about
 * 3x the longest healthy run and under a third of the shortest fault. The first version was one
 * hour, sized on the four meters alone, and it called two healthy outlets frozen on live data the
 * same day.
 *
 * SHARED because two things must agree on it: the bridge, which flags a live reading
 * (`buildLatest`'s `measurement_frozen`), and the frontend, which finds the same stretch in history
 * (`src/lib/timeseries.ts`, whose sample count is pinned against this by a test).
 */
export const FROZEN_AFTER_MS = 3 * 60 * 60 * 1000;

/**
 * RM-133 — the second, faster rule: a channel's OWN energy register that does not move while the
 * reading says the channel draws power. Found on 2026-09-22: the yellow meter's channel 2 held
 * 39.8 W / 0.446 A from 07:43:49 with `today_acc_energy2` still for hours, and from 10:58 its voltage
 * dp followed channel 1's. The voltage is ONE measurement shared by both clamps, so it restarted the
 * three-hour v/c/p clock every minute and the flag above could never stand. A shared voltage is not
 * evidence that a clamp is measuring. The register is.
 *
 * WHAT THE FLAG MEANS, corrected by RM-134: the held reading and the device's own register disagree.
 * That day it was not the clamp. The lights went off while the Pi was rebooting, the meter's one push
 * of "0 W" reached nobody, and nothing polled the meters, so the bridge kept the last pushed value
 * while the register correctly stood still. With the meters polled every minute, a stale value clears
 * within a minute and never reaches this rule's half hour. A flag that stands is a value the device
 * itself keeps re-reporting.
 *
 * WHY HALF AN HOUR AND FIVE THOUSANDTHS. The registers count in 0.001 kWh and the meters report
 * them on change, about once a minute under load (C.O Yellow's rose every minute at 850 W; L.O
 * Red's every two at 30 W). The rule fires only when the window is long enough for reporting
 * cadence not to matter AND the power drawn over it owed the counter at least five ticks — so at
 * 10 W the window is the full thirty minutes, and at 3 W it takes an hour. An idle channel owes
 * nothing and is never stalled, which is the same idle exemption the value rule has.
 *
 * Only a channel's own registers count (`today_acc_energy<n>`, `total_energy<n>`): the dual-channel
 * meter's `all_energy` is the sum of both clamps and moves with the healthy one.
 */
export const REGISTER_STALL = Object.freeze({ afterMs: 30 * 60 * 1000, minKwh: 0.005 });

/** Pure. Has this channel's register been still for long enough, at this power, to be a freeze? */
export function registerStalled({ powerW, stalledMs }, rule = REGISTER_STALL) {
  if (!(powerW > 0) || !(stalledMs >= rule.afterMs)) return false;
  return (powerW * stalledMs) / 3.6e9 >= rule.minKwh;
}
