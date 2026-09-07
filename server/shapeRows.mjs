/**
 * Pure transforms: bridge payload shapes -> Supabase table row shapes.
 *
 * Deliberately mirrors `docs/storage-contract.md`'s schema, which is itself additive to
 * `docs/bridge-contract.md`'s field names — never a rename. No I/O here; kept pure so it's
 * cheap to test without a live bridge or Supabase project (see `ingest.test.mjs`).
 */
import { SITE, DEVICE_REGISTRY } from '../shared/registry.mjs';
import { scrubReading, scrubTotals, readingBounds, totalsBounds } from './scrubTelemetry.mjs';
import { promoteCapabilities } from './readingCapabilities.mjs';

/** id -> registry entry. `promoteCapabilities` needs the device's CHANNEL to resolve a code. */
const DEVICE_BY_ID = new Map(DEVICE_REGISTRY.map((d) => [d.id, d]));

/**
 * Splits `GET /api/readings/latest`'s response (per-device rows + the `_totals`
 * pseudo-entry) into a `readings` rows array and a `building_totals` row.
 *
 * Deliberately drops `state`/`socket_states` — `docs/bridge-contract.md` documents these
 * as transient device state, not readings; the `readings` table has no such column.
 *
 * EVERY ROW IS SCRUBBED ON THE WAY THROUGH — see `server/scrubTelemetry.mjs`. Until then this
 * function was seven `?? null` assignments that checked nothing, which is how 3,625 kWh on a
 * 36 W circuit reached Supabase. A refused field becomes `null` and the row survives; a row
 * whose timestamp cannot key it is dropped, and both are counted so nothing is discarded
 * silently.
 *
 * SINCE phase28 IT ALSO KEEPS WHAT THE DEVICE SAYS BEYOND VOLTS, AMPS AND WATTS — see
 * `server/readingCapabilities.mjs`. Those values were on the wire every minute and thrown away
 * every minute. A device this registry does not know contributes no capability columns rather
 * than guessed ones: an unknown device cannot have its channel resolved, and a channel guessed
 * wrong attributes one branch circuit's totals to another.
 *
 * `nowMs` is a parameter rather than a `Date.now()` read inside, so the timestamp window is
 * testable against fixed fixtures instead of drifting out from under them.
 *
 * @returns {{readings: object[], totals: object|null, rejections: object[]}}
 */
export function splitLatestPayload(latest, nowMs = Date.now(), site = SITE) {
  const readings = [];
  let totals = null;
  const rejections = [];
  const rBounds = readingBounds(site);
  const tBounds = totalsBounds(site);

  for (const entry of latest) {
    if (entry.device_id === '_totals') {
      const shaped = {
        ts: entry.ts,
        // RM-027. `building_totals.site_id` carries a column default so that phase20 could be
        // applied to a running system whose code did not yet send one — see the migration's own
        // header. Naming it here is what lets RM-030 drop that default without an outage: a
        // default is a safety net for old writers, not a substitute for a writer knowing where
        // its data came from.
        site_id: SITE.id,
        energy_kwh_today: entry.energy_kwh_today ?? null,
        energy_kwh_week: entry.energy_kwh_week ?? null,
        energy_kwh_month: entry.energy_kwh_month ?? null,
        total_power_w: entry.total_power_w ?? null,
        avg_voltage: entry.avg_voltage ?? null,
        // phase_current.blue is intentionally null, not 0 — no Blue-phase meter installed.
        phase_current_red: entry.phase_current?.red ?? null,
        phase_current_yellow: entry.phase_current?.yellow ?? null,
        phase_current_blue: entry.phase_current?.blue ?? null,
      };
      const scrubbed = scrubTotals(shaped, tBounds, nowMs);
      rejections.push(...scrubbed.rejections);
      // `null` here means the totals row had no usable timestamp, so it is skipped for this
      // tick. The per-device readings above are unaffected — they carry their own `ts`.
      totals = scrubbed.row;
      continue;
    }
    const device = DEVICE_BY_ID.get(entry.device_id);
    const scrubbed = scrubReading({
      device_id: entry.device_id,
      ts: entry.ts,
      voltage: entry.voltage ?? null,
      current: entry.current ?? null,
      power_w: entry.power_w ?? null,
      energy_kwh_today: entry.energy_kwh_today ?? null,
      online: !!entry.online,
      // Merged before the scrub, which only ever rewrites its own four numeric fields and
      // copies the rest through. Both routes append to the same `rejections`, so a capability
      // the catalogue refuses is counted exactly like a reading out of bounds.
      ...(device ? promoteCapabilities(device, entry.capabilities, rejections) : {}),
    }, rBounds, nowMs);
    rejections.push(...scrubbed.rejections);
    if (scrubbed.row) readings.push(scrubbed.row);
  }

  return { readings, totals, rejections };
}

/**
 * `GET /api/devices` -> `devices` table rows. `shared/registry.mjs` stays the actual
 * source of truth; this only shapes what the bridge already serves, never re-derives it.
 */
export function shapeDeviceRows(devices) {
  return devices.map((d) => ({
    id: d.id,
    display_name: d.display_name,
    class: d.class,
    room: d.room ?? null,
    dps_map: d.dps_map ?? null,
    sockets: d.sockets ?? null,
    branch_circuit: d.branch_circuit ?? null,
    status: d.status ?? null,
  }));
}

/**
 * `detectAnomaly()` results for one tick -> `anomalies` table rows. Only called with
 * entries the caller has already filtered to `detection.isAnomaly === true` — this
 * function only shapes, it doesn't decide.
 */
export function shapeAnomalyRows(entries) {
  return entries.map(({ deviceId, ts, value, detection }) => ({
    device_id: deviceId,
    ts,
    metric: 'power_w',
    value,
    baseline_mean: detection.baselineMean,
    baseline_stddev: detection.baselineStddev,
    z_score: detection.zScore,
    iqr_lower: detection.iqrLower,
    iqr_upper: detection.iqrUpper,
    method: detection.method,
    sample_count: detection.sampleCount,
  }));
}
