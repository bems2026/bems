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
