/**
 * phase28: promoting what a device reports beyond volts, amps and watts into `readings`.
 *
 * Four questions could not be asked of the history at all, and all four were already on the
 * wire — the devices have always reported them and this daemon discarded them every minute:
 * which branch tripped its power warning, a meter's lifetime total, whether an outlet reported
 * a fault before it went dark, and whether a device was on the cloud or the local segment when
 * it stopped answering. `supabase/phase28_reading_capabilities.sql` makes room; this decides
 * what goes in it.
 *
 * Pure, and separate from `shapeRows.mjs` for the reason `healthRow.mjs` is separate from
 * `ingest.mjs`: the decisions here are worth testing on their own, and two of them are the kind
 * that fail silently.
 *
 * THE CHANNEL IS RESOLVED FROM THE CATALOGUE, NEVER ASSEMBLED. `total_energy1` and
 * `total_energy2` are two different branch circuits on one physical meter, so a hand-built name
 * would eventually put one circuit's lifetime total on the other's history — the failure
 * `capabilityForDevice`'s own header describes, and why CLAUDE.md says capability codes are
 * keyed by PRODUCT rather than by class. It is also not uniform: dp 113 is `net_state` on the
 * single-channel meter and `device_state2` on the dual-channel one, and both are `class:
 * 'meter'`.
 *
 * A VALUE OUTSIDE A CLOSED VOCABULARY IS REFUSED HERE, not sent. `power_type` and `net_state`
 * carry CHECK constraints, and a constraint violation does not fail one field — PostgREST
 * rejects the whole batch, `writeOrBuffer` appends it to the outage buffer, and `flushBuffer`
 * replays it at the head of every subsequent cycle for ever. That is the same permanent wedge
 * `server/scrubTelemetry.mjs` exists to prevent, reached by a different route, so a drift
 * between the catalogue and the hardware costs one column and is counted like any other
 * rejection instead of stopping the history of a real building.
 */

import { capabilityForDevice } from '../shared/deviceCapabilities.mjs';

/** The columns phase28 adds. Named once, so the writer and the error-matcher cannot disagree. */
export const PHASE28_COLUMNS = Object.freeze([
  'total_energy_kwh', 'warn_power_w', 'power_type', 'net_state', 'fault', 'capabilities',
]);

/**
 * column -> the capability BASE it comes from, and how to read it.
 *
 * `base` rather than `code`: `capabilityForDevice` resolves a base to whichever code carries it
 * on this device's channel, and returns nothing when the product does not report it at all —
 * which is exactly the "absent" this should record as null.
 */
const PROMOTED = Object.freeze([
  { column: 'total_energy_kwh', base: 'total_energy', kind: 'number' },
  { column: 'warn_power_w', base: 'warn_power', kind: 'number' },
  { column: 'power_type', base: 'power_type', kind: 'enum' },
  { column: 'net_state', base: 'net_state', kind: 'enum' },
  { column: 'fault', base: 'fault', kind: 'integer' },
]);

/** One refused value, in the shape `server/scrubTelemetry.mjs` already produces. */
class CapabilityRejection {
  constructor(deviceId, column, value, reason) {
    this.device_id = deviceId;
    this.field = column;
    this.value = value;
    this.reason = reason;
  }

  toString() {
    const v = typeof this.value === 'string' ? JSON.stringify(this.value) : String(this.value);
    return `${this.device_id}.${this.field}=${v} ${this.reason}`;
  }
}

/**
 * The phase28 columns for one device's reading.
 *
 * @param {object} device      the registry entry — carries the channel
 * @param {object|null} caps   the decoded capabilities from the wire, keyed by vendor code
 * @param {Array} rejections   appended to, in the scrub's shape
 */
export function promoteCapabilities(device, caps, rejections = []) {
  const row = {};
  for (const col of PHASE28_COLUMNS) row[col] = null;
  if (!caps || typeof caps !== 'object') return row;

  const taken = new Set();

  for (const { column, base, kind } of PROMOTED) {
    const cap = capabilityForDevice(device, base);
    // The product does not report this at all — a light switch has no lifetime total, and no
    // amount of looking will produce one.
    if (!cap) continue;
    const value = caps[cap.code];
    if (value === undefined || value === null) continue;
    taken.add(cap.code);

    if (kind === 'enum') {
      // The vocabulary is the catalogue's, not a second list written here. A value outside it
      // means the catalogue and the hardware have drifted, which is the thing worth catching.
      if (Array.isArray(cap.range) && !cap.range.includes(value)) {
        rejections.push(new CapabilityRejection(
          device.id, column, value, `is not one of ${cap.range.join('/')} — catalogue and device disagree`));
        continue;
      }
      row[column] = value;
    } else if (kind === 'integer') {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        rejections.push(new CapabilityRejection(device.id, column, value, 'is not an integer'));
        continue;
      }
      row[column] = value;
    } else {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        rejections.push(new CapabilityRejection(device.id, column, value, 'is not a finite number'));
        continue;
      }
      row[column] = value;
    }
  }

  // The long tail: everything not promoted above. `null` rather than `{}` when there is nothing
  // left, because an empty object claims "reported nothing", which is a different fact from
  // "reported nothing beyond what was promoted".
  const rest = {};
  for (const [code, value] of Object.entries(caps)) {
    if (!taken.has(code)) rest[code] = value;
  }
  row.capabilities = Object.keys(rest).length ? rest : null;

  return row;
}

/**
 * Whether an upsert failure means phase28 has not been applied to this database yet.
 *
 * WHY THIS EXISTS. `supabase/phase28_reading_capabilities.sql`'s own header says it: PostgREST
 * rejects an insert naming a column that does not exist, so widening this daemon before the
 * migration is applied "would stop ingestion outright — on a table that is the history of a
 * real building". Migrations here are applied by hand, so the ordering is a human step and this
 * is what makes getting it backwards survivable rather than catastrophic: the daemon says so
 * once, drops the six columns, and keeps writing everything it wrote before.
 */
export function isMissingCapabilityColumnError(err) {
  const text = String(err ?? '');
  return PHASE28_COLUMNS.some((column) => text.includes(`'${column}'`) || text.includes(`"${column}"`));
}

/** The same rows without phase28's columns, for the retry. Does not mutate its input. */
export function withoutCapabilityColumns(rows) {
  return rows.map((row) => {
    const out = { ...row };
    for (const column of PHASE28_COLUMNS) delete out[column];
    return out;
  });
}
