/**
 * Corrects the bridge's own copies of a HELD reading — pure, so the dry run and the apply compute the same
 * thing (RM-136). The sibling of `server/scrubHeldReading.mjs`, which corrects the stored rows.
 *
 * WHY. RM-134 found L.O Yellow held 39.8 W from 07:43 to 14:21 on 2026-09-22 because nothing re-read the
 * meter; `scrub:held` restated the 396 stored rows. Node-RED keeps two more copies in flow context, and the
 * page reads both:
 *   - the 24 h history ring (`hist_<device>`, bridge tab) — so the page still named the hold as a freeze;
 *   - the legacy two-second integrator (`<ctx>_energy`, and the building's `bems_energy_today/week/month`,
 *     Energy tab), which multiplied the held watts by the hours. The page subtracts that from its second
 *     opinion only for a hold it can find in the ring.
 * So they are corrected TOGETHER. Cleaning the ring alone brings back "reporting less than it measured";
 * correcting the integrator alone leaves the hold named and subtracts it twice.
 *
 * WHAT IS WRITTEN. In the ring, each sample inside the window that repeats the held reading becomes
 * 0 W / 0 A and loses the bridge's `frozen` flag; its voltage and `online` stay as they were (the evidence
 * that it was 0 W is the meter's register, as in `scrubHeldReading.mjs`). From each integrator that counted
 * it, the PHANTOM is removed: the held power over the time the integrator ran — the gaps between held samples
 * that were online (the integrator skips a branch whose health is false), each capped like the parsers'
 * own gap rule, and nothing for the last sample's own interval. That errs on removing too little, never too
 * much. Nothing else moves.
 */
import { MAX_INTEGRATION_GAP_MS } from './dpParserPlan.mjs';

/** The legacy integrators on the Energy tab that add every branch's power, besides the branch's own. */
export const BUILDING_INTEGRATORS = Object.freeze(['bems_energy_today', 'bems_energy_week', 'bems_energy_month']);

const tsOf = (s) => Date.parse(s?.sample_ts ?? s?.ts);

/**
 * @param {{ ring: object[], energy: Record<string, number>, ctx: string, fromMs: number, toMs: number }} args
 * @returns {{ refused: string|null, ring: object[], energy: Record<string, number>, changed: number,
 *             phantomKwh: number, held: {power_w:number, current:number}|null, integrators: string[] }}
 */
export function planHeldContextRepair({ ring, energy, ctx, fromMs, toMs }) {
  const none = (why) => ({ refused: why, ring, energy, changed: 0, phantomKwh: 0, held: null, integrators: [] });
  const inWindow = (ring ?? [])
    .map((s, i) => ({ s, i, t: tsOf(s) }))
    .filter((x) => Number.isFinite(x.t) && x.t >= fromMs && x.t <= toMs)
    .sort((a, b) => a.t - b.t);
  const first = inWindow.find((x) => Number(x.s.power_w) > 0);
  if (!first) return none('no held reading in the window — nothing above 0 W to correct');
  const held = { power_w: Number(first.s.power_w), current: Number(first.s.current) };
  const stray = inWindow.find((x) => Number(x.s.power_w) !== held.power_w || Number(x.s.current) !== held.current);
  if (stray) {
    return none(`the window is not one held reading: ${stray.s.power_w} W / ${stray.s.current} A at ${new Date(stray.t).toISOString()} against ${held.power_w} W / ${held.current} A`);
  }

  let integratedMs = 0;
  for (let k = 0; k < inWindow.length - 1; k++) {
    if (inWindow[k].s.online === false) continue;
    integratedMs += Math.min(inWindow[k + 1].t - inWindow[k].t, MAX_INTEGRATION_GAP_MS);
  }
  const phantomKwh = (held.power_w * integratedMs) / 3.6e9;

  const keys = [`${ctx}_energy`, ...BUILDING_INTEGRATORS].filter((k) => energy && energy[k] !== undefined);
  const next = { ...energy };
  for (const k of keys) {
    const v = Number(energy[k]);
    if (!Number.isFinite(v) || v < phantomKwh) {
      return none(`${k} is ${energy[k]}, less than the ${phantomKwh.toFixed(4)} kWh to remove — it cannot have counted this hold`);
    }
    next[k] = v - phantomKwh;
  }

  const indices = new Set(inWindow.map((x) => x.i));
  const nextRing = ring.map((s, i) => {
    if (!indices.has(i)) return s;
    const { frozen, ...rest } = s;
    return { ...rest, power_w: 0, current: 0 };
  });
  return { refused: null, ring: nextRing, energy: next, changed: indices.size, phantomKwh, held, integrators: keys };
}
