/**
 * Rebinding a flow node to a re-paired device — one implementation for the proxy route and the CLI.
 *
 * See `node-red-bridge/rebindPlan.mjs` for why a rebind exists and what it may change. This module
 * decides whether a given rebind is one to make at all, and it is strict because the write puts a
 * local key into a live flow and repoints a device that other services read:
 *
 *   - the node must be ORPHANED — its current vendor id no longer in the cloud project. A rebind is
 *     the repair for a re-pair; it is not a way to move a working device's node to another device;
 *   - a registry device must be bound to the node, so the target's KIND can be checked against it —
 *     an aircon node must never be pointed at an outlet;
 *   - the target must be in the project, a real device rather than a virtual sub-device, and not
 *     already polled by another node;
 *   - the version is the device's own announcement when the cloud has none (it never does here);
 *   - the local key is fetched here and never returned — only its length.
 *
 * Every dependency is injected, as `enrollService.mjs`'s are, so this is tested without a cloud,
 * a Pi or a flow.
 */

import { VENDOR_KINDS } from '../shared/enrollment.mjs';
import { planRebind, validateRebindPlan } from '../node-red-bridge/rebindPlan.mjs';

/**
 * @param draft  { nodeName, tuyaDeviceId }
 * @param deps   { cloud: {listDevices, describeDevice}, admin: {login, getFlows, postFlows},
 *                 discoverVersion(id) -> version|null, classForNode(name) -> class|null,
 *                 declaredVersionFor(name) -> version|undefined, apply }
 * @returns { ok, stage, problems, summary }
 */
export async function rebindDevice(draft, deps) {
  const { cloud, admin, discoverVersion, classForNode, declaredVersionFor = () => undefined, apply = false } = deps;
  const fail = (stage, problems, summary = null) => ({ ok: false, stage, problems, summary });

  const nodeName = draft?.nodeName;
  const tuyaDeviceId = draft?.tuyaDeviceId;
  if (!nodeName || !tuyaDeviceId) return fail('validate', ['a node name and a vendor device id are both required']);

  const devices = await cloud.listDevices();
  const auth = await admin.login();
  const { flows, rev } = await admin.getFlows(auth);

  const problems = [];
  const node = flows.find((n) => n.type === 'tuya-smart-device' && n.deviceName === nodeName);
  const target = devices.find((d) => d.id === tuyaDeviceId);
  if (!node) problems.push(`no tuya-smart-device node named "${nodeName}" in the flow`);
  if (!target) problems.push('that vendor device is not in this cloud project');
  if (node && devices.some((d) => d.id === node.deviceId)) {
    problems.push(`the device "${nodeName}" polls is still in the cloud project — a rebind repairs a re-pair, it does not move a working node`);
  }
  const nodeClass = node ? classForNode(nodeName) : null;
  if (node && !nodeClass) problems.push(`no registry device is bound to "${nodeName}", so the new device's kind cannot be checked against it`);

  const kind = target ? VENDOR_KINDS[target.category] : undefined;
  if (target && target.sub) problems.push(`"${target.name}" is a sub-device with no network presence of its own — a node cannot poll it`);
  else if (target && nodeClass && kind?.suggestedClass !== nodeClass) {
    problems.push(`"${target.name}" is ${kind ? `a ${kind.label}` : `an unknown category (${target.category})`} and cannot back "${nodeName}", which is ${nodeClass}`);
  }
  const other = flows.find((n) => n.type === 'tuya-smart-device' && n.deviceId === tuyaDeviceId && n.deviceName !== nodeName);
  if (other) problems.push(`that vendor device is already polled by "${other.deviceName}"`);
  if (problems.length) return fail('validate', problems);

  const detail = await cloud.describeDevice(tuyaDeviceId);
  const version = detail?.version ?? (discoverVersion ? await discoverVersion(tuyaDeviceId).catch(() => null) : null);
  const credProblems = [];
  if (!version) credProblems.push('no protocol version: the cloud does not report one, and the device did not announce itself on this network — it must be powered and on the device SSID');
  if (!detail?.local_key) credProblems.push('the cloud did not return a local key for that device');
  if (credProblems.length) return fail('credentials', credProblems);

  const plan = planRebind(flows, { nodeName, tuyaDeviceId, localKey: detail.local_key, tuyaVersion: String(version) });
  if (plan.problems.length) return fail('plan', plan.problems);
  const invalid = validateRebindPlan(flows, plan.flows, nodeName);
  if (invalid.length) return fail('invariants', invalid);

  const declared = declaredVersionFor(nodeName);
  const notes = [];
  if (declared !== undefined && declared !== String(version)) {
    notes.push(`the device announces v${version} but TUYA_NODE_VERSIONS declares v${declared} for "${nodeName}" — update shared/tuyaNodeSettings.mjs in the same change, or the drift check will report it`);
  }
  if (!plan.changed.length) notes.push('the node already holds exactly these values — nothing to write');

  // Never the key. Callers render this, and a rendered secret is a leaked one.
  const summary = {
    nodeName,
    vendorName: target.name ?? null,
    vendorOnline: target.online ?? null,
    kind: kind.label,
    tuyaVersion: String(version),
    declaredVersion: declared ?? null,
    versionMatchesDeclaration: declared === undefined ? null : declared === String(version),
    localKeyLength: String(detail.local_key).length,
    fieldsChanged: plan.changed,
    notes,
  };

  if (!apply || !plan.changed.length) return { ok: true, stage: apply ? 'applied' : 'dry-run', problems: [], summary };

  const res = await admin.postFlows(auth, plan.flows, rev);
  if (res.status === 409) return fail('flow', ['the flow changed between the read and this write — nothing was written; re-run'], summary);
  if (!res.ok) return fail('flow', [`Node-RED refused the write (HTTP ${res.status}) — nothing was written`], summary);
  return { ok: true, stage: 'applied', problems: [], summary };
}
