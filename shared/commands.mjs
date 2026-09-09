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
 *   - `target_c` is the ACU's setpoint, and exists only for `acu_ir`. The aircon is
 *     IR-commanded and its logic takes a code rather than a relay state — "OFF", or a whole
 *     degree "16".."30" — so an on/off-only command could only ever mean "on at whatever
 *     temperature someone last picked", which no UI can honestly display. The bounds here are
 *     not a policy choice: they are exactly the keys the live flow's IR library holds, and a
 *     value outside them would resolve to no code at all. Since RM-061 they are the ONLY bound
 *     on a setpoint: the site's comfort policy is a statement about the ROOM, and it returns a
 *     `warnings` entry rather than refusing — see the note at the `target_c` check below.
 *   - `action: 'set'` is the SECOND verb, added once devices turned out to hold more than a
 *     relay: a child lock, an auto-off countdown, an over-power alarm threshold. It carries a
 *     `capability` and a `value` instead of a socket, and every bound it enforces comes from
 *     the vendor's own device model in `shared/deviceCapabilities.mjs` rather than from a
 *     constant here. Crucially it consults that catalogue's `writable` flag and NOT the
 *     vendor's `access` — the vendor marks four more capabilities writable (`relay_status`,
 *     `switch_inching`, `cycle_time`, `random_time`) and each installs unattended switching
 *     inside the device, where the Supabase scheduler cannot see it and the audit trail cannot
 *     record it. Trusting `access: 'rw'` here would open all four.
 *   - An `outlet_dual` command MUST name a socket. There is no whole-outlet relay — `state`
 *     on an outlet reading is *derived* (`s1 || s2` in buildLatest.mjs), and the legacy
 *     Node-RED `Format CMD` nodes only ever emit `{dps: 1 | 2, set}`. A UI wanting "turn
 *     off Outlet 3" fans out to two commands itself; that's the truth, not a shortcut.
 */

import { iso8 } from './buildLatest.mjs';
import { capabilityForDevice, validateCapabilityValue } from './deviceCapabilities.mjs';
import { setpointPolicyWarning } from './sitePolicy.mjs';

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

/** The whole degrees the live flow's IR library actually has codes for. */
export const ACU_MIN_C = 16;
export const ACU_MAX_C = 30;

/**
 * The wire target for a command — the exact string the legacy Node-RED `Outlet Router`/
 * lighting logic already switches on (`CO<n>_1`, `L<n>`), so a real Pi write path could
 * reuse this unchanged. `acu_ir` has no legacy topic of its own (it was IR-controlled, not
 * relay-controlled) — `AC_POWER` is this contract's own synthetic key, not a ported one.
 */
/**
 * Expands one device-level intent into the per-target commands the hardware actually takes.
 *
 * WHY IT EXISTS. The rule above has always been that an outlet command must name a socket, and
 * the Control page has always obeyed it by fanning out for itself. The two UNATTENDED callers
 * never did: the Automation page cannot express a socket at all (`supabaseConfig.ts` reads and
 * writes schedules `.is('socket', null)`), and `shedPlan.mjs` hard-coded `socket: null` on every
 * target. `socket: null` resolves for a switch and is refused for an outlet, so schedules and
 * auto-shed worked on lights and could never work on outlets.
 *
 * Found because the operator tested the building by hand on 2026-09-07: Light Switch 7 passed
 * every test including its schedule, Outlet 5's schedule never fired. Tracing that found the shed
 * path had the same defect and nobody had exercised it — all seven outlets are in shed tiers
 * `group_2` and `group_3`, together 61% of metered demand.
 *
 * ALREADY-TARGETED COMMANDS PASS THROUGH. A command that names a socket is one the caller has
 * already fanned out; expanding it again would double every relay operation the Control page
 * issues. The check is `!= null` rather than truthiness because socket 0 is invalid but falsy,
 * and a truthiness test would silently fan it out instead of letting validation refuse it.
 *
 * Returns an array so a caller can treat every command uniformly. Whole-outlet by design: both
 * sockets always move together, which is what the Automation page's device-level UI means. Per
 * socket independence would need `UNIQUE(device_id, socket)` and a socket picker — see the
 * roadmap.
 */
export function fanOutCommand(cmd, device) {
  if (!device || device.class !== 'outlet_dual') return [cmd];
  if (cmd.socket != null) return [cmd];
  return device.sockets.map((_, i) => ({ ...cmd, socket: i + 1 }));
}

export function resolveTarget(device, socket) {
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
export function validateCommand(body, registry, policy = {}) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, code: 'invalid_body', error: 'request body must be a JSON object' };
  }

  const { device_id, socket, action, command_id, target_c, capability, value } = body;

  if (typeof device_id !== 'string' || device_id.length === 0) {
    return { ok: false, status: 400, code: 'invalid_body', error: 'device_id must be a non-empty string' };
  }

  const device = registry.find((d) => d.id === device_id);
  if (!device) {
    return { ok: false, status: 404, code: 'unknown_device', error: `unknown device_id: ${device_id}` };
  }

  if (action !== 'set' && NOT_COMMANDABLE_CLASSES.has(device.class)) {
    return { ok: false, status: 400, code: 'not_commandable', error: `${device.class} devices have no controllable state` };
  }

  if (action !== 'on' && action !== 'off' && action !== 'set') {
    return { ok: false, status: 400, code: 'invalid_action', error: 'action must be exactly "on", "off" or "set"' };
  }

  /**
   * A capability write. It leaves before the relay rules below, because none of them apply:
   * a capability names its own socket in its code (`countdown_1` / `countdown_2`), and a meter
   * that is `not_commandable` — a true statement about relay state — still holds an alarm
   * threshold worth setting.
   */
  if (action === 'set') {
    if (socket !== undefined) {
      return { ok: false, status: 400, code: 'socket_not_applicable', error: 'a capability names its own socket — omit socket' };
    }
    if (typeof capability !== 'string' || capability.length === 0) {
      return { ok: false, status: 400, code: 'invalid_capability', error: 'capability must be a non-empty string' };
    }
    const cap = capabilityForDevice(device, capability);
    if (!cap) {
      return {
        ok: false,
        status: 400,
        code: 'unknown_capability',
        error: `${device_id} has no capability "${capability}"`,
      };
    }
    const bad = validateCapabilityValue(cap, value);
    if (bad) return { ok: false, status: 400, ...bad };

    // The RESOLVED code is what gets recorded, not what the caller typed: `warn_power` on
    // `mtr_lo_yellow` is `warn_power2`, and the audit row should say which circuit was armed.
    return {
      ok: true,
      cmd: { command_id, device_id, socket: undefined, action, capability: cap.code, value, target: cap.code },
    };
  }

  if (capability !== undefined || value !== undefined) {
    return {
      ok: false,
      status: 400,
      code: 'capability_not_applicable',
      error: 'capability and value belong to action "set"',
    };
  }

  /** Advisory findings that do not refuse the command. Empty for every relay command, so a
   * caller that has never seen the field still gets a byte-identical result. */
  const warnings = [];

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

  if (target_c !== undefined) {
    if (device.class !== 'acu_ir') {
      return { ok: false, status: 400, code: 'target_c_not_applicable', error: `${device_id} has no setpoint — omit target_c` };
    }
    if (!Number.isInteger(target_c) || target_c < ACU_MIN_C || target_c > ACU_MAX_C) {
      return {
        ok: false,
        status: 400,
        code: 'invalid_target_c',
        error: `target_c must be a whole number between ${ACU_MIN_C} and ${ACU_MAX_C}`,
      };
    }

    /**
     * THE SITE'S POLICY NO LONGER REFUSES THIS COMMAND — RM-061.
     *
     * It used to. `policy.acu_min_setpoint_c` was read as a bound on the COMMANDED SETPOINT and
     * anything below it came back 400 `below_policy_floor`. That reading became untenable once
     * the setpoint stopped being the thing an operator sets and became the CONTROL LEVER a
     * closed loop moves: a loop that may never ask for 22 cannot hold a room at 24 on a hot
     * afternoon, and a person who genuinely needs 18 for an hour had no way to ask.
     *
     * The number now means the coldest ROOM TEMPERATURE this building permits an automatic rule
     * to aim for — enforced where rules are written (`upsert_acu_rule`) and where the loop
     * decides (`server/acuLoopPlan.mjs`), which is where a statement about the room belongs.
     *
     * What replaces the refusal here is a WARNING that travels with the command: `buildAck`
     * returns it to the caller and `server/proxy.mjs` folds it into the audit note, so a
     * below-policy setpoint is recorded rather than merely prevented. `ACU_MIN_C`/`ACU_MAX_C`
     * above are unchanged and remain the only hard bound — they are a hardware fact, and a
     * degree outside them resolves to no IR code at all.
     */
    const policyWarning = setpointPolicyWarning(target_c, policy);
    if (policyWarning) warnings.push(policyWarning);
  }

  const target = resolveTarget(device, socket);
  // On `cmd`, not beside it: `buildAck` and the proxy's audit both take the command object, and
  // a warning that travels separately is one a caller can forget to carry.
  return { ok: true, cmd: { command_id, device_id, socket, action, target, target_c, ...(warnings.length > 0 ? { warnings } : {}) } };
}

/**
 * The command ack. `confirmed: false` and `confirmation: 'none'` are load-bearing, not
 * placeholders — see `ACCEPTED_STATUS`'s comment. `note` states the same fact in prose so
 * a client that only logs the body still gets it.
 */
export function buildAck(cmd, atMs) {
  const ack = {
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
  // Advisory findings, present only when there are any — so a command that trips no policy
  // produces exactly the ack it always did. A client that only logs the body still gets the
  // fact, which is the same argument `note` already makes.
  if (cmd.warnings && cmd.warnings.length > 0) ack.warnings = cmd.warnings;
  // Added only for a capability write, so a relay ack is byte-identical to what it always was
  // and no existing reader meets a field it has never seen.
  if (cmd.action === 'set') {
    ack.capability = cmd.capability;
    ack.value = cmd.value;
    // Narrower than the relay note above, because it turned out to be narrower in fact.
    // Observed on `co3` 2026-09-03: a child-lock write came back in the device's NEXT READING,
    // both when locking and when unlocking. So the honest claim is about this ack — accepted for
    // dispatch, nothing confirmed at this moment — not the broader "the device never says". The
    // relay note stays as it is: a relay genuinely has no readback on this hardware.
    ack.note = 'commanded setting only — accepted for dispatch, not confirmed here; the value appears in a later reading if the device took it';
  }
  return ack;
}
