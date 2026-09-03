/**
 * Decides WHEN the fleet is in trouble, for the out-of-dashboard alert channel (FI-005).
 *
 * WHY A STATE MACHINE RATHER THAN A CHECK: the ingest daemon ticks every 60 s, so a
 * level-triggered condition would re-send the same notification every minute for as long as
 * the fault lasted. Six outlets down overnight is 480 notifications, and the first thing
 * anyone does with that is mute the channel — strictly worse than no alerting at all. This
 * fires on the EDGE: once when the fleet enters the state, once when it leaves.
 *
 * WHY IT REMEMBERS WHICH DEVICES HAVE BEEN UP: the same reason `fleetStuck` splits on
 * `online_samples` in the frontend. Two devices on this site are offline permanently and by
 * design (the quiesced IR blaster and outside-temp sensor). Counting them would put the fleet
 * over the threshold from the moment the daemon started and hold it there forever, which is
 * how a warning becomes furniture.
 *
 * THE SET IS SEEDED, and the correction is worth stating because this file used to claim the
 * opposite. It said the in-process state "resets when the daemon restarts, which re-arms the
 * alarm — correct, because a restart is also when the operator is most likely to want to know
 * the fleet came back up wrong." A restart in fact DISARMS it, for exactly the devices that are
 * already broken, which is that case.
 *
 * Measured 2026-09-03: the fleet went from 18 devices to 4 after a site power cycle and stayed
 * there for nine hours. **No alert was ever sent.** `ibems-ingest` restarted at 07:51 with
 * sixteen devices already offline; none was observed online during that process, so none entered
 * the set, so none could count as down. The alarm was blind to the largest outage this system
 * has had.
 *
 * `knownOnline` closes it, from the history the database already holds. The furniture guard
 * survives intact: a device that has NEVER reported online has no history, so it still cannot
 * contribute. And a seed that is missing, empty or unusable degrades to the old behaviour rather
 * than to alarming on everything — the seed is a database read, databases are unreachable
 * sometimes, and a failed read must not manufacture a fleet alarm.
 */

/**
 * How many simultaneously-down devices make it a fleet event rather than one flaky device.
 * Mirrors `FLEET_STUCK_AT` in `src/lib/deviceConnectivity.ts`; the two are the same judgement
 * seen from opposite ends, and if one moves the other should.
 */
export const DEFAULT_THRESHOLD = 3;

/** How far back a device must have worked to count as "known good" — see `loadKnownOnline`. */
export const KNOWN_ONLINE_DAYS = 7;

/**
 * Which of `deviceIds` reported online in the last `days`, asked ONE DEVICE AT A TIME.
 *
 * WHY NOT ONE BULK QUERY, which is the obvious shape and was the first implementation: PostgREST
 * caps result sets server-side and does it SILENTLY. Measured 2026-09-03 — `readings` had 145,350
 * matching rows over seven days, the request asked for `limit=20000`, and **1,000 came back**.
 * The distinct devices in that arbitrary slice happened to be 15 of 18. Nothing in the response
 * said it had been truncated, and a seed short by three devices restores the exact blind spot
 * this function exists to close, for whichever devices fall outside the slice.
 *
 * This project has met that cap before — `supabaseHistory.ts` carries `assertNotTruncated` and
 * `demand-profile.mjs` paginates around it. Pagination would work here too; per-device
 * `limit=1` is chosen instead because it cannot be wrong. The fleet is twenty devices, the
 * question is a boolean per device, and the answer does not depend on how many rows a server
 * decided to return.
 *
 * A device whose query fails is OMITTED rather than assumed good: this feeds an alarm, and a
 * device wrongly seeded would let a transient read failure raise a fleet alert. Returns null only
 * when every query failed, which the caller treats as "start unseeded".
 */
export async function loadKnownOnline({ select, deviceIds, days = KNOWN_ONLINE_DAYS, nowMs = Date.now() }) {
  const since = new Date(nowMs - days * 86400000).toISOString();
  const ids = Array.isArray(deviceIds) ? deviceIds.filter((d) => typeof d === 'string') : [];
  if (!ids.length) return null;

  let failures = 0;
  const results = await Promise.all(ids.map(async (id) => {
    try {
      const rows = await select('readings', `select=device_id&device_id=eq.${encodeURIComponent(id)}&online=is.true&ts=gte.${since}&limit=1`);
      return Array.isArray(rows) && rows.length > 0 ? id : null;
    } catch {
      failures += 1;
      return null;
    }
  }));

  if (failures === ids.length) return null;
  return results.filter((id) => id !== null);
}

export function createFleetAlarm({ threshold = DEFAULT_THRESHOLD, knownOnline } = {}) {
  /**
   * Devices observed online at least once since this process started, PLUS those the caller
   * knows have a history of being online. Anything not an array is ignored rather than trusted,
   * so a failed database read starts the daemon blind instead of making it alarm on everything.
   */
  const everOnline = new Set(Array.isArray(knownOnline) ? knownOnline.filter((d) => typeof d === 'string') : []);
  let alarming = false;

  return {
    /**
     * @param readings rows shaped like `/api/readings/latest`
     * @returns `{ kind: 'stuck' | 'recovered', devices }` on a transition, otherwise null
     */
    observe(readings) {
      const rows = Array.isArray(readings) ? readings : [];
      const down = [];

      for (const r of rows) {
        if (!r || r.device_id === '_totals') continue;
        // Only a real boolean counts. `null`/absent means the reading did not say, and
        // inferring "down" from silence is how a bridge hiccup becomes a fleet alarm.
        if (r.online === true) everOnline.add(r.device_id);
        else if (r.online === false && everOnline.has(r.device_id)) down.push(r.device_id);
      }

      // A device missing from this tick entirely is a gap in the feed, not a claim about the
      // hardware — it simply does not appear in `down`, which is the behaviour we want.
      const stuck = down.length >= threshold;

      if (stuck && !alarming) {
        alarming = true;
        return { kind: 'stuck', devices: down.sort() };
      }
      if (!stuck && alarming) {
        alarming = false;
        return { kind: 'recovered', devices: down.sort() };
      }
      return null;
    },
  };
}
