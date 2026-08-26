/**
 * Builds the `/api/readings/latest` payload from a raw context snapshot.
 *
 * This file is the SINGLE implementation of that transform. It is:
 *   - imported directly by `mock-bridge/server.mjs`
 *   - inlined verbatim into the Node-RED function node by `node-red-bridge/build-flow.mjs`
 *     (which strips the `export` keywords — nothing else)
 *
 * That is what makes the mock and the real bridge byte-identical in shape. A drift
 * between them would produce the worst kind of bug: frontend works locally, breaks on
 * the Pi. So keep this pure — no Node-RED APIs, no imports, no Node built-ins.
 */

/** ISO 8601 at +08:00 regardless of the host's timezone setting. */
export function iso8(ms) {
  const d = new Date(Number(ms) + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) +
    'T' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds()) + '+08:00';
}

export function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
}

export function bool(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}

/**
 * How long a metered device may go with no evidence of a fresh report before `online` stops
 * being believed, whatever the connection flag says.
 *
 * WHY THIS IS NEEDED AT ALL: `h` reports the tuya node's socket, and a socket whose peer
 * vanished without sending a FIN stays "connected" indefinitely. On 2026-08-26 the Pi's own
 * address changed out from under every established session (it had fallen back to a different
 * SSID); three meters then reported `online: true` carrying byte-identical readings for over
 * half an hour while nothing at all was reachable.
 *
 * WHY IT IS THIS LARGE: it must sit well clear of the slowest legitimate report. Measured on
 * site the same day, an online outlet's arrival stamp lagged by up to 59 s, and the energy
 * tab's sample buffers are drained on a five-minute cycle. Ten minutes is roughly ten times
 * the slowest normal gap and still an order of magnitude inside the failure it exists to catch.
 * Erring short is the dangerous direction: `online: false` removes a device from the building
 * totals below, so a threshold that trips on a merely-late meter under-reports the building.
 */
export const STALE_READING_MS = 600000;

/**
 * @param {object} snap  { energy:{meters,totals}, outlet:{meters,state}, switch:{state}, aircon:{state} }
 * @param {Array}  REG   device registry
 * @param {object} PHASE_MAP
 * @param {number} nowMs
 * @returns {Array} one entry per device, plus a trailing `_totals` entry
 */
export function buildLatest(snap, REG, PHASE_MAP, nowMs) {
  const energy = snap.energy || { meters: {}, totals: {} };
  const outlet = snap.outlet || { meters: {}, state: {} };
  const lights = (snap.switch || {}).state || {};
  const ac = (snap.aircon || {}).state || {};
  const outletStatus = outlet.state.status || {};
  const out = [];

  for (const d of REG) {
    const r = { device_id: d.id, ts: iso8(nowMs) };

    // --- metered devices ----------------------------------------------------
    if (d.ctx) {
      const src = (d.class === 'outlet_dual' ? outlet.meters : energy.meters)[d.ctx] || {};
      const v = num(src.v), c = num(src.c), p = num(src.p), e = num(src.e);
      // Absent readings are omitted, never coerced to 0 — "no data" and "zero watts"
      // are different facts and the UI renders them differently.
      if (v !== undefined) r.voltage = v;
      if (c !== undefined) r.current = c;
      if (p !== undefined) r.power_w = p;
      if (e !== undefined) r.energy_kwh_today = e;
      // Per-device week/month = the completed days this bridge has folded into its own
      // accumulator (`snap.energyAcc`, maintained by the Accumulate-energy step) plus the
      // live daily counter. Each meter only ever reports a DAILY figure, so anything
      // longer has to be accumulated here; a device the accumulator hasn't seen a full day
      // for is omitted rather than reported as its daily value.
      const acc = (snap.energyAcc || {})[d.id];
      if (acc && e !== undefined) {
        const wb = num(acc.weekBase), mb = num(acc.monthBase);
        if (wb !== undefined) r.energy_kwh_week = Math.round((wb + e) * 1000) / 1000;
        if (mb !== undefined) r.energy_kwh_month = Math.round((mb + e) * 1000) / 1000;
      }
      r.online = bool(src.h);

      // When did this device last actually report? Two sources, preferring the source tab's
      // own stamp:
      //   `src.t`        the arrival time the tab records. Outlet meters carry one; the energy
      //                  tab writes no timestamp of any kind, which is why the second exists.
      //   `snap.arrivals` what the bridge itself last saw change for this meter — tracked from
      //                  the tab's sample buffers, which grow on every message even when the
      //                  measured values do not.
      //
      // ARRIVAL, NOT VALUE CHANGE. This distinction was measured rather than assumed, and the
      // obvious version is wrong: `mtr_lo_yellow` and `mtr_co_yellow` are two channels of one
      // physical meter, and over ten minutes the first sat byte-identical at 0 W while the
      // second swung between 215 V and 229 V. The device was plainly reporting throughout, so
      // treating "the numbers stopped moving" as death would have marked a healthy idle circuit
      // offline and quietly subtracted it from the building totals.
      const t = num(src.t);
      const seenAt = t !== undefined && t > 0 ? t : num((snap.arrivals || {})[d.ctx]);
      if (seenAt !== undefined) {
        // Report when the reading happened, not when it was served. `ts = now` on a device
        // that has not reported is a fabrication, and it is what let the staleness watchdog
        // sleep through the outage above — an always-fresh timestamp can never look old.
        r.ts = iso8(seenAt);
        if (nowMs - seenAt > STALE_READING_MS) r.online = false;
      }
    } else if (d.class === 'switch') {
      // Switches have no `ctx` (no metering DPS), but a real per-switch connection signal
      // DOES exist — `global.lightStatus`, populated by the Lighting Logic Hub — it was
      // just never read here before. `state_key` is `L1`..`L7`; `lightStatus`'s keys are
      // the bare numbers `1`..`7`.
      const health = (snap.switch || {}).health || {};
      const entry = health[d.state_key.slice(1)];
      // No health entry at all (older flow, or a mock that doesn't simulate it) — fall
      // back to the previous always-online assumption rather than invent a false negative.
      r.online = entry ? entry.conn === 'CONNECTED' : true;
    } else if (d.state_ctx === 'ac_dash_state') {
      // The aircon and the outside-temp sensor are both fed by the IR blaster, and neither is
      // a meter nor a switch — so both used to fall through to a hardcoded `online = true`.
      //
      // That hardcoded true was a fabrication, and it was live: on 2026-08-25 the blaster and
      // `Outside Temp` nodes were in a permanent `find() timed out` retry loop (they are not in
      // the Tuya cloud project and have never connected — RM-016), while the dashboard showed
      // both devices ONLINE carrying no measurement at all. A fabricated online is worse than a
      // stale reading: a stale one at least happened once.
      //
      // ONLINE means "carries at least one real measurement", not "the key exists". The flow
      // does not leave `ac_dash_state` empty when the blaster is dead — read off the live Pi,
      // it seeds a placeholder: `{power:"OFFLINE", setTemp:"--", roomTemp:"--", humidity:"--",
      // outTemp:"--"}`. A first version of this fix tested `Object.keys(ac).length` and so
      // passed its own tests while changing nothing in production, because emptiness was an
      // assumption rather than an observation.
      //
      // `num()` rejects "--" and "OFFLINE" and accepts "25.4", so the placeholder reads as
      // offline and a real poll reads as online, with no magic string to keep in sync. ANY one
      // field is enough: the blaster sends temperature and humidity on separate DPS, so
      // demanding all of them would report a half-working device as dead.
      //
      // This is the same move the `switch` branch above made when `lightStatus` turned out to
      // be readable — except there the fallback stayed optimistic, because a missing health map
      // really could mean an older flow. Here there is no such ambiguity: nothing else writes
      // this key, and a placeholder is a positive statement that nothing has reported.
      r.online = [ac.roomTemp, ac.outTemp, ac.humidity, ac.setTemp].some((v) => num(v) !== undefined);
    } else {
      r.online = true;
    }

    // --- switchable state ---------------------------------------------------
    if (d.class === 'switch') {
      r.state = bool(lights[d.state_key]) ? 'on' : 'off';
    } else if (d.class === 'outlet_dual') {
      const s1 = bool(outletStatus[d.sockets[0]]);
      const s2 = bool(outletStatus[d.sockets[1]]);
      r.socket_states = { 1: s1 ? 'on' : 'off', 2: s2 ? 'on' : 'off' };
      r.state = (s1 || s2) ? 'on' : 'off';
    } else if (d.class === 'acu_ir') {
      r.state = bool(ac.power) ? 'on' : 'off';
      if (num(ac.setTemp) !== undefined) r.setpoint_c = num(ac.setTemp);
      if (num(ac.roomTemp) !== undefined) r.room_temp_c = num(ac.roomTemp);
      if (num(ac.humidity) !== undefined) r.humidity_pct = num(ac.humidity);
    } else if (d.class === 'sensor_temp_humidity') {
      r.state = null;
      if (num(ac.outTemp) !== undefined) r.temp_c = num(ac.outTemp);
      if (num(ac.humidity) !== undefined) r.humidity_pct = num(ac.humidity);
    } else {
      r.state = null;
    }

    out.push(r);
  }

  // --- building totals ------------------------------------------------------
  const byId = {};
  for (const r of out) byId[r.device_id] = r;

  // A meter that's gone offline still has its last cached v/c/p sitting in `byId` (that's
  // the whole point of "last known reading" — see the per-device loop above), but a
  // building-wide total is a claim about what's happening RIGHT NOW, not a museum of last
  // known values. Every aggregate below skips `online === false` explicitly, matching the
  // per-device `online` derivation two branches up — a disconnected meter contributes
  // nothing here, the same way a disconnected switch's health entry now actually means
  // something instead of being silently ignored.
  function phaseCurrent(ids) {
    let sum = 0, seen = false;
    for (const id of ids) {
      const r = byId[id];
      if (r && r.online !== false && typeof r.current === 'number') { sum += r.current; seen = true; }
    }
    return seen ? Math.round(sum * 1000) / 1000 : null;
  }

  let totalP = 0, pSeen = false, vSum = 0, vCount = 0;
  for (const d of REG) {
    if (d.class !== 'meter') continue;
    const r = byId[d.id] || {};
    if (r.online === false) continue;
    if (typeof r.power_w === 'number') { totalP += r.power_w; pSeen = true; }
    if (typeof r.voltage === 'number' && r.voltage > 0) { vSum += r.voltage; vCount++; }
  }

  const t = energy.totals || {};
  const today = num(t.today), week = num(t.week), month = num(t.month);

  out.push({
    device_id: '_totals',
    ts: iso8(nowMs),
    energy_kwh_today: today === undefined ? null : today,
    energy_kwh_week: week === undefined ? null : week,
    energy_kwh_month: month === undefined ? null : month,
    total_power_w: pSeen ? Math.round(totalP * 10) / 10 : null,
    avg_voltage: vCount ? Math.round((vSum / vCount) * 10) / 10 : null,
    // blue is null, not 0. No Blue-phase meter is installed; `Calculate 3-Phase Totals`
    // hardcodes currentBlue = 0. The UI must render this as "not metered".
    phase_current: {
      red: phaseCurrent(PHASE_MAP.red),
      yellow: phaseCurrent(PHASE_MAP.yellow),
      blue: null,
    },
  });

  return out;
}
