/**
 * The one implementation of "send a light command to the bridge".
 *
 * Shared by server/proxy.mjs (a person clicking in the app) and server/scheduler.mjs (a
 * schedule coming due). Extracted rather than copied deliberately: two copies of a function
 * that switches real relays would be two places for the timeout, the auth header, or the
 * success condition to drift apart, and the second copy is exactly the one nobody updates.
 */

import { TIMING } from '../shared/registry.mjs';

export const LIGHT_DISPATCH_TIMEOUT_MS = TIMING.COMMAND_TIMEOUT_MS;

/**
 * POSTs a real light command to the live Node-RED flow's `POST /light/:id` — the SAME
 * entry point the physical node-red-dashboard UI already uses (confirmed against the live
 * flow's own "Auth + validate" function node comment). Only ever called for
 * `device.class === 'switch'` commands while HARDWARE_DISPATCH_ENABLED is true — both
 * callers apply that guard before reaching here. Outlets/ACU have no equivalent endpoint yet.
 *
 * Success/failure is decided purely on `res.ok` (HTTP 2xx), never on response body shape —
 * verified live that the flow's success response has no fixed envelope (its `response`
 * node's statusCode is unset, defaulting to 200, body is the full lights-state object) —
 * parsing that would couple this to an implementation detail with no contract behind it.
 * The body is only read, best-effort, for the failure-path `detail` string.
 *
 * Returns `{ok:true}` or `{ok:false, detail}` — never throws.
 */
export async function dispatchLightCommand(device, cmd, { bridgeHost, bridgePort, lightApiToken }) {
  const lightId = parseInt(device.state_key.slice(1), 10); // 'L3' -> 3
  let res;
  try {
    res = await fetch(`http://${bridgeHost}:${bridgePort}/light/${lightId}`, {
      method: 'POST',
      headers: { 'x-auth-token': lightApiToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: cmd.action === 'on' }),
      signal: AbortSignal.timeout(LIGHT_DISPATCH_TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, detail: `light endpoint unreachable: ${String(err)}` };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, detail: `light endpoint returned HTTP ${res.status}: ${body}` };
  }
  return { ok: true };
}

