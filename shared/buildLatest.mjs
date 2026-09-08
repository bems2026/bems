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

/**
 * ISO 8601 at a fixed UTC offset, regardless of the host's timezone setting.
 *
 * `offsetMinutes` defaults to 480 (+08:00) so that every caller predating RM-027 behaves
 * exactly as before — including `test/contract.test.mjs`, which pins the wire format. The
 * site's real value is threaded in by `node-red-bridge/build-flow.mjs`.
 *
 * A number of minutes rather than an IANA zone name because this function is inlined verbatim
 * into a Node-RED function node, where a full-ICU build is not something to bet the building's
 * timestamps on. `shared/sites/<id>/site.mjs` carries both and a test asserts they agree.
 */
export function iso8(ms, offsetMinutes = 480) {
  const d = new Date(Number(ms) + offsetMinutes * 60000);
  const p = (n) => String(n).padStart(2, '0');
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) +
    'T' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds()) +
    sign + p(Math.floor(abs / 60)) + ':' + p(abs % 60);
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
 * @param {number} [offsetMinutes] minutes east of UTC for the site; see iso8()
 * @param {object} [staleAfterMsByClass] device class -> staleness budget in ms; threaded in
 *        rather than imported, exactly like `offsetMinutes`, because this file is inlined
 *        verbatim into a Node-RED function node and may not import anything. The authority is
 *        `shared/registry.mjs`'s `STALE_AFTER_MS_BY_CLASS`; `{}` reproduces the pre-2026-09-01
 *        behaviour, where every consumer fell back to one global 30 s.
 * @param {number} [maxDailyKwh] the most a single branch circuit may plausibly consume in one
 *        day at this site — `SITE.max_branch_kwh_per_day`, threaded in for the same reason as
 *        the two above. A daily figure beyond it is not believed; see the backstop below.
 *        Omitted means no bound, which reproduces the pre-2026-09-03 behaviour.
 * @param {object} [dailyEnergyCodeByDevice] device id -> the capability code carrying that
 *        device's own daily energy counter, from `dailyEnergyCodeFor`. Threaded in rather than
 *        looked up, for the same reason as the three above: this file is inlined verbatim into a
 *        Node-RED function node and may not import anything. `{}` reproduces the pre-2026-09-07
 *        behaviour, where the code was a literal assembled here.
 * @returns {Array} one entry per device, plus a trailing `_totals` entry
 */
export function buildLatest(snap, REG, PHASE_MAP, nowMs, offsetMinutes = 480, staleAfterMsByClass = {}, maxDailyKwh = undefined, dailyEnergyCodeByDevice = {}, buildingMeterIds = []) {
  const energy = snap.energy || { meters: {}, totals: {} };
  const outlet = snap.outlet || { meters: {}, state: {} };
  const lights = (snap.switch || {}).state || {};
  // `lights` above is what this system last ASKED FOR; this is what the relay last SAID. Both are
  // needed, in two places each, so they are resolved together — see the switch state block below.
  const switchHealth = (snap.switch || {}).health || {};
  const ac = (snap.aircon || {}).state || {};
  const outletStatus = outlet.state.status || {};
  const out = [];

  for (const d of REG) {
    const r = { device_id: d.id, ts: iso8(nowMs, offsetMinutes) };

    // How long this device's reading may go without advancing before the frontend should stop
    // calling it fresh. Carried on the wire rather than re-derived in `src/`, because the
    // cadence is a fact about the BRIDGE — it owns the 60 s outlet poller, so it is the only
    // party that knows an outlet cannot report faster than that. A second copy of the table in
    // the frontend would be free to disagree with the thing it describes, which is precisely
    // what one global 30 s did.
    //
    // A device's own value wins over its class, so a site can declare one differently in
    // `shared/sites/<id>/devices.mjs` without restating the class defaults. Omitted entirely
    // when neither is known, which is what makes an older frontend and an older bridge both
    // fall back to the single 30 s default unchanged.
    const staleAfter = typeof d.stale_after_ms === 'number' ? d.stale_after_ms : staleAfterMsByClass[d.class];
    if (typeof staleAfter === 'number') r.stale_after_ms = staleAfter;

    // Everything the device reports beyond volts/amps/watts, decoded by the generated source-tab
    // parser and keyed by its vendor capability code. Omitted entirely when the parser has not
    // seen this device yet, so an older flow and a newer bridge still agree on every other field.
    //
    // Resolved HERE rather than inside the metered branch below, because the outlet state block
    // further down needs it too — an outlet's measured relay state arrives as `switch_1`/
    // `switch_2` on this same object. Hoisted for the same reason `switchHealth` is.
    const dp = d.ctx
      ? (() => {
          const s = (d.class === 'outlet_dual' ? outlet.meters : energy.meters)[d.ctx] || {};
          return s.dp && typeof s.dp === 'object' ? s.dp : null;
        })()
      : null;

    // --- metered devices ----------------------------------------------------
    if (d.ctx) {
      const src = (d.class === 'outlet_dual' ? outlet.meters : energy.meters)[d.ctx] || {};
      const v = num(src.v), c = num(src.c), p = num(src.p), e = num(src.e);

      if (dp && Object.keys(dp).length) r.capabilities = dp;

      // TODAY'S ENERGY, PREFERRING THE DEVICE'S OWN FIGURE.
      //
      // `src.e` is `<ctx>_energy`, which for a CT meter is INTEGRATED from power by the legacy
      // two-second engine. Integration is the mechanism behind the frozen-meter corruption fixed
      // in Aug 2026: a disconnected meter's last wattage compounds into the total for as long as
      // it stays down. The meters have always reported `today_acc_energy` themselves and nothing
      // read it — measured 2026-09-02, `mtr_co_yellow` integrated to 8.0437 kWh while the meter
      // itself said 8.057.
      //
      // Outlets have no such dp (they report `add_ele`, an increment their parser accumulates),
      // so they keep `src.e` and this changes nothing for them.
      //
      // The channel suffix is load-bearing: one physical dual-channel meter is two logical
      // devices here, and taking the wrong channel's total would attribute one branch circuit's
      // consumption to another.
      //
      // AN INCREMENT, NOT AN ABSOLUTE. `today_acc_energy` is only "today's" if the device resets
      // it, and one channel of this fleet's dual-channel meter does not: measured 2026-09-03,
      // channel 1 read 3.477 kWh while channel 2 read 3625.021 and was incrementing correctly on
      // top of that offset — a 3,625 kWh day for a circuit that averages 36 W. So the figure is
      // published relative to where the counter stood when the local day began, tracked by
      // `node-red-bridge/energyDayBase.mjs` and arriving as `snap.energyDayBase`. Clamped at
      // zero: a re-baseline and a counter arriving in the same tick may cross, and a negative
      // kWh is not a reading.
      //
      // With no baseline yet — an older flow, or a meter the tracker has not seen — the raw
      // counter is used, which is exactly the behaviour that shipped in `658d7c2`.
      // WHICH dp IS THE DAILY COUNTER comes from the catalogue, not from a name assembled here.
      // `shared/deviceCapabilities.mjs` declares it as `semantic: 'cumulative_daily'` and
      // `dailyEnergyCodeFor` resolves it per channel; `build-flow.mjs` threads the result in,
      // for the same reason `offsetMinutes` and `maxDailyKwh` are threaded — this function is
      // inlined verbatim into a Node-RED node and may not import anything.
      //
      // The fallback is the old literal, so a deployed flow predating this passes nothing and
      // behaves precisely as it did. Both meter products in this building code it exactly that
      // way, which is why this is a drift guard and not a live fix: a future product coding it
      // differently would have fallen silently back to the integrated value, with nothing
      // reporting a fault and only the number being worse.
      const dailyCode = dailyEnergyCodeByDevice[d.id] || ('today_acc_energy' + (d.channel || 1));
      const ownRaw = dp ? num(dp[dailyCode]) : undefined;
      let ownDaily;
      if (ownRaw !== undefined) {
        const baseFor = (snap.energyDayBase || {})[d.ctx];
        // The SAME code, deliberately. A baseline read from a different dp than the reading it
        // is subtracted from would produce a confident, meaningless number.
        const dayBase = baseFor ? num(baseFor[dailyCode]) : undefined;
        ownDaily = dayBase !== undefined ? Math.max(0, ownRaw - dayBase) : ownRaw;
      }
      let eToday = ownDaily !== undefined ? ownDaily : e;

      // THE BACKSTOP. Both sources above can be wrong in ways this file cannot detect from one
      // sample — a counter carrying an offset nothing cleared, or an integrator that compounded
      // a dead meter's last wattage for a week. `maxDailyKwh` is a physical bound on what a
      // single branch of this building's sub-panel can consume in a day. Prefer the integrated
      // value when the device's figure breaches it; omit the field entirely when both do, rather
      // than coerce to 0 — "no data" and "zero watts" are different facts and the UI renders them
      // differently. Absent bound means no rejection, so a site that has not declared one behaves
      // exactly as before.
      if (maxDailyKwh !== undefined && eToday !== undefined && eToday > maxDailyKwh) {
        eToday = e !== undefined && e <= maxDailyKwh ? e : undefined;
      }
      // DID THE METER'S OWN REGISTER WIN? That is what decides whether this device has TWO
      // measurements of today or one, and it has to be asked after the backstop rather than
      // before: a register the backstop rejected leaves the integrated value as the reading
      // itself, and publishing it twice would manufacture an agreement.
      const usedOwnRegister = ownDaily !== undefined && eToday === ownDaily;
      // Absent readings are omitted, never coerced to 0 — "no data" and "zero watts"
      // are different facts and the UI renders them differently.
      if (v !== undefined) r.voltage = v;
      if (c !== undefined) r.current = c;
      if (p !== undefined) r.power_w = p;
      if (eToday !== undefined) r.energy_kwh_today = eToday;
      // THIS METER'S OWN SECOND OPINION — RM-058. `<ctx>_energy` is the legacy engine's
      // two-second integration of THIS meter's power, reset at local midnight: the same quantity
      // as the reading above, derived the other way. It was already read as the fallback and
      // never published, so the only cross-check the frontend could make was building-wide — and
      // that is precisely why RM-056 hid. `mtr_arec_acu` was 38 % short against its own power
      // over one window while the building-level shortfall was 6.7 %, under any threshold worth
      // setting. Six times louder at the branch than at the building.
      //
      // Only when the register won. An outlet has no cumulative register at all (RM-047), so its
      // reading IS this figure; emitting both would imply a second measurement that does not
      // exist and invite a comparison that can never fail.
      if (usedOwnRegister && e !== undefined) r.energy_kwh_today_integrated = e;
      // Per-device week/month = the completed days this bridge has folded into its own
      // accumulator (`snap.energyAcc`, maintained by the Accumulate-energy step) plus the
      // live daily counter. Each meter only ever reports a DAILY figure, so anything
      // longer has to be accumulated here; a device the accumulator hasn't seen a full day
      // for is omitted rather than reported as its daily value.
      // The accumulator banks whatever `energy_kwh_today` reported, so switching that field's
      // source switches this one with it and the two cannot disagree. Crossing over may bank one
      // small step if the device's own figure sits below the integrated one at that moment — the
      // counter-regression branch handles it as real consumption, which is the safe direction.
      const acc = (snap.energyAcc || {})[d.id];
      if (acc && eToday !== undefined) {
        const wb = num(acc.weekBase), mb = num(acc.monthBase);
        if (wb !== undefined) r.energy_kwh_week = Math.round((wb + eToday) * 1000) / 1000;
        if (mb !== undefined) r.energy_kwh_month = Math.round((mb + eToday) * 1000) / 1000;
      }
      r.online = bool(src.h);

      // When did this device last actually report? Two sources, preferring the source tab's
      // own stamp:
      //   `src.t`        the arrival time the tab records. Outlet meters carry one; the energy
      //                  tab writes no timestamp of any kind, which is why the second exists.
      //   `snap.arrivals` what the bridge itself last saw change for this meter — tracked by
      //                  `node-red-bridge/arrivalTracker.mjs` from the energy tab's own SAMPLE
      //                  BUFFER DEPTH (`<ctx>_arr_v`), which grows on every message even when
      //                  the measured values do not. The energy tab writes no timestamp of any
      //                  kind, which is why that indirection exists at all.
      //
      // ARRIVAL, NOT VALUE CHANGE. This distinction was measured rather than assumed, and the
      // obvious version is wrong: `mtr_lo_yellow` and `mtr_co_yellow` are two channels of one
      // physical meter, and over ten minutes the first sat byte-identical at 0 W while the
      // second swung between 215 V and 229 V. The device was plainly reporting throughout, so
      // treating "the numbers stopped moving" as death would have marked a healthy idle circuit
      // offline and quietly subtracted it from the building totals.
      //
      // The energy ACCUMULATOR was removed from that signature on 2026-09-01 (ROADMAP EX-141).
      // It is integrated on a timer rather than on arrival — measured: `co_yel_energy` moved
      // three times across fourteen seconds in which no message arrived at all — so including it
      // let a meter drawing power fake its own freshness, and would have kept a meter that DIED
      // while loaded looking fresh indefinitely. `STALE_READING_MS` below is the backstop for a
      // health flag that lies, so it must not depend on anything the same failure would move.
      const t = num(src.t);
      const seenAt = t !== undefined && t > 0 ? t : num((snap.arrivals || {})[d.ctx]);
      if (seenAt !== undefined) {
        // Report when the reading happened, not when it was served. `ts = now` on a device
        // that has not reported is a fabrication, and it is what let the staleness watchdog
        // sleep through the outage above — an always-fresh timestamp can never look old.
        r.ts = iso8(seenAt, offsetMinutes);
        if (nowMs - seenAt > STALE_READING_MS) r.online = false;
      }
    } else if (d.class === 'switch') {
      // Switches have no `ctx` (no metering DPS), but a real per-switch connection signal
      // DOES exist — `global.lightStatus`, populated by the Lighting Logic Hub — it was
      // just never read here before. `state_key` is `L1`..`L7`; `lightStatus`'s keys are
      // the bare numbers `1`..`7`.
      const entry = switchHealth[d.state_key.slice(1)];
      // No health entry at all (older flow, or a mock that doesn't simulate it) — fall
      // back to the previous always-online assumption rather than invent a false negative.
      r.online = entry ? entry.conn === 'CONNECTED' : true;
      // A switch has no metering, but it does have settings — countdown, power-on behaviour,
      // inching, switch type. They ride on the same lightStatus entry its connection state does.
      const sdp = entry && entry.dp && typeof entry.dp === 'object' ? entry.dp : null;
      if (sdp && Object.keys(sdp).length) r.capabilities = sdp;
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
      /**
       * WHAT THE RELAY IS DOING, not what was last asked of it — FI-023.
       *
       * `lights` is `bems_lights_state`, which the flow's `Lighting Logic Hub` writes from an
       * incoming COMMAND before forwarding it to the device. Nothing ever writes back what the
       * relay did, so that map is a record of intent, and reading it as state means the app can
       * never notice a light switched at the wall, by its own schedule, or by a command that
       * silently failed.
       *
       * It did not notice. On 2026-09-03 the dashboard showed all seven office lights off while
       * the devices reported all seven on — confirmed independently by the vendor cloud, which
       * reaches them over the internet rather than the local subnet.
       *
       * The measured value was already here: `Collect status` maintains `lightStatus[<n>].on`
       * from `dps['1']`, and this function was reading only `.conn` from that same entry.
       *
       * Preferred, not required. A flow or a mock with no lightStatus at all falls back to the
       * commanded value, which is what keeps this from being a regression for them — and the
       * check is `typeof === 'boolean'` rather than a truthiness test, because flow context
       * survives restarts on disk and a half-written entry must read as absent, not as ON.
       */
      const measured = switchHealth[d.state_key.slice(1)];
      const observed = measured && typeof measured.on === 'boolean' ? measured.on : undefined;
      r.state = (observed !== undefined ? observed : bool(lights[d.state_key])) ? 'on' : 'off';
    } else if (d.class === 'outlet_dual') {
      /*
       * THE SAME FIX AS THE SWITCH BRANCH ABOVE, for the class FI-023 left out.
       *
       * `outletStatus` is `bems_outlets_state.status`, which the flow's `Outlet Logic Hub` writes
       * from an incoming COMMAND before forwarding it to the device. Nothing writes back what the
       * relay did, so reading it as state means the app can never notice a socket switched at the
       * outlet's own button, by a schedule, or by a command that silently failed — precisely what
       * `bems_lights_state` did for lights until 2026-09-03.
       *
       * REPORTED FROM THE BUILDING 2026-09-07: pressing a light switch at the wall updates the
       * app, pressing an outlet's button does not. Tested by hand, both ways. The asymmetry the
       * operator felt is this asymmetry in the code.
       *
       * The measured value was already arriving and being ignored — `switch_1`/`switch_2` ride on
       * `capabilities` on every poll, verified across all seven outlets the same day, because
       * `outletPollPlan` asks every 60 s and the device pushes changes in between.
       *
       * Per socket, not per device: an outlet is two relays behind one label, and one can be
       * pressed while the other is not. Preferred, not required — no decoded dp falls back to the
       * commanded value, so an older flow and the mock are unaffected. `typeof === 'boolean'`
       * rather than truthiness, because flow context survives restarts on disk and a half-written
       * entry must read as absent, not as ON.
       */
      const measuredSocket = (code) => (dp && typeof dp[code] === 'boolean' ? dp[code] : undefined);
      const m1 = measuredSocket('switch_1');
      const m2 = measuredSocket('switch_2');
      const s1 = m1 !== undefined ? m1 : bool(outletStatus[d.sockets[0]]);
      const s2 = m2 !== undefined ? m2 : bool(outletStatus[d.sockets[1]]);
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

  // CONSUMED ENERGY IS THE SUM OF THE BUILDING'S OWN BRANCH METERS — RM-057.
  //
  // `buildingMeterIds` is the topmost metered circuits of the site's declared electrical tree
  // (`shared/circuits.mjs`), threaded in at build time for the same reason `PHASE_MAP` and
  // `maxDailyKwh` are: this function is inlined verbatim into a Node-RED node and may not import.
  //
  // WHY THIS REPLACED THE FLOW'S OWN COUNTERS. `bems_energy_*` integrates power every two
  // seconds; each branch row is that meter's own register. Both describe the same four circuits,
  // and rendering them side by side without ever comparing them is what let RM-053 show a 5.4x
  // contradiction for a day and RM-056 hide a 38% under-count behind a 6.7% building-level one.
  // Summing the branches makes the headline and the split the same arithmetic done once, so
  // there is nothing left to reconcile.
  //
  // WHY NOT EVERY METER: the outlets plug into a branch that is already counted. `circuits.mjs`
  // carries that reasoning, because it is a fact about wiring rather than about hardware.
  //
  // ALL OR NOTHING, deliberately. A branch with no figure yields `null` for the whole building
  // rather than a sum that is short by a circuit — an under-count with nothing on screen to say
  // so is the shape of every energy fault this project has had. The UI already renders null as
  // "No data", which is the honest answer to "what did the building use".
  //
  // An empty list means an older deployed flow that passes nothing: fall back to the legacy
  // counters and behave exactly as before, the same rule `maxDailyKwh` follows.
  function branchSum(field) {
    if (!buildingMeterIds.length) return undefined;
    let sum = 0;
    for (const id of buildingMeterIds) {
      const v = byId[id] ? num(byId[id][field]) : undefined;
      if (v === undefined) return null;
      sum += v;
    }
    return Math.round(sum * 1000) / 1000;
  }
  const sumToday = branchSum('energy_kwh_today');
  const sumWeek = branchSum('energy_kwh_week');
  const sumMonth = branchSum('energy_kwh_month');
  const pick = (summed, legacy) => (summed === undefined ? (legacy === undefined ? null : legacy) : summed);

  out.push({
    device_id: '_totals',
    ts: iso8(nowMs, offsetMinutes),
    energy_kwh_today: pick(sumToday, today),
    energy_kwh_week: pick(sumWeek, week),
    energy_kwh_month: pick(sumMonth, month),
    // The legacy two-second integration of the same circuits, kept because it is the only
    // INDEPENDENT measurement of them this system has. Not the headline any more, but the thing
    // the disagreement guard compares the sum against — without it that guard would be checking
    // a number against itself, and the fault class it exists for has now bitten three times.
    energy_kwh_today_integrated: today === undefined ? null : today,
    energy_kwh_week_integrated: week === undefined ? null : week,
    energy_kwh_month_integrated: month === undefined ? null : month,
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
