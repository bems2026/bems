/**
 * What of a reading's `capabilities` the cloud keeps — RM-148, Stage 3.
 *
 * WHY. Measured 2026-09-29 (E-218): the `capabilities` jsonb was 271 of an average 320 bytes a row
 * in `readings`, the table that was 346 MB of a 392 MB database on a 500 MB plan. Most of it was
 * settings a device repeats every minute: a light switch sends the same `cycle_time`,
 * `switch_inching` and `relay_status` 1,440 times a day, and has 2 distinct sets in a day.
 *
 * WHAT. The edge's archive keeps every code, for good (`server/archiveDb.mjs`). The cloud keeps:
 * - what the catalogue marks as a measurement — `instant`, `increment`, `cumulative_*`;
 * - switch state (`switch_N`), which is the load's history rather than its configuration;
 * - the codes something reads back out of the cloud, pinned in `KEPT_FOR_READERS` — the scrub tools
 *   read `device_state`, which the catalogue calls a diagnostic;
 * - the system's own flags: `measurement_frozen`, `frozen_since` (phase47 reads them), `channel_map`
 *   and `scrub`.
 * Every other `setting` and `diagnostic` code goes to the edge only.
 *
 * A code the catalogue does not know, and a device with no capability profile, are kept whole:
 * this decides by the catalogue's facts, and where it has none it does not guess.
 */

import { capabilityFor } from '../shared/deviceCapabilities.mjs';
import { DEVICE_REGISTRY } from '../shared/registry.mjs';

const MEASUREMENT = new Set(['instant', 'increment', 'cumulative_daily', 'cumulative_total']);
const SYSTEM_KEYS = new Set(['measurement_frozen', 'frozen_since', 'channel_map', 'scrub']);
const SWITCH = /^switch_\d+$/;

/**
 * Capability bases that a tool reads back out of the cloud's rows: `scrubHeldReading.mjs` (the
 * channel's power, current, voltage, state and daily register) and `scrubMeterSwap.mjs` (state,
 * increment and the live values), and the meter-wide register. Pinned by a test.
 */
export const KEPT_FOR_READERS = Object.freeze(['cur_power', 'cur_current', 'cur_voltage', 'device_state', 'today_acc_energy', 'add_ele', 'all_energy']);

const DEVICE_BY_ID = new Map(DEVICE_REGISTRY.map((d) => [d.id, d]));

/**
 * @param {object|undefined} device  the registry entry
 * @param {object|null} caps          the reading's full `capabilities`
 * @returns {object|null}             the cloud's copy; `null` when nothing is left
 */
export function cloudCapabilities(device, caps) {
  if (!caps || typeof caps !== 'object') return caps ?? null;
  const profileId = device?.capability_profile;
  if (!profileId) return caps;

  const kept = {};
  for (const [code, value] of Object.entries(caps)) {
    if (keep(profileId, code)) kept[code] = value;
  }
  return Object.keys(kept).length ? kept : null;
}

function keep(profileId, code) {
  if (SYSTEM_KEYS.has(code)) return true;
  const cap = capabilityFor(profileId, code);
  if (!cap) return true;
  return MEASUREMENT.has(cap.semantic) || SWITCH.test(cap.code) || KEPT_FOR_READERS.includes(cap.base);
}

/** `readings` rows as the cloud gets them: the same rows, with `capabilities` slimmed. Pure. */
export function readingsForCloud(rows) {
  return rows.map((row) => (row && 'capabilities' in row
    ? { ...row, capabilities: cloudCapabilities(DEVICE_BY_ID.get(row.device_id), row.capabilities) }
    : row));
}
