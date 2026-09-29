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

/**
 * FLAPPING AND SILENCE, 2026-09-26. Two failures of the plain edge trigger, on one weekend:
 *   - One flaky outlet kept the fleet hovering at the threshold, and the alarm sent 23 notices in
 *     two days, often a minute apart: "stuck", then "recovered", then "stuck". That teaches people
 *     to ignore the channel.
 *   - Once it was "stuck", the outage grew from 3 devices to 15 over three days, and it said
 *     nothing more, because it only speaks on a transition.
 *
 * So, all optional, and all off by default so the behaviour above is unchanged unless asked for:
 *   - `enterAfter` / `leaveAfter`: the condition must hold for that many consecutive ticks before
 *     the alarm enters or leaves. A one-minute flicker changes nothing.
 *   - `growBy`: while alarming, report again (`worse`) when the number down has grown by this
 *     many since the last notice.
 *   - `remindEveryMs`: while alarming, report again (`still`) when this long has passed since the
 *     last notice. A growth notice restarts that clock.
 */
export function createFleetAlarm({
  threshold = DEFAULT_THRESHOLD,
  knownOnline,
  enterAfter = 1,
  leaveAfter = 1,
  growBy = Infinity,
  remindEveryMs = Infinity,
  now = () => Date.now(),
} = {}) {
  /**
   * Devices observed online at least once since this process started, PLUS those the caller
   * knows have a history of being online. Anything not an array is ignored rather than trusted,
   * so a failed database read starts the daemon blind instead of making it alarm on everything.
   */
  const everOnline = new Set(Array.isArray(knownOnline) ? knownOnline.filter((d) => typeof d === 'string') : []);
  let alarming = false;
  // Consecutive ticks on the other side of the threshold from the current state.
  let streak = 0;
  // What the last notice said, and when: the baseline for `worse` and `still`.
  let notifiedCount = 0;
  let notifiedAt = 0;

  const notice = (kind, down) => {
    notifiedCount = down.length;
    notifiedAt = now();
    return { kind, devices: down.sort() };
  };

  return {
    /**
     * @param readings rows shaped like `/api/readings/latest`
     * @returns `{ kind: 'stuck' | 'worse' | 'still' | 'recovered', devices }` when there is something
     *          to say, otherwise null
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

      // On the far side of the threshold from where we are: count it, and act once it has held.
      if (stuck !== alarming) {
        streak += 1;
        if (streak < (alarming ? leaveAfter : enterAfter)) return null;
        streak = 0;
        alarming = stuck;
        return notice(stuck ? 'stuck' : 'recovered', down);
      }
      streak = 0;

      if (alarming && down.length >= notifiedCount + growBy) return notice('worse', down);
      if (alarming && now() - notifiedAt >= remindEveryMs) return notice('still', down);
      return null;
    },
  };
}
