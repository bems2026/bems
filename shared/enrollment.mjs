/**
 * Turning a chosen vendor device into a registry entry.
 *
 * WHY THIS IS A MODULE AND NOT A FORM HANDLER: enrolling a device writes to two places that
 * must agree — the registry every service imports, and the Node-RED flow that actually polls
 * the hardware. If they disagree the failure is quiet: the app shows a device that never
 * reports, or the flow polls something nothing displays. Deciding the entry once, purely, is
 * what lets both consumers be generated from the same answer.
 *
 * Validation is strict on purpose. A bad entry does not fail loudly at enrolment; it fails
 * later as a device that reads `online: false` forever, which this project has repeatedly
 * shown is indistinguishable from a network fault.
 */

import { DEVICE_REGISTRY, DPS_MAPS } from './registry.mjs';

/** Classes a device can be enrolled as. `meter` is excluded deliberately — see below. */
export const ENROLLABLE_CLASSES = ['outlet_dual', 'switch'];

/**
 * `meter` and `acu_ir` are not enrollable through this path.
 *
 * A meter's identity is a *logical* channel on a physical device, not the device itself — two
 * of them already share one unit, distinguished only by DPS range, and choosing that mapping
 * is an electrical decision about which CT clamp is on which circuit. `acu_ir` is driven by an
 * IR blaster whose command set is bespoke. Both are rare, one-off, and better done deliberately
 * than through a wizard that would have to ask questions it cannot validate.
 */
export const CLASS_DEFAULTS = {
  outlet_dual: { dps_map: 'type_b', sockets: true, branch_circuit: 'C.O Yellow' },
  switch: { dps_map: null, sockets: false, branch_circuit: 'L.O Red' },
};

const ID_PATTERN = /^[a-z][a-z0-9_]{1,23}$/;

/**
 * The vendor's device categories this project has met, and what each is here — measured on this
 * cloud project on 2026-09-17: `pc` the outlets, `tdq` the light relays, `cz` the CT meters, `wnykq`
 * the IR hub and `infrared_ac` its virtual aircon remote.
 *
 * WHY THE ADD DEVICE WIZARD NEEDS IT. It offered every unclaimed cloud device as an outlet or a switch.
 * When the IR blaster was re-paired, that list gained "Air" — a remote that exists only in the vendor
 * cloud and has no network presence to connect to — and a node enrolled from it would never have
 * connected, failing as `find() timed out`, which reads as a network fault.
 */
export const VENDOR_KINDS = Object.freeze({
  pc: Object.freeze({ kind: 'outlet', label: 'Outlet', suggestedClass: 'outlet_dual' }),
  tdq: Object.freeze({ kind: 'switch', label: 'Light switch', suggestedClass: 'switch' }),
  cz: Object.freeze({ kind: 'ct_meter', label: 'CT meter', suggestedClass: 'meter' }),
  wnykq: Object.freeze({ kind: 'ir_hub', label: 'IR hub (temperature + humidity)', suggestedClass: 'acu_ir' }),
  infrared_ac: Object.freeze({ kind: 'ir_ac_remote', label: 'Aircon remote (virtual)', suggestedClass: 'acu_ir' }),
});

/**
 * What one cloud device is, and what the wizard may do with it.
 *
 * @param d        a public fleet row: { id, name, category, sub, claimed }
 * @param context  { registry, claimedBy: flow node name or null, orphanNodes: [{name, class}] }
 * @returns {{ kind, label, suggestedClass, action: 'enroll'|'rebind'|'linked'|'none', enrollable, reason, rebindNode? }}
 *
 * `rebind` is offered when a flow node of the same class points at a vendor id this project no longer
 * has — which is what re-pairing in Smart Life does, and what happened to the IR blaster. The node's
 * `findTimeout`, wiring and parsers stay; only its id, key and announced version change.
 */
export function classifyVendorDevice(d, { registry = DEVICE_REGISTRY, claimedBy = null, orphanNodes = [] } = {}) {
  const k = VENDOR_KINDS[d?.category] ?? { kind: 'unknown', label: `Unknown (${d?.category ?? 'no category'})`, suggestedClass: null };
  const none = (reason) => ({ ...k, action: 'none', enrollable: false, reason });

  if (k.kind === 'ir_ac_remote') {
    const acus = registry.filter((x) => x.class === 'acu_ir');
    return acus.length === 1
      ? {
        ...k,
        action: 'linked',
        enrollable: false,
        reason: `A virtual remote with no network presence of its own. It is ${acus[0].display_name}'s cloud aircon remote, commanded through its IR hub — nothing to enrol.`,
      }
      : none('A virtual remote with no network presence of its own, and this site has no single aircon to bind it to.');
  }
  if (claimedBy) return none(`Already in the flow as "${claimedBy}".`);
  if (d?.sub) return none('A sub-device is reached through its gateway, not on its own.');

  const orphan = k.suggestedClass ? orphanNodes.find((n) => n.class === k.suggestedClass) : undefined;
  if (orphan) {
    return {
      ...k,
      action: 'rebind',
      enrollable: false,
      rebindNode: orphan.name,
      reason: `"${orphan.name}" points at a device this cloud project no longer has. Rebind it to this one — its wiring and history stay.`,
    };
  }

  if (ENROLLABLE_CLASSES.includes(k.suggestedClass)) return { ...k, action: 'enroll', enrollable: true, reason: null };
  if (k.kind === 'ir_hub') return none('A new aircon is set up deliberately, not from this form — its IR code library is specific to the unit.');
  if (k.kind === 'ct_meter') return none("A meter's channel mapping is an electrical decision — which clamp is on which circuit.");
  return none('No device class in this build for this vendor category.');
}

/**
 * @param draft   { deviceId, class, displayName, room, tuyaDeviceId, branchCircuit }
 * @param context { registry = DEVICE_REGISTRY, cloudDeviceIds = [] }
 * @returns { ok: boolean, problems: string[] }
 */
export function validateEnrollment(draft, { registry = DEVICE_REGISTRY, cloudDeviceIds = [] } = {}) {
  const problems = [];
  const id = draft?.deviceId;

  if (!id || !ID_PATTERN.test(id)) {
    problems.push('device id must be lowercase letters, digits and underscores, starting with a letter (2-24 chars)');
  } else if (registry.some((d) => d.id === id)) {
    problems.push(`device id "${id}" is already in the registry`);
  }

  if (!ENROLLABLE_CLASSES.includes(draft?.class)) {
    problems.push(`class must be one of: ${ENROLLABLE_CLASSES.join(', ')}`);
  }

  if (!draft?.displayName || !String(draft.displayName).trim()) {
    problems.push('a display name is required — the fleet table has no other way to name this device');
  }

  if (!draft?.tuyaDeviceId) {
    problems.push('a vendor device id is required');
  } else if (cloudDeviceIds.length && !cloudDeviceIds.includes(draft.tuyaDeviceId)) {
    // Enrolling a device the project cannot see produces a node that can never connect, and
    // the symptom — permanent `find() timed out` — reads as a network fault.
    problems.push('that vendor device is not in this cloud project');
  } else if (registry.some((d) => d.tuya_device_id === draft.tuyaDeviceId)) {
    problems.push('that vendor device is already enrolled');
  }

  const dpsMap = CLASS_DEFAULTS[draft?.class]?.dps_map;
  if (dpsMap && !DPS_MAPS[dpsMap]) problems.push(`unknown dps map "${dpsMap}"`);

  return { ok: problems.length === 0, problems };
}

/**
 * The registry entry for a validated draft.
 *
 * `ctx` is derived from the device id rather than asked for. It is the flow-context key prefix,
 * every parser and the totals engine key off it, and a mismatch between it and the id is
 * exactly the kind of silent misbinding this module exists to prevent — so there is no way to
 * set them independently.
 */
export function registryEntryFor(draft) {
  const defaults = CLASS_DEFAULTS[draft.class];
  const entry = {
    id: draft.deviceId,
    display_name: String(draft.displayName).trim(),
    class: draft.class,
    room: draft.room?.trim() || null,
    dps_map: defaults.dps_map,
    ctx: draft.deviceId,
    branch_circuit: draft.branchCircuit?.trim() || defaults.branch_circuit,
    status: 'active',
  };
  if (defaults.sockets) {
    const n = draft.deviceId.toUpperCase();
    entry.sockets = [`${n}_1`, `${n}_2`];
  }
  if (draft.class === 'switch') {
    // `state_key` indexes into the flow's `bems_lights_state` object, which is keyed L1..Ln.
    // Derived from a trailing number in the id so it cannot drift from it.
    const m = /(\d+)$/.exec(draft.deviceId);
    entry.state_key = m ? `L${m[1]}` : draft.deviceId.toUpperCase();
    entry.ctx = null;
  }
  return entry;
}

/**
 * Whether a device may be removed, and why not when it may not.
 *
 * Only devices that were *enrolled* can be removed this way. The built-in ones are hand-written
 * in `registry.mjs`, and a script editing hand-written source is exactly what the separate
 * `registry.enrolled.mjs` module exists to avoid. Saying "built-in" rather than "not found"
 * matters: the two have completely different fixes, and "not found" would send someone looking
 * for a bug that is not there.
 *
 * @param deviceId  the registry id
 * @param context   { registry = DEVICE_REGISTRY, enrolled = [] }
 */
export function validateRemoval(deviceId, { registry = DEVICE_REGISTRY, enrolled = [] } = {}) {
  const problems = [];
  if (!deviceId) {
    problems.push('a device id is required');
    return { ok: false, problems };
  }
  const isEnrolled = enrolled.some((d) => d.id === deviceId);
  const inRegistry = registry.some((d) => d.id === deviceId);

  if (!isEnrolled && inRegistry) {
    problems.push(
      `"${deviceId}" is a built-in device, hand-written in shared/registry.mjs — only enrolled devices can be removed from here`,
    );
  } else if (!isEnrolled) {
    problems.push(`"${deviceId}" is not in the registry`);
  }
  return { ok: problems.length === 0, problems };
}
