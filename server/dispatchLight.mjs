/**
 * The one implementation of "send a device command to the bridge".
 *
 * Shared by server/proxy.mjs (a person clicking in the app), server/scheduler.mjs (a schedule
 * coming due) and automatic load shedding. Extracted rather than copied deliberately: copies
 * of a function that switches real relays are places for the timeout, the auth header, or the
 * success condition to drift apart, and the copy nobody updates is the one still running.
 *
 * One route per device class, because the flow genuinely has three entry points — lights by
 * numeric id, outlets by wire target, the aircon by IR code. They share a token: only the
 * proxy is meant to reach any of them, so it is one trust boundary, not three.
 */

import { dispatchViaCloud } from './dispatchCloud.mjs';
import { TIMING } from '../shared/registry.mjs';
import { resolveTarget } from '../shared/commands.mjs';

export const LIGHT_DISPATCH_TIMEOUT_MS = TIMING.COMMAND_TIMEOUT_MS;

/** The device classes that genuinely reach hardware. Declared here, beside the routing that
 * implements it, so `GET /api/capabilities` can never advertise a class this file cannot
 * actually deliver. */
export const DISPATCH_CLASSES = ['switch', 'outlet_dual', 'acu_ir'];

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
/** `on`/`off` plus an optional setpoint -> the IR code AC Master Logic looks up. `target_c` is
 * validated upstream by shared/commands.mjs; 25 is the fallback the retired dashboard switch
 * used, so a command with no setpoint behaves exactly as that did. */
export function acuMode(cmd) {
  if (cmd.action === 'off') return 'OFF';
  return String(cmd.target_c ?? 25);
}

/** The bridge path and body for one command. Exported for the tests that pin the wire shape. */
export function routeFor(device, cmd) {
  if (device.class === 'switch') {
    return { path: `/light/${parseInt(device.state_key.slice(1), 10)}`, body: { state: cmd.action === 'on' } };
  }
  if (device.class === 'outlet_dual') {
    // Resolved here rather than read off `cmd.target`. The proxy populates that field via
    // validateCommand, but the scheduler builds commands directly and does not — which
    // produced a literal POST to /outlet/undefined until a test caught it. Calling the one
    // shared resolver means every caller gets the same wire key whether it set the field or
    // not, instead of each being trusted to remember.
    const target = resolveTarget(device, cmd.socket);
    return { path: `/outlet/${target}`, body: { state: cmd.action === 'on' } };
  }
  if (device.class === 'acu_ir') {
    return { path: '/acu', body: { mode: acuMode(cmd) } };
  }
  return null;
}

/**
 * POSTs a command to the live flow. Success is decided purely on `res.ok` (HTTP 2xx), never on
 * response body shape — the flow's success responses have no shared envelope, and parsing them
 * would couple this to an implementation detail with no contract behind it. The body is read,
 * best-effort, only for the failure-path `detail` string.
 *
 * Returns `{ok:true}` or `{ok:false, detail}` — never throws.
 */
async function dispatchLocal(device, cmd, { bridgeHost, bridgePort, lightApiToken }) {
  const route = routeFor(device, cmd);
  if (!route) return { ok: false, detail: `no dispatch route for device class ${device.class}` };

  let res;
  try {
    res = await fetch(`http://${bridgeHost}:${bridgePort}${route.path}`, {
      method: 'POST',
      headers: { 'x-auth-token': lightApiToken, 'Content-Type': 'application/json' },
      body: JSON.stringify(route.body),
      signal: AbortSignal.timeout(LIGHT_DISPATCH_TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, detail: `bridge endpoint unreachable: ${String(err)}` };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, detail: `bridge endpoint returned HTTP ${res.status}: ${body}` };
  }
  return { ok: true };
}

/**
 * Dispatches a command, falling back to the vendor cloud when the local path fails.
 *
 * Local is always tried first and is the only path attempted when it succeeds — it is faster,
 * works without internet, and keeps a vendor out of the loop. The fallback exists for one
 * specific failure this system actually has: a device whose inbound socket table is exhausted
 * stops answering locally while its outbound cloud connection stays healthy, which previously
 * meant walking to a breaker. See docs/adr-002-device-recovery-path.md.
 *
 * The result carries `via` so the audit row records which path actually moved the relay. A
 * command that only succeeded through the cloud is evidence the device needs attention, and
 * collapsing that into a bare `dispatched` would hide the one signal worth having.
 *
 * Returns `{ok, via, detail}` — never throws.
 */
export async function dispatchCommand(device, cmd, opts) {
  const local = await dispatchLocal(device, cmd, opts);
  if (local.ok) return { ok: true, via: 'local' };

  // No cloud configured is the ordinary case, not an error: report the local failure as-is
  // rather than appending a second one about a path nobody asked for.
  if (!opts?.cloud?.client) return { ...local, via: 'local' };

  const cloud = await dispatchViaCloud(device, cmd, opts.cloud);
  if (cloud.ok) return { ok: true, via: 'cloud', detail: `local failed (${local.detail}); recovered via cloud` };
  // Both failed. Carry both reasons — which one is the real story depends on the device, and
  // discarding either would make the audit row unactionable.
  return { ok: false, via: 'none', detail: `local: ${local.detail} | cloud: ${cloud.detail}` };
}

/** @deprecated Kept as the old name so nothing silently breaks; use dispatchCommand. */
export const dispatchLightCommand = dispatchCommand;
