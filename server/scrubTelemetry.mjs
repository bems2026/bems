/**
 * The ingestion guard. Pure — no I/O, no imports beyond the site's own declared numbers.
 *
 * WHY IT EXISTS. `shapeRows.mjs` validated nothing: `splitLatestPayload` was seven `?? null`
 * assignments with no type, finiteness, range or timestamp check anywhere between the bridge
 * and Supabase. On 2026-09-03 a CT meter channel reported 3,625 kWh for a day, on a circuit
 * averaging 36 W, and it landed in `readings` unchallenged. The bridge grew a backstop for that
 * one field (`SITE.max_branch_kwh_per_day`, applied in `buildLatest`) — but the bridge is
 * deployed separately from this daemon and can be older than it, so the write path still had no
 * opinion of its own about what it was storing.
 *
 * WHAT THIS CATCHES AND WHAT IT DOES NOT — the distinction matters, and it is measurable on
 * this fleet right now. co5 reported 72.427 kWh for the local day of 2026-09-06, a day in which
 * its own power readings integrate to 2.268 kWh: overstated 32-fold, and comfortably inside a
 * 100 kWh bound. **A bound wide enough to be safe cannot catch a value that is merely wrong.**
 * Narrowing it until it could would start discarding real readings, which is the worse failure:
 * a stored odd value is visible and arguable, a discarded real one is neither. So this file
 * catches the *impossible* — the shapes that mean a register is carrying garbage or a contract
 * upstream has broken — and inaccuracy is fixed where it is produced, not hidden here.
 *
 * THREE RULES, each with a reason it is the way round it is:
 *
 *   1. OMIT, NEVER ZERO. A rejected field becomes `null`, matching `buildLatest`'s `num()`.
 *      "No data" and "zero watts" are different facts, they render differently, and only one of
 *      them averages into an hourly rollup.
 *   2. NEVER DROP A ROW FOR A BAD VALUE. `online` carries the truth about the device, and this
 *      series currently has no holes at all (359 samples in 359 minutes, 0% missing). One bad
 *      field must not cost the other six.
 *   3. A ROW WITH NO USABLE TIMESTAMP IS NOT A ROW. `ts` is half the upsert key, so it cannot
 *      be nulled, and substituting the receipt time would fabricate *when* — the same class of
 *      harm as fabricating a value and much harder to spot later. It is dropped. See
 *      `isUsableTimestamp` for why this is availability protection and not fussiness.
 */

/**
 * How far ahead of the ingest daemon's clock a reading's timestamp may sit.
 *
 * The bridge stamps these from the Pi's own clock (`buildLatest`'s `iso8(nowMs)`) and this
 * daemon runs on the same host, so in normal operation the skew is the network round trip.
 * Minutes of headroom covers an NTP step; hours would mean the clock is wrong, and a reading
 * filed in the future is invisible to every "last N hours" query the dashboard makes.
 */
export const TS_MAX_FUTURE_MS = 5 * 60 * 1000;

/**
 * How far behind it may sit.
 *
 * Deliberately enormous relative to the real case — every timestamp this function sees is
 * minted moments earlier by the bridge. Rows recovered from an outage do NOT pass through
 * here (`flushBuffer` replays already-shaped rows straight to `upsert`), so a long outage
 * cannot trip this. Erring wide costs nothing; erring narrow costs real data.
 */
export const TS_MAX_PAST_MS = 7 * 24 * 60 * 60 * 1000;

/** A week and a month, as multiples of the building's daily ceiling. */
const WEEK_DAYS = 7;
const MONTH_DAYS = 31;

/** One refused field, carrying enough to diagnose it without the payload it came from. */
class Rejection {
  constructor(deviceId, field, value, reason) {
    this.device_id = deviceId;
    this.field = field;
    this.value = value;
    this.reason = reason;
  }

  /** So a log line, and `ingestion_health.scrub_last_reason`, read as prose. */
  toString() {
    return `${this.device_id}.${this.field}=${describe(this.value)} ${this.reason}`;
  }
}

/** `String(NaN)` and `String(undefined)` are fine; a string value needs its quotes back so a
 * type break is legible as one rather than looking like a number. */
function describe(value) {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/**
 * Which bounds apply to a per-device `readings` row.
 *
 * Derived from the site rather than declared twice: `energy_kwh_today` reuses the exact
 * `max_branch_kwh_per_day` the bridge already applies, so the two can never drift into
 * disagreeing about the same physical fact.
 *
 * A site with no `telemetry_bounds` gets no bounds and therefore no rejections — a deployment
 * predating this file behaves precisely as it did, because upgrading code must not be a
 * data-loss event.
 */
export function readingBounds(site) {
  const t = site?.telemetry_bounds ?? {};
  const bounds = {};
  if (t.voltage) bounds.voltage = t.voltage;
  if (t.current) bounds.current = t.current;
  if (t.power_w) bounds.power_w = t.power_w;
  if (typeof site?.max_branch_kwh_per_day === 'number') {
    bounds.energy_kwh_today = { min: 0, max: site.max_branch_kwh_per_day };
  }
  return bounds;
}

/**
 * Which bounds apply to the `building_totals` row.
 *
 * The three phase currents share the per-device current bound — they are the same clamps'
 * readings summed per phase, so a bound one of them can breach alone is not a bound.
 * The weekly and monthly ceilings are multiplied out of the daily one rather than declared,
 * so raising a site's daily figure cannot leave a stale weekly one behind that silently
 * rejects that site's real data.
 */
export function totalsBounds(site) {
  const t = site?.telemetry_bounds ?? {};
  const bounds = {};
  if (t.voltage) bounds.avg_voltage = t.voltage;
  if (t.total_power_w) bounds.total_power_w = t.total_power_w;
  if (t.current) {
    for (const phase of ['red', 'yellow', 'blue']) bounds[`phase_current_${phase}`] = t.current;
  }
  if (typeof site?.max_building_kwh_per_day === 'number') {
    const day = site.max_building_kwh_per_day;
    bounds.energy_kwh_today = { min: 0, max: day };
    bounds.energy_kwh_week = { min: 0, max: day * WEEK_DAYS };
    bounds.energy_kwh_month = { min: 0, max: day * MONTH_DAYS };
    // RM-057's independent cross-check measures the same building over the same period, so it
    // is held to the same ceilings. Bounding one and not the other would let the figure the
    // disagreement guard reads be the one nothing checks.
    bounds.energy_kwh_today_integrated = bounds.energy_kwh_today;
    bounds.energy_kwh_week_integrated = bounds.energy_kwh_week;
    bounds.energy_kwh_month_integrated = bounds.energy_kwh_month;
  }
  return bounds;
}

/**
 * Whether a timestamp can key a row at all.
 *
 * THIS IS AVAILABILITY PROTECTION, not tidiness. `iso8(NaN)` returns the literal string
 * `"NaN-NaN-NaNTNaN:NaN:NaN+08:00"`. Postgres rejects that with a 400; `writeOrBuffer` catches
 * the failure and appends the whole batch to the outage buffer; `flushBuffer` replays the
 * buffer oldest-first at the head of every subsequent cycle and re-persists the remainder on
 * the first error. A single permanently-invalid row therefore sits at the head of that queue
 * for ever, and every reading behind it stops reaching Supabase. One malformed timestamp
 * wedges ingestion permanently, and it would read as a database outage.
 */
export function isUsableTimestamp(ts, nowMs) {
  if (typeof ts !== 'string' || ts === '') return false;
  const parsed = Date.parse(ts);
  if (!Number.isFinite(parsed)) return false;
  return parsed <= nowMs + TS_MAX_FUTURE_MS && parsed >= nowMs - TS_MAX_PAST_MS;
}

/**
 * One numeric field. Returns the value to store — `null` when refused — and pushes a
 * `Rejection` when it refuses.
 *
 * `null` and `undefined` are ABSENT, not wrong: a light switch has no metering and no site
 * bound makes that a fault. Counting those would produce thousands of rejections a day and
 * bury the one that matters.
 */
function scrubField(deviceId, field, value, bound, rejections) {
  if (value === null || value === undefined) return null;

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    // Strict about the type on purpose. `docs/bridge-contract.md` says these are numbers and
    // `buildLatest`'s `num()` already guarantees it, so a string or a boolean here is a broken
    // contract upstream. Coercing it would store the value and hide the break — which is the
    // exact failure shape this file exists to end.
    rejections.push(new Rejection(deviceId, field, value, 'is not a finite number'));
    return null;
  }

  if (bound && (value < bound.min || value > bound.max)) {
    rejections.push(new Rejection(deviceId, field, value, `outside [${bound.min}, ${bound.max}]`));
    return null;
  }

  return value;
}

/** The numeric columns of `readings`. `device_id`, `ts` and `online` are not telemetry. */
const READING_FIELDS = ['voltage', 'current', 'power_w', 'energy_kwh_today'];

/** The numeric columns of `building_totals`. `ts` and `site_id` are not telemetry. */
const TOTALS_FIELDS = [
  'energy_kwh_today', 'energy_kwh_week', 'energy_kwh_month',
  // RM-057 — the legacy integration of the same circuits, kept as the independent cross-check.
  'energy_kwh_today_integrated', 'energy_kwh_week_integrated', 'energy_kwh_month_integrated',
  'total_power_w', 'avg_voltage',
  'phase_current_red', 'phase_current_yellow', 'phase_current_blue',
];

function scrubRow(row, fields, bounds, nowMs, deviceId) {
  const rejections = [];

  if (!isUsableTimestamp(row.ts, nowMs)) {
    rejections.push(new Rejection(deviceId, 'ts', row.ts, 'is not a usable timestamp — row dropped'));
    return { row: null, rejections };
  }

  const out = { ...row };
  for (const field of fields) {
    out[field] = scrubField(deviceId, field, row[field], bounds[field], rejections);
  }
  return { row: out, rejections };
}

/** @returns {{row: object|null, rejections: Rejection[]}} */
export function scrubReading(row, bounds, nowMs) {
  return scrubRow(row, READING_FIELDS, bounds, nowMs, row.device_id);
}

/** @returns {{row: object|null, rejections: Rejection[]}} */
export function scrubTotals(row, bounds, nowMs) {
  return scrubRow(row, TOTALS_FIELDS, bounds, nowMs, '_totals');
}
