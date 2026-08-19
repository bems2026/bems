/**
 * Pure transforms: bridge payload shapes -> Supabase table row shapes.
 *
 * Deliberately mirrors `docs/storage-contract.md`'s schema, which is itself additive to
 * `docs/bridge-contract.md`'s field names — never a rename. No I/O here; kept pure so it's
 * cheap to test without a live bridge or Supabase project (see `ingest.test.mjs`).
 */

/**
 * Splits `GET /api/readings/latest`'s response (per-device rows + the `_totals`
 * pseudo-entry) into a `readings` rows array and a `building_totals` row.
 *
 * Deliberately drops `state`/`socket_states` — `docs/bridge-contract.md` documents these
 * as transient device state, not readings; the `readings` table has no such column.
 */
export function splitLatestPayload(latest) {
  const readings = [];
  let totals = null;

  for (const entry of latest) {
    if (entry.device_id === '_totals') {
      totals = {
        ts: entry.ts,
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
      continue;
    }
    readings.push({
      device_id: entry.device_id,
      ts: entry.ts,
      voltage: entry.voltage ?? null,
      current: entry.current ?? null,
      power_w: entry.power_w ?? null,
      energy_kwh_today: entry.energy_kwh_today ?? null,
      online: !!entry.online,
    });
  }

  return { readings, totals };
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
