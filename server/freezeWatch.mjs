/**
 * Frozen measurements, as events — RM-163, 2026-10-14.
 *
 * WHY. The bridge flags a reading `measurement_frozen` only after its rule's wait (three hours under load, up
 * to twelve at 0 W: `shared/measurementFreeze.mjs`), and until now nothing acted on the flag but the pages
 * that drew it. With the site offline from 7 to 14 October the four CT meters sat frozen for days; nobody was
 * told. (They resumed when the internet returned, RM-165, not when power-cycled.) Ingest feeds each tick's readings through this, and for
 * every freeze it marks the archive back to the freeze's start (so the minutes before the flag are not stored
 * as measurements) and tells the operator, once.
 *
 * `started` carries a freeze first seen, or one whose `frozen_since` moved earlier. `cleared` carries a device whose
 * reading has gone unflagged for `CLEAR_AFTER_MS`, with the freeze's start and the first unflagged tick. A device
 * absent from a tick is neither: an outage is not a recovery.
 *
 * RM-165, 2026-10-28: WHY TEN MINUTES. On 27-28 October the bridge's flag dropped for one minute about twenty
 * times and came back with the same `frozen_since`; each drop told the operator "moving again" and then "frozen".
 * A flag back within ten minutes is the same freeze, so it neither clears nor starts anything.
 */
export const CLEAR_AFTER_MS = 10 * 60_000;

export function createFreezeWatch({ clearAfterMs = CLEAR_AFTER_MS } = {}) {
  const tracked = new Map(); // device id -> { since, absentFrom: ts of the first unflagged tick, or null }
  return {
    observe(readings) {
      const started = [];
      const cleared = [];
      for (const r of readings ?? []) {
        const id = r?.device_id;
        if (!id) continue;
        const caps = r.capabilities;
        const frozenSince = caps && caps.measurement_frozen === true && typeof caps.frozen_since === 'string' ? caps.frozen_since : null;
        const held = tracked.get(id);
        if (!frozenSince) {
          if (held === undefined) continue;
          if (held.absentFrom === null) held.absentFrom = r.ts;
          if (Date.parse(r.ts) - Date.parse(held.absentFrom) >= clearAfterMs) {
            tracked.delete(id);
            cleared.push({ deviceId: id, frozenSince: held.since, clearedAt: held.absentFrom });
          }
          continue;
        }
        if (held === undefined || Date.parse(frozenSince) < Date.parse(held.since)) {
          tracked.set(id, { since: frozenSince, absentFrom: null });
          started.push({ deviceId: id, frozenSince, ts: r.ts });
        } else {
          held.absentFrom = null;
        }
      }
      return { started, cleared };
    },
    /** RM-165: the freezes being tracked, for the edge status the page reads. */
    current() {
      return [...tracked].map(([deviceId, t]) => ({ deviceId, frozenSince: t.since }));
    },
  };
}

const siteTime = (iso) => {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? String(iso) : new Date(ms + 8 * 3_600_000).toISOString().replace('T', ' ').slice(0, 16);
};

/** The operator's notice for one freeze. A meter's cure is the one measured on 2026-10-28: the internet returning. */
export function freezeMessage({ name, frozenSince, isMeter }) {
  return {
    title: `${name}: readings frozen`,
    body: `${name} has repeated one reading since ${siteTime(frozenSince)} (site time). Its minutes are kept but marked frozen, not counted as measured. `
      + (isMeter
        // RM-165 (E-260): on 2026-10-28 all four meters resumed within minutes of the site network's internet
        // returning, untouched; power-cycling them while it was down had not helped. Their registers kept counting.
        ? 'These meters hold their readings while the site network has no internet and resume by themselves when it returns; a power cycle while it is down did not help (2026-10-28). Their energy registers keep counting, so the held energy is recovered as an estimate once they resume.'
        : 'Check the device; restarting Node-RED cures a stuck session, a power cycle a stuck device.'),
    priority: 'high',
  };
}
