/**
 * Frozen measurements, as events — RM-163, 2026-10-14.
 *
 * WHY. The bridge flags a reading `measurement_frozen` only after its rule's wait (three hours under load, up
 * to twelve at 0 W: `shared/measurementFreeze.mjs`), and until now nothing acted on the flag but the pages
 * that drew it. With the site offline from 7 to 14 October the four CT meters sat frozen for days; nobody was
 * told, and they were revived only by a power cycle. Ingest feeds each tick's readings through this, and for
 * every freeze it marks the archive back to the freeze's start (so the minutes before the flag are not stored
 * as measurements) and tells the operator, once.
 *
 * `started` carries a freeze first seen, or one whose `frozen_since` moved earlier. `cleared` names a device
 * whose reading is no longer flagged. A device absent from a tick is neither: an outage is not a recovery.
 */

export function createFreezeWatch() {
  const since = new Map(); // device id -> frozen_since being tracked
  return {
    observe(readings) {
      const started = [];
      const cleared = [];
      for (const r of readings ?? []) {
        const id = r?.device_id;
        if (!id) continue;
        const caps = r.capabilities;
        const frozenSince = caps && caps.measurement_frozen === true && typeof caps.frozen_since === 'string' ? caps.frozen_since : null;
        const held = since.get(id);
        if (!frozenSince) {
          if (held !== undefined) { since.delete(id); cleared.push(id); }
          continue;
        }
        if (held === undefined || Date.parse(frozenSince) < Date.parse(held)) {
          since.set(id, frozenSince);
          started.push({ deviceId: id, frozenSince, ts: r.ts });
        }
      }
      return { started, cleared };
    },
  };
}

const siteTime = (iso) => {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? String(iso) : new Date(ms + 8 * 3_600_000).toISOString().replace('T', ' ').slice(0, 16);
};

/** The operator's notice for one freeze. A meter's cure is the one measured on 2026-10-14: a power cycle. */
export function freezeMessage({ name, frozenSince, isMeter }) {
  return {
    title: `${name}: readings frozen`,
    body: `${name} has repeated one reading since ${siteTime(frozenSince)} (site time). Its minutes are kept but marked frozen, not counted as measured. `
      + (isMeter
        ? 'These meters do not recover by themselves: power-cycle the meter\'s supply. Nothing on the Pi can revive it.'
        : 'Check the device; restarting Node-RED cures a stuck session, a power cycle a stuck device.'),
    priority: 'high',
  };
}
