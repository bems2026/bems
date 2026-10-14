/**
 * Stretches in which a meter repeated every measured value — RM-163, 2026-10-14.
 *
 * WHY. With the site offline from 7 to 14 October the four CT meters went on answering the flow's poll
 * with identical figures for 2.5 to 6 days: CO Yellow at 261.3 W and one voltage for 130 hours, L.O Red
 * and L.O Yellow at 0 W for 141 hours (E-256). The live freeze rule (`shared/buildLatest.mjs`) fires only
 * above 0 W, by design, so the two idle ones were stored as real readings. This finds such stretches
 * afterwards, on the archive, so they can be marked before they reach the cloud and the reports.
 *
 * THE RULE. Over a device's ONLINE readings in time order: a stretch is consecutive readings whose voltage,
 * current, power and both energy registers are all exactly equal. It counts as frozen when it lasts at
 * least `stillAfterMs`. Voltage is the decisive one: a live circuit's voltage moves by tenths of a volt from
 * minute to minute whatever the load, so a meter holding it for hours is reading a cache, not the mains.
 * The threshold starts at 12 hours, above the longest stillness any meter showed while healthy (L.O Red,
 * 535 minutes, from 30 Sep to 7 Oct); it is a parameter so it can be tightened once the meters report live.
 *
 * The first reading of a stretch is a real measurement — the value was fresh then — so flagging starts at
 * the first repeat, and `frozenSince` is the first reading's time, as the bridge's own `frozen_since` is.
 * An offline reading neither breaks nor extends a stretch; a reading missing any value breaks it.
 */

// One threshold for the live rule (shared/buildLatest.mjs) and this correction.
import { STILL_AFTER_MS } from '../shared/measurementFreeze.mjs';

export { STILL_AFTER_MS };

const MEASURED = ['voltage', 'current', 'power_w', 'energy_kwh_today', 'total_energy_kwh'];

/**
 * @param {Array<{ ts: string, online: boolean, voltage: number|null, current: number|null, power_w: number|null,
 *   energy_kwh_today?: number|null, total_energy_kwh?: number|null }>} rows  one device, oldest first
 * @param {{ stillAfterMs?: number }} [opts]
 * @returns {Array<{ frozenSince: string, fromTs: string, toTs: string, rows: number }>}
 */
export function frozenStretches(rows, { stillAfterMs = STILL_AFTER_MS } = {}) {
  const out = [];
  let run = null; // { key, first, last, repeats }

  const close = () => {
    if (run && run.repeats > 0 && Date.parse(run.last.ts) - Date.parse(run.first.ts) >= stillAfterMs) {
      out.push({ frozenSince: run.first.ts, fromTs: run.firstRepeat.ts, toTs: run.last.ts, rows: run.repeats });
    }
    run = null;
  };

  for (const r of rows) {
    if (!r || r.online === false) continue;
    if (r.voltage === null || r.voltage === undefined || r.power_w === null || r.power_w === undefined) { close(); continue; }
    const key = MEASURED.map((k) => (r[k] === undefined ? null : r[k])).join('|');
    if (run && run.key === key) {
      run.repeats += 1;
      if (!run.firstRepeat) run.firstRepeat = r;
      run.last = r;
      continue;
    }
    close();
    run = { key, first: r, firstRepeat: null, last: r, repeats: 0 };
  }
  close();
  return out;
}
