/**
 * The plan for correcting stored rows that carry a HELD reading — pure, so the dry run and the apply
 * compute the same thing and `scrubHeldReading.test.mjs` can hold it to a fixture (RM-134).
 *
 * WHAT A HELD READING IS. The tuya node never reads a device's state on connect, and until RM-134
 * nothing polled the meters. On 2026-09-22 the lights on L.O Yellow went off in the power cut at
 * ~07:44, while the Pi was down; the meter's push of "0 W" reached nobody, a channel at 0 W had
 * nothing new to push, and the bridge kept its last figure, 39.8 W / 0.446 A, in persisted context.
 * The ingest daemon stored it every minute for six and a half hours. The first poll read 0 W / 0 A.
 *
 * THE EVIDENCE, AND WHY ZERO IS DEFENSIBLE. The device's own register for that channel is the
 * witness: from the last genuine report (`start`) to the first re-read (`fresh`) it rose by
 * `delta_kwh`, so the channel's AVERAGE power over the window is at most `bound_w`. Only when that
 * bound is under `MAX_BOUND_W` AND the device itself reads 0 W / 0 A on re-read is zero written — a
 * circuit that consumed a watt-hour or two in six hours was, to the resolution anyone charts, off.
 * The bound is stamped on every row so a reader can see how strong the claim is. Otherwise: refuse.
 *
 * WHAT IS WRITTEN. `power_w` and `current` become 0; the voltage becomes the SIBLING channel's at the
 * same instant (one voltage measurement serves both clamps of the dual meter), or null where there is
 * none; the channel's capability codes follow; `device_state<n>` becomes what the device reported on
 * re-read; the freeze flag goes (a corrected row is not a frozen one); and `capabilities.scrub` says
 * what was done and on what evidence. `energy_kwh_today` is NOT written: it came from the register,
 * which was right all along. `online` is carried unchanged because PostgREST's upsert checks the
 * INSERT tuple's NOT NULL constraints before the conflict path (23502, RM-123).
 */

/** The columns every update carries — the same keys on every row, as a bulk upsert requires. */
export const HELD_COLUMNS = Object.freeze(['device_id', 'ts', 'voltage', 'current', 'power_w', 'online', 'capabilities']);

/** The highest average power, over the window, that the register may allow before zero is refused. */
export const MAX_BOUND_W = 1;

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const same = (a, b) => a !== null && b !== null && Math.abs(a - b) < 1e-9;
const regOf = (r, code) => num(r?.capabilities?.[code]);

/**
 * @param {{ start: object, rows: object[], fresh: object, siblings: object[],
 *           codes: { power: string, current: string, voltage: string, state: string, register: string },
 *           siblingId: string|null, at: string }} args
 * @returns {{ refused: string|null, updates: object[], evidence: object|null }}
 */
export function planHeldScrub({ start, rows, fresh, siblings = [], codes, siblingId = null, at }) {
  const refuse = (why) => ({ refused: why, updates: [], evidence: null });
  if (!rows?.length) return refuse('no rows between the last genuine report and the first re-read');

  const heldP = num(start?.power_w);
  const heldC = num(start?.current);
  const regFrom = regOf(start, codes.register);
  const regTo = regOf(fresh, codes.register);
  if (heldP === null || heldC === null) return refuse('the start row carries no reading to call held');
  if (regFrom === null || regTo === null) return refuse(`the register ${codes.register} is missing at an end of the window`);

  for (const r of rows) {
    if (!same(num(r.power_w), heldP) || !same(num(r.current), heldC)) {
      return refuse(`row ${r.ts} is not the held reading (${r.power_w} W / ${r.current} A against ${heldP} W / ${heldC} A)`);
    }
    if (!same(regOf(r, codes.register), regFrom)) return refuse(`row ${r.ts} carries a different register than the hold began with`);
  }

  if (num(fresh?.power_w) !== 0 || num(fresh?.current) !== 0) {
    return refuse(`the fresh reading is ${fresh?.power_w} W / ${fresh?.current} A, not 0 W / 0 A — nothing says the window was at zero`);
  }

  const hours = (Date.parse(fresh.ts) - Date.parse(start.ts)) / 3.6e6;
  const deltaKwh = Math.round((regTo - regFrom) * 1e6) / 1e6;
  if (!(hours > 0)) return refuse('the fresh reading is not after the start of the hold');
  if (deltaKwh < 0) return refuse(`the register went backwards (${regFrom} -> ${regTo})`);
  const boundW = Math.round(((deltaKwh * 1000) / hours) * 1000) / 1000;
  if (boundW > MAX_BOUND_W) {
    return refuse(`the register rose ${deltaKwh} kWh in ${hours.toFixed(2)} h — ${boundW} W on average, above ${MAX_BOUND_W} W; the circuit was drawing something`);
  }

  const evidence = {
    register_code: codes.register,
    from: { ts: start.ts, value: regFrom },
    to: { ts: fresh.ts, value: regTo },
    delta_kwh: deltaKwh,
    bound_w: boundW,
  };
  const siblingV = new Map(siblings.filter((s) => s?.online !== false).map((s) => [Date.parse(s.ts), num(s.voltage)]));
  const freshState = fresh.capabilities?.[codes.state] ?? null;

  const updates = rows.map((r) => {
    const v = siblingV.has(Date.parse(r.ts)) ? siblingV.get(Date.parse(r.ts)) : null;
    const caps = { ...(r.capabilities ?? {}) };
    delete caps.measurement_frozen;
    delete caps.frozen_since;
    caps[codes.power] = 0;
    caps[codes.current] = 0;
    caps[codes.voltage] = v;
    if (freshState !== null) caps[codes.state] = freshState;
    caps.scrub = {
      rule: 'held_reading',
      ticket: 'RM-134',
      at,
      held: { power_w: heldP, current: heldC },
      evidence,
      voltage_from: v === null ? null : siblingId,
    };
    return { device_id: r.device_id, ts: r.ts, voltage: v, current: 0, power_w: 0, online: r.online, capabilities: caps };
  });
  return { refused: null, updates, evidence };
}
