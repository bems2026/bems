/**
 * Removing a device, as one implementation that both the CLI and the proxy endpoint call —
 * the mirror of `enrollService.mjs`, and one implementation for the same reason.
 *
 * ORDERING IS DELIBERATE, AND IS THE REVERSE OF ENROLMENT. Enrolment writes the registry
 * first, so a failed flow write leaves a device the app knows about but nothing polls: visible
 * on the Devices page as NO DATA, and fixed by re-running. Removal writes the FLOW first, which
 * is the same rule read backwards — if the registry write then fails, the app still lists a
 * device nothing polls, which is again visible and re-runnable. The other order would leave
 * hardware being polled that nothing displays, and that is the state nobody notices.
 *
 * HISTORY SURVIVES. `readings` is keyed by `device_id`, not by a foreign key into the registry,
 * so removing a device does not delete what it measured — which is why removal is a deletion
 * from `registry.enrolled.mjs` rather than a `status: 'retired'` flag nothing else reads. See
 * that module's own header.
 */

import { validateRemoval } from '../shared/enrollment.mjs';
import { planRemoval, validateRemovalPlan } from '../node-red-bridge/enrollPlan.mjs';

/**
 * @param draft  { deviceId }
 * @param deps   {
 *   registry, admin: { login, getFlows, postFlows },
 *   readEnrolled: () => { source, devices }, writeEnrolled: (source) => void, apply: boolean
 * }
 * @returns { ok, stage, problems, summary }
 */
export async function removeDevice(draft, deps) {
  const { registry, admin, readEnrolled, writeEnrolled, apply = false } = deps;
  const deviceId = draft?.deviceId;

  const { source, devices: enrolled } = readEnrolled();

  const basic = validateRemoval(deviceId, { registry, enrolled });
  if (!basic.ok) return { ok: false, stage: 'validate', problems: basic.problems, summary: null };

  const entry = enrolled.find((d) => d.id === deviceId);

  const auth = await admin.login();
  const { flows, rev } = await admin.getFlows(auth);

  const plan = planRemoval(flows, deviceId);
  if (plan.problems.length) return { ok: false, stage: 'plan', problems: plan.problems, summary: null };

  const invalid = validateRemovalPlan(flows, plan.flows, deviceId);
  if (invalid.length) return { ok: false, stage: 'invariants', problems: invalid, summary: null };

  const summary = {
    deviceId,
    displayName: entry?.display_name ?? deviceId,
    deviceClass: entry?.class ?? null,
    // Named so a caller can show exactly what is about to disappear rather than a count.
    removedNodes: plan.removed.map((n) => n.name ?? n.deviceName ?? n.id),
    nodesBefore: flows.length,
    nodesAfter: plan.flows.length,
  };

  if (!apply) return { ok: true, stage: 'dry-run', problems: [], summary };

  const res = await admin.postFlows(auth, plan.flows, rev);
  if (res.status === 409) {
    return {
      ok: false,
      stage: 'flow',
      problems: ['the flow changed between the read and this write — nothing was removed, re-run'],
      summary,
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      stage: 'flow',
      problems: [`Node-RED refused the write (HTTP ${res.status}) — nothing was removed, re-run`],
      summary,
    };
  }

  // Flow first, registry second. See the header: a failure here leaves a device listed but not
  // polled, which is visible; the reverse leaves hardware polled but not listed, which is not.
  const next = JSON.stringify(enrolled.filter((d) => d.id !== deviceId), null, 2);
  const updated = source.replace(/export const ENROLLED_DEVICES = \[[\s\S]*\];\s*$/, `export const ENROLLED_DEVICES = ${next};\n`);
  if (updated === source) {
    return {
      ok: false,
      stage: 'registry',
      problems: ['the flow nodes were removed, but the ENROLLED_DEVICES array could not be found to update'],
      summary,
    };
  }
  writeEnrolled(updated);

  return { ok: true, stage: 'applied', problems: [], summary };
}
