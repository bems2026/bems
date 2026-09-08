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
 * The local route for a capability write — FI-022's endpoint.
 *
 * Deliberately NOT folded into `routeFor`: that function answers "how do I switch this thing",
 * and every one of its three routes takes a relay state. A settings write is a different verb to
 * a different endpoint with a different body, and giving it its own resolver is what keeps a
 * caller from accidentally sending `{state: ...}` to it.
 *
 * The value is passed in CANONICAL units and the flow node applies the capability's own divisor,
 * so this does not need the catalogue — and cannot disagree with it.
 */
export function capabilityRouteFor(device, cmd) {
  if (!hasLocalCapabilityRoute(device) || !cmd?.capability) return null;
  return {
    path: `/capability/${device.id}`,
    body: { capability: cmd.capability, value: cmd.value },
  };
}

/**
 * Whether a capability write can go over the LAN for THIS device — FI-022.
 *
 * IT USED TO BE `false` FOR EVERYTHING, and the reason was real: the three relay routes are
 * hand-built `http in` nodes on tabs `build-flow.mjs` deliberately does not generate, and the
 * relay chain cannot carry a capability write — traced on the live flow 2026-09-08, its
 * `Auth + validate` coerces the payload with `Boolean(s)`, the router keys on `topic: L1..L7`,
 * and each `Format CMD` is literally `{dps: 1, set: msg.payload}`. Every stage assumes a relay.
 *
 * `node-red-bridge/capabilityRoutePlan.mjs` adds a separate route, and scopes it to METERS. That
 * scope is the answer here, not a flag: the Energy tab's devices are fed by no command path at
 * all today and a CT meter has no relay, so the worst a bug can do is set a wrong alarm
 * threshold. Outlets and switches would mean wiring beside live relay control, so they keep
 * falling through to the vendor cloud — which needs no flow change and works.
 *
 * Asked per device rather than globally, because "the LAN path exists" is not a property of the
 * system: it is a property of the device, and answering for all of them is how a route that
 * serves four meters would start claiming to serve twenty devices.
 */
export function hasLocalCapabilityRoute(device) {
  return device?.class === 'meter';
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
  if (cmd?.action === 'set' && !hasLocalCapabilityRoute(device)) {
    // A distinct reason rather than the generic `no_route`, because the two mean different things
    // to whoever reads the audit row: `no_route` is "this device class cannot be commanded at
    // all", this is "the LAN path for settings does not reach this device, so the vendor carried
    // it". `dispatchWithFallback` treats both as a local failure and tries the cloud.
    return {
      ok: false,
      reason: 'no_local_capability_route',
      detail: `no local capability route for ${device.class} — see hasLocalCapabilityRoute`,
    };
  }
  const route = cmd?.action === 'set' ? capabilityRouteFor(device, cmd) : routeFor(device, cmd);
  if (!route) return { ok: false, reason: 'no_route', detail: `no dispatch route for device class ${device.class}` };

  let res;
  try {
    res = await fetch(`http://${bridgeHost}:${bridgePort}${route.path}`, {
      method: 'POST',
      headers: { 'x-auth-token': lightApiToken, 'Content-Type': 'application/json' },
      body: JSON.stringify(route.body),
      signal: AbortSignal.timeout(LIGHT_DISPATCH_TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, reason: 'bridge_unreachable', detail: `bridge endpoint unreachable: ${String(err)}` };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // Separate from `bridge_unreachable` because the remedies are different: an error status is
    // the flow rejecting the message (a bad token, a route that no longer exists), while a
    // refused connection is Node-RED being down or the wrong host entirely.
    return { ok: false, reason: 'bridge_rejected', detail: `bridge endpoint returned HTTP ${res.status}: ${body}` };
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
 * A failure also carries `reason`, one of:
 *   `device_offline`      the bridge says it has no connection to THIS device
 *   `bridge_unreachable`  the bridge endpoint could not be reached at all
 *   `bridge_rejected`     the bridge answered with an error status
 *   `no_route`            this device class has no dispatch route
 *   `no_local_capability_route`  settings have no LAN endpoint yet; the cloud carries them
 *
 * A code rather than a `detail` string for the caller to parse. Every one of these reached the
 * browser as a single 502 `hardware_dispatch_failed`, which `describeFailure` rendered as "The
 * bridge did not accept the command" — so "co5 is offline", a per-device fact with a per-device
 * remedy, was indistinguishable from the bridge being down. That is what a physical test on
 * 2026-08-31 reported as "bridge not reachable" while the bridge was serving readings
 * throughout. Prose is written for humans and changes when the wording improves; a code does not.
 *
 * Returns `{ok, via, reason?, detail?}` — never throws.
 */
export async function dispatchCommand(device, cmd, opts) {
  // A 2xx from the bridge is NOT proof the relay moved. The Node-RED endpoint answers as soon
  // as it accepts the message; the tuya node then fails asynchronously, after the response has
  // gone. Observed on the Pi 2026-08-25: commanding `co1` returned ok in 209 ms while Node-RED
  // logged `Device not connected. Can't send the SET commmand` at the same moment.
  //
  // That made the operator's "sent" a lie AND made this whole fallback unreachable — local
  // never failed, so the cloud branch below was dead code, which is why it had never fired.
  //
  // The bridge's `online` flag is the evidence available: it is derived from the device's own
  // health signal, so offline means a local SET cannot land. Asked BEFORE dispatching, so a
  // node that is already failing does not get more traffic. `null` means "could not ask" and
  // is deliberately NOT treated as offline — a readings endpoint that hiccups must not reroute
  // every command through the vendor.
  const online = opts?.readOnline ? await opts.readOnline(device).catch(() => null) : null;
  const local = online === false
    ? { ok: false, reason: 'device_offline', detail: 'the bridge reports this device offline, so a local SET cannot reach it' }
    : await dispatchLocal(device, cmd, opts);
  if (local.ok) return { ok: true, via: 'local' };

  // A site may forbid the fallback outright. Distinct from having no cloud configured, and the
  // difference matters to whoever reads the failure: one is a decision to revisit, the other is
  // a credential to go and set. Local was always primary here, but only because the code
  // happened to order it that way — this is the site saying so, and being held to it.
  if (opts?.policy === 'local-only') {
    return { ...local, via: 'local', detail: `${local.detail} (this site is local-only, so no vendor fallback was attempted)` };
  }

  // No cloud configured is the ordinary case, not an error: report the local failure as-is
  // rather than appending a second one about a path nobody asked for.
  if (!opts?.cloud?.client) return { ...local, via: 'local' };

  const cloud = await dispatchViaCloud(device, cmd, opts.cloud);
  if (cloud.ok) return { ok: true, via: 'cloud', detail: `local failed (${local.detail}); recovered via cloud` };
  // Both failed. Carry both details — which one is the real story depends on the device, and
  // discarding either would make the audit row unactionable.
  //
  // The REASON, though, is the local one. The cloud is a fallback for a device that has stopped
  // answering on the LAN, so what an operator needs told is why the LAN path failed; the cloud
  // half is a second opinion and rides along in `detail`. Reporting the cloud's reason here
  // would put a vendor's problem in front of a building problem.
  return { ok: false, via: 'none', reason: local.reason, detail: `local: ${local.detail} | cloud: ${cloud.detail}` };
}

/** @deprecated Kept as the old name so nothing silently breaks; use dispatchCommand. */
export const dispatchLightCommand = dispatchCommand;
