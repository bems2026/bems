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
