/**
 * Dispatching a command through the Tuya Cloud API, as a fallback for when the local path has
 * failed.
 *
 * WHY (full reasoning in docs/adr-002-device-recovery-path.md):
 * A Tuya device holds two independent paths — the inbound local TCP socket this bridge uses,
 * and an outbound connection the device keeps open to Tuya. They fail separately. An ESP
 * device whose socket table is exhausted is unreachable locally while its cloud connection is
 * still healthy, which is exactly the "hung" state where the only known recovery was removing
 * power. A cloud command reaches it.
 *
 * LOCAL REMAINS PRIMARY. This is only ever tried after local has actually failed: it is
 * slower, needs the internet, and puts a vendor in the path of a building control system that
 * otherwise runs entirely on the LAN.
 *
 * WHAT IT CANNOT DO, so nothing downstream assumes otherwise:
 *   - A device with no cloud connection either — what Tuya reporting `offline` means — is
 *     reachable by neither path, and power really is the only recovery.
 *   - `acu_ir` has no RELAY route, and `cloudRouteFor` still returns null for it. Since the IR hub
 *     was re-paired into the project (2026-09-17) it has an AIRCON route instead: the full state,
 *     as DP properties on the virtual "Air" remote the vendor composes an IR frame from. See
 *     `cloudAcRouteFor` and `shared/acState.mjs`.
 *   - Meters and sensors expose no RELAY, so neither path can switch them. They do hold
 *     writable settings, and `cloudCapabilityRouteFor` below reaches those.
 */

import { CAPABILITY_PROFILES, capabilityForDevice, divisorFor } from '../shared/deviceCapabilities.mjs';
import { acStateToDps } from '../shared/acState.mjs';

/** Codes read from the devices themselves via `GET /v1.0/devices/{id}/functions`, not guessed. */
const SOCKET_CODE = { 1: 'switch_1', 2: 'switch_2' };

/**
 * The cloud command body for one command, or null when this class has no cloud route.
 *
 * Mirrors `dispatchLight.routeFor`'s shape and its reasoning: the socket is resolved here
 * rather than read off `cmd.target`, because the scheduler builds commands directly and does
 * not populate that field.
 */
export function cloudRouteFor(device, cmd) {
  const on = cmd.action === 'on';
  if (device.class === 'switch') {
    return { commands: [{ code: 'switch_1', value: on }] };
  }
  if (device.class === 'outlet_dual') {
    const code = SOCKET_CODE[cmd.socket];
    // An outlet command with no socket is ambiguous — switching both would act beyond what was
    // asked. Local dispatch resolves this through the flow's own wire key; there is no
    // equivalent here, so refuse rather than guess which socket was meant.
    if (!code) return null;
    return { commands: [{ code, value: on }] };
  }
  return null;
}

/**
 * The cloud route for a capability write, or null when there is none.
 *
 * THIS IS WHERE THE BRIEF'S RULE BECOMES EXECUTABLE: use the standard instruction set where the
 * product has one, and the DP instruction set only where it does not. That is not a style
 * preference — it was measured. `GET /v1.0/devices/{id}/specifications` answers for the light
 * switch (`tdq`) and the outlet (`pc`), and both CT meters (`cz`) refuse it outright with
 * `code 2009: not support this device`, returning an empty `{"category":"cz"}`. So the meters
 * CANNOT be addressed by code through the standard command endpoint; their writes go through
 * the thing-model property endpoint instead, which speaks the DP instruction vocabulary.
 *
 * `instruction` is returned rather than a URL so the choice is a value a test can assert on,
 * instead of a string a test would have to pattern-match.
 *
 * The value is converted to raw wire units by the capability's own divisor. That divisor is 1
 * for every writable numeric today — pinned by `test/device-capabilities.test.mjs` — so this is
 * an identity now and stays correct if a scaled capability is ever made writable.
 */
export function cloudCapabilityRouteFor(device, cmd) {
  const profile = CAPABILITY_PROFILES[device?.capability_profile];
  if (!profile) return null;

  const cap = capabilityForDevice(device, cmd?.capability);
  // Re-checked here rather than trusted from validation upstream: this function is one `import`
  // away from a vendor API that moves relays, and the allowlist is the whole safety property.
  if (!cap || !cap.writable) return null;

  const raw = cap.kind === 'value' ? cmd.value * divisorFor(cap) : cmd.value;

  return profile.standard_instruction
    ? { instruction: 'standard', body: { commands: [{ code: cap.code, value: raw }] } }
    : { instruction: 'dp', body: { properties: JSON.stringify({ [cap.code]: raw }) } };
}

/**
 * The aircon's cloud route: its complete resolved state as DP properties on the "Air" remote.
 *
 * DP instruction rather than the remote's standard set (PowerOn / PowerOff / T / M / F), because
 * the standard set has no swing. The whole state goes in one issue, never one field — the vendor
 * composes the IR frame from whatever it is given plus what IT remembers, and what it remembers
 * is not what this system last commanded. OFF is the one exception: `acStateToDps` sends power
 * alone, so the vendor has nothing to switch the unit on to apply.
 *
 * Returns null without a resolved state rather than inventing one.
 */
export function cloudAcRouteFor(cmd) {
  if (!cmd?.ac_state) return null;
  return { instruction: 'dp', body: { properties: JSON.stringify(acStateToDps(cmd.ac_state)) } };
}

/** The vendor endpoint each instruction set is served by. */
export function cloudPathFor(instruction, tuyaId) {
  const id = encodeURIComponent(tuyaId);
  return instruction === 'dp'
    ? `/v2.0/cloud/thing/${id}/shadow/properties/issue`
    : `/v1.0/devices/${id}/commands`;
}

/**
 * @param tuyaDeviceIdFor  (registryDeviceId) => the vendor device id, or undefined
 * @param client           a `createTuyaClient` instance
 * Returns `{ok:true}` or `{ok:false, detail}` — never throws, matching `dispatchCommand`.
 */
export async function dispatchViaCloud(device, cmd, { client, tuyaDeviceIdFor, acRemoteId } = {}) {
  if (!client) return { ok: false, detail: 'cloud dispatch not configured' };

  // The aircon is addressed through its virtual remote, whose id is resolved rather than mapped.
  if (device?.class === 'acu_ir' && cmd?.action !== 'set') {
    const route = cloudAcRouteFor(cmd);
    if (!route) return { ok: false, detail: 'no resolved aircon state to send' };
    const remote = acRemoteId
      ? await acRemoteId(device).catch((e) => ({ ok: false, reason: String(e?.message ?? e) }))
      : { ok: false, reason: 'no aircon remote resolver configured' };
    if (!remote?.ok) return { ok: false, detail: `no cloud route for the aircon: ${remote?.reason}` };
    try {
      await client.call('POST', cloudPathFor(route.instruction, remote.id), { body: route.body });
      return { ok: true };
    } catch (err) {
      return { ok: false, detail: `cloud dispatch failed: ${String(err.message ?? err)}` };
    }
  }

  const capability = cmd?.action === 'set';
  const route = capability ? cloudCapabilityRouteFor(device, cmd) : cloudRouteFor(device, cmd);
  if (!route) {
    return {
      ok: false,
      detail: capability
        ? `no cloud route for capability ${cmd?.capability} on ${device.id}`
        : `no cloud route for device class ${device.class}`,
    };
  }

  const tuyaId = tuyaDeviceIdFor?.(device.id);
  if (!tuyaId) return { ok: false, detail: `no vendor device id known for ${device.id}` };

  try {
    const path = capability
      ? cloudPathFor(route.instruction, tuyaId)
      : cloudPathFor('standard', tuyaId);
    await client.call('POST', path, { body: capability ? route.body : route });
    return { ok: true };
  } catch (err) {
    // The client already turns Tuya's HTTP-200-with-success:false into a throw, so anything
    // arriving here is a genuine failure rather than a status code that needs interpreting.
    return { ok: false, detail: `cloud dispatch failed: ${String(err.message ?? err)}` };
  }
}
