/**
 * What each product can actually DO, as the vendor's own device model describes it.
 *
 * WHY THIS FILE EXISTS. Until now "capability" was spelled five different ways across five
 * unconnected tables — `DEVICE_CLASSES` and `DPS_MAPS` here in `shared/`, `DEVICE_CLASS_CATALOG`
 * in the frontend, `DISPATCH_CLASSES` on the server, and the duplicated
 * `NOT_COMMANDABLE_CLASSES`/`NOT_SCHEDULABLE_CLASSES` sets — and every one of them keyed off
 * `class`. A class says an outlet is "metered". It cannot say that this outlet reports a fault
 * bitmap on dp 26, that its energy dp is an increment rather than a total, or that its sibling
 * product reuses dp 113 for something else entirely. Those are the facts that decide what the
 * bridge may parse and what the UI may render, and none of them had anywhere to live.
 *
 * MEASURED, NOT TRANSCRIBED. Every code, dp, access mode, scale, unit and range below was read
 * on 2026-09-02 from the vendor cloud for a real device of each product, via
 * `/v1.0/devices/{id}/specifications` (the standard instruction set) and
 * `/v2.0/cloud/thing/{id}/model` + `/shadow/properties` (the DP instruction set, which is the
 * only one that carries `dp_id` at all). `npm run tuya:spec` re-reads the same endpoints and
 * diffs them against this file, so a firmware change shows up as a failing check rather than as
 * a value that silently stops meaning what it says.
 *
 * KEYED BY PROFILE, NOT BY CLASS — and this is not tidiness. The single-channel CT meter calls
 * dp 113 `net_state`; the double-channel one calls it `device_state2` and puts `net_state` on
 * 124. Both are `class: 'meter'`. A catalogue keyed by class would map one product's network
 * state onto the other product's second channel, quietly, on a live building's billing data.
 *
 * STANDARD INSTRUCTION FIRST, DP INSTRUCTION ONLY WHERE THERE IS NO CHOICE. The light switch and
 * the outlet answer `/specifications` with a full standard instruction set, so the cloud can
 * address them by `code`. Both CT meters refuse it outright — `code 2009: not support this
 * device`, an empty `{"category":"cz"}` — so they can only be addressed by dp. That refusal is
 * recorded per profile as `standard_instruction`, because it is the fact the dispatch path keys
 * off when it chooses how to talk to a device, not a piece of trivia.
 *
 * Data and pure functions only: no imports, no Node built-ins. Read by the frontend bundle, by
 * the server daemons, and by the flow generator that emits Node-RED parser source from it.
 */

/**
 * What a value MEANS over time, which is the distinction that hand-written parsers kept losing.
 *
 * `increment` is the dangerous one: Tuya's `add_ele` family reports "energy since I last told
 * you", and the live outlet parser assigned it straight to today's total, so every report threw
 * away the running figure and replaced it with one small delta. That is why `co3` could draw
 * 74.8 W all day and report 0.08 kWh. An increment must be added; a `cumulative_daily` must be
 * taken as-is; only when neither exists is integrating power over time the right answer.
 */
export const SEMANTICS = Object.freeze([
  'instant', // sampled now: volts, amps, watts
  'increment', // energy since the previous report — ADD, never assign
  'cumulative_daily', // the device's own running total for today
  'cumulative_total', // lifetime total, monotonic except across a device reset
  'setting', // operator-owned configuration held on the device
  'diagnostic', // health, calibration, link state
]);

/** Vendor unit -> the canonical unit this system stores, and the factor between them. */
const UNIT_TO_CANONICAL = {
  ma: { canonical: 'A', factor: 1000 },
  a: { canonical: 'A', factor: 1 },
  v: { canonical: 'V', factor: 1 },
  w: { canonical: 'W', factor: 1 },
  kwh: { canonical: 'kWh', factor: 1 },
  s: { canonical: 's', factor: 1 },
};

/**
 * Raw dp integer -> canonical unit, in one number.
 *
 * Tuya splits this across two fields that are easy to conflate: `scale` is a power of ten, and
 * `unit` may not be the unit anyone wants. The outlet reports current as `scale: 0` in **mA**;
 * the meter reports it as `scale: 3` in **A**. Both must come out in amps, and folding the two
 * into a single divisor is what stops a parser getting one right and the other wrong — which is
 * exactly the shape of the `add_ele` fault.
 */
export function divisorFor(cap) {
  if (!cap || cap.kind !== 'value') return 1;
  const unit = UNIT_TO_CANONICAL[String(cap.unit ?? '').toLowerCase()];
  return 10 ** (cap.scale ?? 0) * (unit?.factor ?? 1);
}

/** The canonical unit a decoded value is expressed in, or null for non-numeric capabilities. */
export function canonicalUnitFor(cap) {
  if (!cap || cap.kind !== 'value') return null;
  return UNIT_TO_CANONICAL[String(cap.unit ?? '').toLowerCase()]?.canonical ?? cap.unit ?? null;
}

/**
 * `writable` is deliberately its OWN flag rather than a synonym for `access: 'rw'`.
 *
 * The vendor marks `relay_status`, `switch_inching`, `cycle_time` and `random_time` writable, and
 * those are precisely the four this system refuses to write. Each one installs unattended
 * switching *inside the device*: a relay that turns itself off after a delay, comes back on after
 * a power cut, or cycles on its own schedule. iBEMS deliberately centralises scheduling in
 * Supabase so that every state change is gated, audited and overridable — `CLAUDE.md` says the
 * same thing about Node-RED's own cron arrays, which are kept empty for exactly this reason.
 * Writing these dps would reinstate that hazard one layer lower, where nothing can even see it.
 *
 * They are still parsed and displayed, so an operator can tell that a device is doing something
 * on its own. Reading is the point; writing is the hazard.
 */
const w = (code) => code; // marker for readability in the tables below

/** @param {object} c */
const cap = (c) => Object.freeze({ writable: false, channel: null, base: c.code, ...c });

/**
 * One CT channel's ten dps. Both meter products share these codes, offset by channel.
 *
 * `device_state`'s idle value is spelled `close` on channel 1 and `idle` on channel 2 — on the
 * SAME physical device. Each channel's range is recorded as declared, so the verifier keeps
 * checking the real thing, and `aliases` folds them to one vocabulary so a UI does not have to
 * know which channel it is looking at to know the meter is idle.
 */
const ctChannel = (n, dpBase) => [
  cap({ code: `device_state${n}`, dp: dpBase + 0, access: 'ro', kind: 'enum', semantic: 'diagnostic',
        range: n === 1 ? ['close', 'monitor', 'working', 'warning'] : ['idle', 'monitor', 'working', 'warning'],
        aliases: { close: 'idle' }, channel: n, base: 'device_state' }),
  cap({ code: `add_ele${n}`, dp: dpBase + 1, access: 'ro', kind: 'value', semantic: 'increment',
        scale: 2, unit: 'kWh', channel: n, base: 'add_ele' }),
  cap({ code: `cur_power${n}`, dp: dpBase + 2, access: 'ro', kind: 'value', semantic: 'instant',
        scale: 1, unit: 'W', channel: n, base: 'cur_power' }),
  cap({ code: `cur_current${n}`, dp: dpBase + 3, access: 'ro', kind: 'value', semantic: 'instant',
        scale: 3, unit: 'A', channel: n, base: 'cur_current' }),
  cap({ code: `cur_voltage${n}`, dp: dpBase + 4, access: 'ro', kind: 'value', semantic: 'instant',
        scale: 1, unit: 'V', channel: n, base: 'cur_voltage' }),
  cap({ code: `total_energy${n}`, dp: dpBase + 5, access: 'ro', kind: 'value', semantic: 'cumulative_total',
        scale: 3, unit: 'kWh', channel: n, base: 'total_energy' }),
  cap({ code: `today_acc_energy${n}`, dp: dpBase + 6, access: 'ro', kind: 'value', semantic: 'cumulative_daily',
        scale: 3, unit: 'kWh', channel: n, base: 'today_acc_energy' }),
  cap({ code: `power_type${n}`, dp: dpBase + 7, access: 'ro', kind: 'enum', semantic: 'diagnostic',
        range: ['normal', 'warn'], channel: n, base: 'power_type' }),
  cap({ code: `warn_power${n}`, dp: dpBase + 8, access: 'rw', kind: 'value', semantic: 'setting',
        scale: 0, unit: 'W', min: 200, max: 50000, step: 100, writable: true,
        channel: n, base: 'warn_power' }),
  cap({ code: `today_energy_add${n}`, dp: dpBase + 9, access: 'ro', kind: 'value', semantic: 'increment',
        scale: 2, unit: 'kWh', channel: n, base: 'today_energy_add' }),
];

/**
 * `sync_request` (101) is READ-ONLY, however much its name suggests otherwise — the thing model
 * marks it `accessMode: "ro"`. The writable half of the handshake is `sync_response` (102), and
 * that is what a "refresh now" control has to target.
 */
const ctSync = (responseRange) => [
  cap({ code: 'sync_request', dp: 101, access: 'ro', kind: 'enum', semantic: 'diagnostic',
        range: ['idle', 'request'] }),
  // The accepted range is NOT the same on both products — the single meter also takes 'clear'.
  // Shared code here would have offered the double meter a value it rejects.
  cap({ code: 'sync_response', dp: 102, access: 'rw', kind: 'enum', semantic: 'setting',
        range: responseRange, writable: true }),
];

export const CAPABILITY_PROFILES = Object.freeze({
  /** T34-MINI通断器 — the seven lighting relays, `l1`..`l7`. Vendor category `tdq`. */
  tdq_switch: Object.freeze({
    id: 'tdq_switch',
    label: 'Relay switch',
    standard_instruction: true,
    channels: 1,
    capabilities: Object.freeze([
      cap({ code: w('switch_1'), dp: 1, access: 'rw', kind: 'bool', semantic: 'setting', writable: true }),
      cap({ code: w('countdown_1'), dp: 9, access: 'rw', kind: 'value', semantic: 'setting',
            scale: 0, unit: 's', min: 0, max: 86400, step: 1, writable: true }),
      // Read-only by our choice, not the vendor's: this decides what the relay does after a power
      // cut, unattended, with nothing in the audit trail to explain it afterwards.
      //
      // THREE VOCABULARIES, ONE DP. `/specifications` reports this switch's range as
      // ["0","1","2"] and returns "0"; the thing model reports ["off","on","memory"] and the
      // shadow returns "off". The local protocol is a third path and was not measurable from
      // here. `range` follows the thing model because that is the DP view the local path serves,
      // and every other spelling is aliased onto it — so whichever the wire actually carries,
      // this decodes to one value instead of to a string nothing downstream recognises.
      cap({ code: 'relay_status', dp: 38, access: 'rw', kind: 'enum', semantic: 'setting',
            range: ['off', 'on', 'memory'],
            aliases: { 0: 'off', 1: 'on', 2: 'memory', power_off: 'off', power_on: 'on', last: 'memory' } }),
      cap({ code: 'random_time', dp: 42, access: 'rw', kind: 'string', semantic: 'setting', maxlen: 255 }),
      cap({ code: 'cycle_time', dp: 43, access: 'rw', kind: 'string', semantic: 'setting', maxlen: 255 }),
      cap({ code: 'switch_inching', dp: 44, access: 'rw', kind: 'string', semantic: 'setting', maxlen: 255 }),
      cap({ code: 'switch_type', dp: 47, access: 'rw', kind: 'enum', semantic: 'setting',
            range: ['flip', 'sync', 'button'] }),
    ]),
  }),

  /**
   * Smart Wall Socket — the seven convenience outlets, `co1`..`co7`. Vendor category `pc`.
   *
   * dps 21-26 are the DP-instruction-only half: the standard instruction set does not list
   * `test_bit`, the four calibration coefficients or the `fault` bitmap, but the thing model
   * does, and they read fine. This is the one product where both halves of the brief's rule
   * apply to the same device.
   */
  pc_outlet: Object.freeze({
    id: 'pc_outlet',
    label: 'Dual-socket metered outlet',
    standard_instruction: true,
    channels: 1,
    capabilities: Object.freeze([
      cap({ code: w('switch_1'), dp: 1, access: 'rw', kind: 'bool', semantic: 'setting', writable: true, socket: 1 }),
      cap({ code: w('switch_2'), dp: 2, access: 'rw', kind: 'bool', semantic: 'setting', writable: true, socket: 2 }),
      cap({ code: w('countdown_1'), dp: 9, access: 'rw', kind: 'value', semantic: 'setting',
            scale: 0, unit: 's', min: 0, max: 86400, step: 1, writable: true, socket: 1 }),
      cap({ code: w('countdown_2'), dp: 10, access: 'rw', kind: 'value', semantic: 'setting',
            scale: 0, unit: 's', min: 0, max: 86400, step: 1, writable: true, socket: 2 }),
      // scale 3, NOT 2 — and an increment, not a daily total. Both halves of the live fault.
      // The thing model declares no unit for this one (the meters' `add_ele1` does say kWh);
      // kWh is inferred from scale and from the sibling code, and `npm run tuya:spec` will
      // report it if the vendor ever states something else.
      cap({ code: 'add_ele', dp: 17, access: 'ro', kind: 'value', semantic: 'increment',
            scale: 3, unit: 'kWh', unit_inferred: true }),
      cap({ code: 'cur_current', dp: 18, access: 'ro', kind: 'value', semantic: 'instant',
            scale: 0, unit: 'mA' }),
      cap({ code: 'cur_power', dp: 19, access: 'ro', kind: 'value', semantic: 'instant',
            scale: 1, unit: 'W' }),
      cap({ code: 'cur_voltage', dp: 20, access: 'ro', kind: 'value', semantic: 'instant',
            scale: 1, unit: 'V' }),
      // Dimensionless: the vendor declares no unit for these. `unit: ''` says so out loud,
      // where omitting the field would read as somebody having forgotten it.
      cap({ code: 'test_bit', dp: 21, access: 'ro', kind: 'value', semantic: 'diagnostic',
            scale: 0, unit: '', min: 0, max: 5 }),
      cap({ code: 'voltage_coe', dp: 22, access: 'ro', kind: 'value', semantic: 'diagnostic',
            scale: 0, unit: '', min: 0, max: 1000000 }),
      cap({ code: 'electric_coe', dp: 23, access: 'ro', kind: 'value', semantic: 'diagnostic',
            scale: 0, unit: '', min: 0, max: 1000000 }),
      cap({ code: 'power_coe', dp: 24, access: 'ro', kind: 'value', semantic: 'diagnostic',
            scale: 0, unit: '', min: 0, max: 1000000 }),
      cap({ code: 'electricity_coe', dp: 25, access: 'ro', kind: 'value', semantic: 'diagnostic',
            scale: 0, unit: '', min: 0, max: 1000000 }),
      // A bitmap, so the value is a mask and the labels are what make it mean anything:
      // over-current, over-voltage, over-power, then the three under-range counterparts.
      cap({ code: 'fault', dp: 26, access: 'ro', kind: 'bitmap', semantic: 'diagnostic',
            bits: ['ov_cr', 'ov_vol', 'ov_pwr', 'ls_cr', 'ls_vol', 'ls_pow'] }),
      // Same three-vocabulary problem as the light switch's dp 38 — see the note there.
      cap({ code: 'relay_status', dp: 38, access: 'rw', kind: 'enum', semantic: 'setting',
            range: ['off', 'on', 'memory'],
            aliases: { 0: 'off', 1: 'on', 2: 'memory', power_off: 'off', power_on: 'on', last: 'memory' } }),
      cap({ code: w('child_lock'), dp: 41, access: 'rw', kind: 'bool', semantic: 'setting', writable: true }),
      cap({ code: 'cycle_time', dp: 42, access: 'rw', kind: 'string', semantic: 'setting' }),
    ]),
  }),

  /** WiFi单路电流互感计量器 — `mtr_lo_red` and `mtr_arec_acu`. Vendor category `cz`, no standard set. */
  cz_ct_single: Object.freeze({
    id: 'cz_ct_single',
    label: 'Single-channel CT meter',
    standard_instruction: false,
    channels: 1,
    capabilities: Object.freeze([
      ...ctSync(['idle', 'ok', 'clear']),
      ...ctChannel(1, 103),
      cap({ code: 'net_state', dp: 113, access: 'ro', kind: 'enum', semantic: 'diagnostic',
            range: ['cloud_net', 'local_net', 'no_net'] }),
    ]),
  }),

  /**
   * WiFi双路电流互感计量器 — one physical device serving `mtr_co_yellow` (channel 1) and
   * `mtr_lo_yellow` (channel 2). Vendor category `cz`, no standard instruction set.
   *
   * NOTE dp 113. On the single-channel product that number is `net_state`; here it is the second
   * channel's `device_state`, and `net_state` moves to 124. Measured on both devices.
   */
  cz_ct_double: Object.freeze({
    id: 'cz_ct_double',
    label: 'Dual-channel CT meter',
    standard_instruction: false,
    channels: 2,
    capabilities: Object.freeze([
      ...ctSync(['idle', 'ok']),
      ...ctChannel(1, 103),
      ...ctChannel(2, 113),
      // Verified against the live device: total_energy1 + total_energy2 === all_energy, exactly.
      cap({ code: 'all_energy', dp: 123, access: 'ro', kind: 'value', semantic: 'cumulative_total',
            scale: 3, unit: 'kWh' }),
      cap({ code: 'net_state', dp: 124, access: 'ro', kind: 'enum', semantic: 'diagnostic',
            range: ['cloud_net', 'local_net', 'no_net'] }),
    ]),
  }),
});

export const CAPABILITY_PROFILE_IDS = Object.freeze(Object.keys(CAPABILITY_PROFILES));

/** @param {string} profileId */
const profile = (profileId) =>
  typeof profileId === 'string' ? (CAPABILITY_PROFILES[profileId] ?? null) : (profileId ?? null);

/**
 * The profile a registry device belongs to, or `null` for one that has no dps at all.
 *
 * `null` is a real answer, not a failure: the IR blaster and the ambient sensor are read through
 * flow context rather than dps, and giving them an empty profile would claim they have
 * capabilities we simply cannot see.
 */
export function profileFor(device) {
  return profile(device?.capability_profile);
}

/** One capability by code, or `null`. */
export function capabilityFor(profileId, code) {
  const p = profile(profileId);
  return p?.capabilities.find((c) => c.code === code) ?? null;
}

/** Only what this system is willing to write — see the note on the `writable` flag above. */
export function writableCapabilities(profileId) {
  return (profile(profileId)?.capabilities ?? []).filter((c) => c.writable);
}

/**
 * Base code -> the actual code for one channel, e.g. `cur_power` -> `cur_power2`.
 *
 * One physical double meter is two logical devices in the registry, and which dps belong to
 * which is the difference between two branch circuits reading correctly and reading each
 * other's load.
 */
export function channelCodesFor(profileId, channel = 1) {
  const out = {};
  for (const c of profile(profileId)?.capabilities ?? []) {
    if (c.channel === channel) out[c.base] = c.code;
  }
  return out;
}

/**
 * A raw Tuya dps object -> capability codes with values already in canonical units.
 *
 * Absent dps stay absent rather than becoming zero — the same rule `buildLatest` follows, and for
 * the same reason: a stale `0 W` reads as an idle device, which is a lie a missing value never
 * tells. Unknown dps are dropped, so a firmware update that adds one cannot inject an unnamed
 * field into everything downstream.
 */
export function decodeDps(profileId, dps) {
  const out = {};
  if (!dps || typeof dps !== 'object') return out;
  for (const c of profile(profileId)?.capabilities ?? []) {
    const raw = dps[c.dp] ?? dps[String(c.dp)];
    if (raw === undefined || raw === null) continue;
    if (c.kind === 'value') {
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      const scaled = n / divisorFor(c);
      // Float division of scaled integers produces 0.30000000000000004-shaped noise. Six places
      // is well beyond any of these dps' real resolution and keeps the value printable.
      out[c.code] = Math.round(scaled * 1e6) / 1e6;
    } else if (c.kind === 'bool') {
      out[c.code] = Boolean(raw);
    } else if (c.kind === 'enum' && c.aliases) {
      // One dp, several spellings depending on which vendor path served it. Fold them here so
      // nothing downstream has to know, or has to guess when it meets an unfamiliar one.
      out[c.code] = c.aliases[raw] ?? raw;
    } else {
      out[c.code] = raw;
    }
  }
  return out;
}
