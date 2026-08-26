/**
 * Decides whether the Pi should move back to its preferred Wi-Fi network.
 *
 * WHY THIS EXISTS: on 2026-08-26 the device AP dropped its DHCP lease at 08:20. NetworkManager
 * failed the connection (`ssid-not-found`), fell back to the general office SSID two seconds
 * later, and **stayed there** once the device AP returned. `autoconnect-priority` does not help:
 * it chooses among candidates at activation time and never roams away from a connection that
 * works. The Pi kept internet and remote access the whole time while every field device became
 * unreachable — the exact failure CLAUDE.md warns about, arriving on its own rather than by
 * anyone touching the config.
 *
 * The fallback is worth keeping. It is what preserved remote access during the outage, and
 * removing it would trade a recoverable problem for an unrecoverable one. So the fix is not to
 * forbid the fallback but to leave it automatically once the preferred network is back.
 *
 * WHAT "PREFERRED" MEANS: the highest `autoconnect-priority` saved Wi-Fi profile. Deliberately
 * derived rather than configured — the operator has already expressed the preference by setting
 * the priority, a second copy could disagree with it, and this repository is public and should
 * not carry the site's SSIDs.
 *
 * This module is pure: no nmcli, no network, no clock of its own. Every refusal returns a reason,
 * because "it did nothing" is the normal outcome and an unexplained no-op is indistinguishable
 * from a broken timer.
 */

export const ACTION = { NONE: 'none', SWITCH: 'switch' };

/** Signal below this is not worth losing a working connection over. nmcli reports 0-100. */
export const DEFAULT_MIN_SIGNAL = 35;

/** After a failed attempt, leave it alone this long. Stops a broken AP causing hourly churn. */
export const DEFAULT_BACKOFF_MS = 2 * 60 * 60 * 1000;

const none = (reason) => ({ action: ACTION.NONE, reason });

/**
 * @param savedWifi     [{ name, ssid, autoconnect, priority }] — saved Wi-Fi profiles
 * @param visible       Map or object of ssid -> signal (0-100), from a scan
 * @param currentSsid   the SSID currently associated, or null when unassociated
 * @param now           epoch ms
 * @param lastFailureAt epoch ms of the last failed attempt, or null
 */
export function decideWifiMove({
  savedWifi = [],
  visible = {},
  currentSsid = null,
  now = Date.now(),
  lastFailureAt = null,
  minSignal = DEFAULT_MIN_SIGNAL,
  backoffMs = DEFAULT_BACKOFF_MS,
} = {}) {
  const signalOf = (ssid) => (visible instanceof Map ? visible.get(ssid) : visible[ssid]);

  const candidates = savedWifi
    .filter((p) => p.autoconnect && p.ssid)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  if (!candidates.length) return none('no autoconnect Wi-Fi profiles are saved');

  const preferred = candidates[0];

  // Nothing to do is the common case and must be cheap and obvious.
  if (currentSsid && currentSsid === preferred.ssid) {
    return none(`already on the preferred network (${preferred.ssid})`);
  }

  // A tie means the operator expressed no preference between them. Moving on a tie would pick
  // arbitrarily and could ping-pong between two equal profiles every time the timer fires.
  const currentProfile = candidates.find((p) => p.ssid === currentSsid);
  if (currentProfile && (currentProfile.priority ?? 0) === (preferred.priority ?? 0)) {
    return none(`current network has equal priority (${currentProfile.priority}); no preference to act on`);
  }

  const signal = signalOf(preferred.ssid);
  if (signal === undefined || signal === null) {
    return none(`preferred network (${preferred.ssid}) is not in range`);
  }
  if (signal < minSignal) {
    return none(`preferred network (${preferred.ssid}) too weak: ${signal} < ${minSignal}`);
  }

  // Backoff is checked LAST, so the log says "would have moved but is backing off" rather than
  // hiding a genuine out-of-range or already-there case behind it.
  if (lastFailureAt !== null && now - lastFailureAt < backoffMs) {
    const mins = Math.ceil((backoffMs - (now - lastFailureAt)) / 60000);
    return none(`backing off for another ${mins} min after a failed attempt`);
  }

  return {
    action: ACTION.SWITCH,
    target: preferred,
    from: currentSsid,
    reason: `preferred network ${preferred.ssid} (priority ${preferred.priority}) is available at signal ${signal}`,
  };
}
