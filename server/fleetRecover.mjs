/**
 * Whether a Node-RED restart is the right move right now, from evidence — RM-131.
 *
 * THE TWO STATES. From the bridge's side a device is "offline" and that is all it says. Underneath
 * that are two conditions with opposite remedies:
 *   - the device is gone: not associated, nothing answers. Power-cycle it (RM-020). No software helps.
 *   - the device is reachable — its address accepts TCP on 6668, or it announced itself minutes ago —
 *     and its node has given up. On 2026-08-25 `l6` sat in this state with a written diagnosis of a
 *     hardware fault, and a Node-RED restart reconnected it in two seconds. After the 2026-09-21
 *     outage test every switch and outlet sat in it for a day.
 * This module acts only on the second, and only with restraint: the evidence must hold on two
 * consecutive checks (a device mid-reboot accepts TCP for a moment too), the last restart must be an
 * hour behind, and the Pi must be well past boot — a restart drops every live session for a minute,
 * the meters' included, so it has to be earned.
 *
 * Pure. The runner gathers the observations and performs the restart; this decides.
 */

export const STREAK_TO_RESTART = 2;
export const RESTART_COOLDOWN_MS = 60 * 60 * 1000;
export const BOOT_GRACE_MS = 10 * 60 * 1000;

/**
 * @param {{ now: number, bootedAt: number, lastRestartAt: number|null,
 *           streaks: Record<string, number>,
 *           observations: Array<{ name: string, offline: boolean, evidence: string|null }> }} args
 *        `evidence` is the reachability proof for an offline device, in words, or null when there is none.
 * @returns {{ restart: boolean, reasons: string[], streaks: Record<string, number> }}
 */
export function decideRecovery({ now, bootedAt, lastRestartAt, streaks = {}, observations = [] }) {
  const next = {};
  const reasons = [];
  const earned = [];
  for (const o of observations) {
    if (!o.offline || !o.evidence) continue;
    next[o.name] = (streaks[o.name] ?? 0) + 1;
    if (next[o.name] >= STREAK_TO_RESTART) earned.push(`${o.name}: offline to the bridge yet ${o.evidence}, seen ${next[o.name]} checks running`);
    else reasons.push(`${o.name}: offline to the bridge yet ${o.evidence} — seen once, waiting for a second check`);
  }
  reasons.push(...earned);

  if (earned.length === 0) return { restart: false, reasons, streaks: next };
  if (now - bootedAt < BOOT_GRACE_MS) {
    reasons.push(`not restarting: the Pi booted ${Math.round((now - bootedAt) / 60000)} min ago, inside the boot grace`);
    return { restart: false, reasons, streaks: next };
  }
  if (lastRestartAt !== null && now - lastRestartAt < RESTART_COOLDOWN_MS) {
    reasons.push(`not restarting: the last restart was ${Math.round((now - lastRestartAt) / 60000)} min ago, inside the cooldown`);
    return { restart: false, reasons, streaks: next };
  }
  return { restart: true, reasons, streaks: next };
}

/**
 * Pinned nodes whose device has announced itself lately from a DIFFERENT address — the one case a
 * static `deviceIp` makes worse than discovery: the node connects nowhere and no longer listens.
 * Reported, never acted on: re-addressing is a flow write, and flow writes are a person's call
 * (`npm run set-device-ip:pi -- --from-lan-map`). A DHCP reservation on the access point is what
 * makes this never happen.
 */
export function driftedAddresses(nodes, lanMap, { now = Date.now(), withinMs = 15 * 60 * 1000 } = {}) {
  const out = [];
  for (const n of nodes) {
    if (!n.deviceIp) continue;
    const e = lanMap[n.deviceId];
    if (!e || !e.ip || e.ip === n.deviceIp) continue;
    const seen = Date.parse(e.lastSeen ?? '');
    if (!Number.isFinite(seen) || now - seen > withinMs) continue;
    out.push({ name: n.deviceName, pinned: n.deviceIp, announced: e.ip });
  }
  return out;
}
