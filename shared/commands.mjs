/**
 * Device command (write) contract — Stage 2, mock-bridge only.
 *
 * Same reason `shared/buildLatest.mjs` exists: this is the single, pure, dependency-free
 * implementation of "is this command valid, and what does it resolve to on the wire" —
 * imported by `mock-bridge/server.mjs` and the contract test suite. If a real Pi write
 * path is ever built, it reuses this file unchanged rather than re-deriving the same rules
 * with a chance to disagree. `node-red-bridge/build-flow.mjs` does NOT import this today —
 * see the guardrails in the Phase L plan for why that boundary matters.
 *
 * Two contract decisions baked into this module, not incidental:
 *   - `action` is always absolute ("on"/"off"), never "toggle". A toggle would be computed
 *     from a last-known state that's never confirmed by hardware (see the note on
 *     `confirmed` below); a double-fire on a client retry would flip a relay back to where
 *     it started. Absolute set makes every command naturally idempotent.
 *   - An `outlet_dual` command MUST name a socket. There is no whole-outlet relay — `state`
 *     on an outlet reading is *derived* (`s1 || s2` in buildLatest.mjs), and the legacy
 *     Node-RED `Format CMD` nodes only ever emit `{dps: 1 | 2, set}`. A UI wanting "turn
 *     off Outlet 3" fans out to two commands itself; that's the truth, not a shortcut.
 */

import { iso8 } from './buildLatest.mjs';

export const COMMAND_ROUTE = '/api/command';

/**
 * 202, not 200 — Accepted, not OK. This is the protocol-level half of the honesty
 * contract: the bridge has accepted the command for dispatch, not verified the device did
 * anything, and for these devices it structurally cannot (see `confirmed` in `buildAck`).
 * Changing this to 200 means the system has gained real relay readback somewhere, which
 * would mean `shared/buildLatest.mjs` changed too — see the contract test that pins this.
 */
export const ACCEPTED_STATUS = 202;

const NOT_COMMANDABLE_CLASSES = new Set(['meter', 'sensor_temp_humidity']);

/**
 * The wire target for a command — the exact string the legacy Node-RED `Outlet Router`/
 * lighting logic already switches on (`CO<n>_1`, `L<n>`), so a real Pi write path could
 * reuse this unchanged. `acu_ir` has no legacy topic of its own (it was IR-controlled, not
 * relay-controlled) — `AC_POWER` is this contract's own synthetic key, not a ported one.
 */
function resolveTarget(device, socket) {
  if (device.class === 'outlet_dual') return device.sockets[socket - 1];
  if (device.class === 'switch') return device.state_key;
  if (device.class === 'acu_ir') return 'AC_POWER';
  return null;
}

/**
 * Pure validation — no I/O, no mutation. `registry` is the full internal
 * `DEVICE_REGISTRY` (not `publicDevices()`'s stripped view), since resolving a target needs
 * `sockets`/`state_key`, which are deliberately absent from what `/api/devices` serves.
 *
 * Returns `{ok:true, cmd}` or `{ok:false, status, code, error}` — never throws. `cmd` is
 * `{command_id, device_id, socket, action, target}`; `command_id` is copied through
 * verbatim (including `undefined`) and is the caller's responsibility to fill in.
 */
export function validateCommand(body, registry) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, code: 'invalid_body', error: 'request body must be a JSON object' };
  }

  const { device_id, socket, action, command_id } = body;

  if (typeof device_id !== 'string' || device_id.length === 0) {
    return { ok: false, status: 400, code: 'invalid_body', error: 'device_id must be a non-empty string' };
  }

  const device = registry.find((d) => d.id === device_id);
  if (!device) {
    return { ok: false, status: 404, code: 'unknown_device', error: `unknown device_id: ${device_id}` };
  }

  if (NOT_COMMANDABLE_CLASSES.has(device.class)) {
    return { ok: false, status: 400, code: 'not_commandable', error: `${device.class} devices have no controllable state` };
  }

  if (action !== 'on' && action !== 'off') {
    return { ok: false, status: 400, code: 'invalid_action', error: 'action must be exactly "on" or "off"' };
  }

  const hasSockets = device.class === 'outlet_dual';
  if (hasSockets) {
    if (socket === undefined) {
      return { ok: false, status: 400, code: 'socket_required', error: `${device_id} is a dual-socket outlet — socket (1 or 2) is required` };
    }
    if (!Number.isInteger(socket) || (socket !== 1 && socket !== 2)) {
      return { ok: false, status: 400, code: 'invalid_socket', error: 'socket must be the integer 1 or 2' };
    }
  } else if (socket !== undefined) {
    return { ok: false, status: 400, code: 'socket_not_applicable', error: `${device_id} has no sockets — omit socket` };
  }

  const target = resolveTarget(device, socket);
  return { ok: true, cmd: { command_id, device_id, socket, action, target } };
}

/**
 * The command ack. `confirmed: false` and `confirmation: 'none'` are load-bearing, not
 * placeholders — see `ACCEPTED_STATUS`'s comment. `note` states the same fact in prose so
 * a client that only logs the body still gets it.
 */
export function buildAck(cmd, atMs) {
  return {
    command_id: cmd.command_id,
    device_id: cmd.device_id,
    socket: cmd.socket,
    action: cmd.action,
    target: cmd.target,
    accepted_at: iso8(atMs),
    confirmed: false,
    confirmation: 'none',
    note: 'commanded state only — this device does not report relay state back',
  };
}
