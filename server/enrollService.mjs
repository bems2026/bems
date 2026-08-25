/**
 * Enrolling a device, as one implementation that both the CLI and the proxy endpoint call.
 *
 * WHY ONE: enrolment writes to two places that must agree — the registry every service imports,
 * and the Node-RED flow that polls the hardware. Two implementations of that would eventually
 * disagree about validation, ordering, or what happens when the second write fails, and the
 * symptom would be a device that half exists. Every dependency is injected so the whole thing
 * is testable without a cloud, a Pi, or a filesystem.
 *
 * ORDERING IS DELIBERATE. The registry is written before the flow. If the flow write then
 * fails, the app knows about a device that does not report yet — visible on the Devices page
 * and fixed by re-running. The reverse order leaves hardware being polled that nothing
 * displays, which nobody would notice.
 */

import { validateEnrollment, registryEntryFor } from '../shared/enrollment.mjs';
import { planEnrollment, validateEnrollmentPlan } from '../node-red-bridge/enrollPlan.mjs';

/**
 * @param draft  { deviceId, class, displayName, room, tuyaDeviceId, branchCircuit }
 * @param deps   {
 *   registry, cloud: { listDevices, describeDevice }, admin: { login, getFlows, postFlows },
 *   readEnrolled: () => { source, devices }, writeEnrolled: (source) => void,
 *   placementFor: (flows) => { z, x, y }, apply: boolean
 * }
 * @returns { ok, stage, problems, summary }
 */
export async function enrollDevice(draft, deps) {
  const { registry, cloud, admin, readEnrolled, writeEnrolled, placementFor, apply = false } = deps;

  const devices = await cloud.listDevices();
  const basic = validateEnrollment(draft, { registry, cloudDeviceIds: devices.map((d) => d.id) });
  if (!basic.ok) return { ok: false, stage: 'validate', problems: basic.problems, summary: null };

  const entry = registryEntryFor(draft);
  const chosen = devices.find((d) => d.id === draft.tuyaDeviceId);

  // Both read from the device's own record. A guessed protocol version fails as
  // `find() timed out`, which reads exactly like a network fault; a missing local key produces
  // a node that can never connect. Neither is worth defaulting.
  const detail = await cloud.describeDevice(draft.tuyaDeviceId);
  const problems = [];
  if (!detail?.version) problems.push('the cloud did not report a protocol version for that device');
  if (!detail?.local_key) problems.push('the cloud did not return a local key for that device');
  if (problems.length) return { ok: false, stage: 'credentials', problems, summary: null };

  const auth = await admin.login();
  const { flows, rev } = await admin.getFlows(auth);

  const plan = planEnrollment(
    flows,
    entry,
    { tuyaDeviceId: draft.tuyaDeviceId, localKey: detail.local_key, tuyaVersion: String(detail.version) },
    placementFor(flows),
  );
  if (plan.problems.length) return { ok: false, stage: 'plan', problems: plan.problems, summary: null };

  const invalid = validateEnrollmentPlan(flows, plan.flows);
  if (invalid.length) return { ok: false, stage: 'invariants', problems: invalid, summary: null };

  // Never includes the local key. Callers render this, and a rendered secret is a leaked one.
  const summary = {
    deviceId: entry.id,
    displayName: entry.display_name,
    deviceClass: entry.class,
    ctx: entry.ctx,
    dpsMap: entry.dps_map,
    vendorName: chosen?.name ?? null,
    vendorOnline: chosen?.online ?? null,
    tuyaVersion: String(detail.version),
    localKeyLength: String(detail.local_key).length,
    nodesBefore: flows.length,
    nodesAfter: plan.flows.length,
  };

  if (!apply) return { ok: true, stage: 'dry-run', problems: [], summary };

  const { source, devices: enrolled } = readEnrolled();
  const next = JSON.stringify([...enrolled, entry], null, 2);
  const updated = source.replace(/export const ENROLLED_DEVICES = \[[\s\S]*\];\s*$/, `export const ENROLLED_DEVICES = ${next};\n`);
  if (updated === source) {
    return { ok: false, stage: 'registry', problems: ['could not find the ENROLLED_DEVICES array to update'], summary };
  }
  writeEnrolled(updated);

  const res = await admin.postFlows(auth, plan.flows, rev);
  if (res.status === 409) {
    // The registry entry is already written. Saying so matters: re-running is safe and will
    // refuse the duplicate registry entry while still adding the flow nodes.
    return { ok: false, stage: 'flow', problems: ['the flow changed between the read and this write — the registry entry was written, re-run to add the flow nodes'], summary };
  }
  if (!res.ok) {
    return { ok: false, stage: 'flow', problems: [`Node-RED refused the write (HTTP ${res.status}) — the registry entry was written, re-run to add the flow nodes`], summary };
  }

  return { ok: true, stage: 'applied', problems: [], summary };
}
