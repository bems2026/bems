/**
 * Which devices can report an ambient temperature, which field on their reading carries it, and
 * — the part that matters most here — WHAT AIR that reading is actually of.
 *
 * WHY THIS FILE EXISTS. Nothing in this repo knew. `shared/deviceCapabilities.mjs` declares no
 * temperature capability at all (these devices are read from Node-RED flow context, not from
 * dps), and the field names are decided inline in `shared/buildLatest.mjs`. A closed-loop
 * controller and the screen that configures it must not be able to disagree about where the
 * number comes from, so it is decided once, here, in `shared/` — the same argument
 * `shared/commands.mjs` makes for itself.
 *
 * THE MEASUREMENT CAVEAT IS THE POINT, not a footnote. On this site the two devices that report
 * a temperature are both misleading if taken at face value:
 *
 *   `sens_outside_temp` reads `ac_dash_state.outTemp` — OUTDOOR air. It is a temperature source,
 *     so a naive picker offers it, and a rule closed on it can never reach a room target: no
 *     amount of cooling moves the weather. Choosing it is a configuration mistake that presents
 *     as a bug.
 *   `acu_main` reports `roomTemp` — RETURN AIR at the indoor unit, which is the air being drawn
 *     over the coil rather than the air in the room. A loop closed on it settles COLDER than the
 *     target, by however much the unit's own draw-down is.
 *
 * Neither of those is a defect to fix in code; they are facts about the instrumentation. The
 * rule editor states them where the choice is made, which is the only place they help.
 */

/** Reading field by device class. Derived from `buildLatest`'s own branches. */
export const TEMPERATURE_FIELD_BY_CLASS = Object.freeze({
  acu_ir: 'room_temp_c',
  sensor_temp_humidity: 'temp_c',
});

/** What the air actually is, and how well it can stand in for "the room". */
export const MEASURES = Object.freeze({
  room_air: {
    id: 'room_air',
    label: 'Room air',
    caveat: null,
  },
  return_air: {
    id: 'return_air',
    label: 'Return air at the indoor unit',
    caveat: 'This is the air being drawn over the coil, not the air in the room. A rule closed on it settles colder than its target.',
  },
  outdoor_air: {
    id: 'outdoor_air',
    label: 'Outdoor air',
    caveat: 'This is outside air. A rule closed on it can never reach a room target, because cooling the room does not change it.',
  },
});

/** The default for a class, when the site does not say otherwise. */
const DEFAULT_MEASURES_BY_CLASS = Object.freeze({
  acu_ir: 'return_air',
  sensor_temp_humidity: 'room_air',
});

/** The reading field this device's temperature arrives on, or null if it reports none. */
export function temperatureFieldFor(device) {
  return TEMPERATURE_FIELD_BY_CLASS[device?.class] ?? null;
}

/**
 * What this device's temperature is a temperature OF.
 *
 * A SITE FACT FIRST. `measures` lives on the registry entry beside `state_field`, because which
 * air a sensor is in is a property of where somebody physically put it — not of its class. The
 * class default is the fallback for a device nobody has recorded it for.
 */
export function measuresFor(device) {
  const declared = device?.measures;
  if (declared && MEASURES[declared]) return MEASURES[declared];
  const byClass = DEFAULT_MEASURES_BY_CLASS[device?.class];
  return byClass ? MEASURES[byClass] : null;
}

/** Every device that could be a rule's sensor, with what it measures. */
export function temperatureSources(devices) {
  return (devices ?? [])
    .filter((d) => temperatureFieldFor(d) !== null)
    .map((device) => ({ device, field: temperatureFieldFor(device), measures: measuresFor(device) }));
}

/**
 * The temperature to control on, or a reason there is none.
 *
 * ABSENT, OFFLINE AND STALE ARE DISTINCT REASONS, and none of them substitutes a value. A
 * controller that guesses a room temperature moves a compressor on a guess.
 *
 * The staleness budget is the EXPIRY rule, not the badge rule. `src/lib/staleness.ts` dims a
 * card at 30 s because a late reading still describes the building; it treats 5 minutes as the
 * point where a reading stops being a measurement and becomes a memory. Moving a compressor is
 * the second question, so the default here is the second number.
 *
 * @returns {{ok: true, value: number, ageMs: number}
 *          |{ok: false, reason: 'no_field'|'no_reading'|'offline'|'absent'|'stale', ageMs?: number}}
 */
export function readTemperature(device, reading, { now, maxAgeMs = 300_000 } = {}) {
  const field = temperatureFieldFor(device);
  if (field === null) return { ok: false, reason: 'no_field' };
  if (!reading) return { ok: false, reason: 'no_reading' };
  // Checked before the value: a device that is offline may still be carrying the last number it
  // ever sent, and that number is not evidence of anything now.
  if (reading.online === false) return { ok: false, reason: 'offline' };

  const value = reading[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false, reason: 'absent' };

  const ts = Date.parse(reading.ts ?? '');
  if (!Number.isFinite(ts)) return { ok: false, reason: 'stale' };
  const ageMs = (now?.getTime?.() ?? Date.now()) - ts;
  if (ageMs > maxAgeMs) return { ok: false, reason: 'stale', ageMs };

  return { ok: true, value, ageMs };
}
