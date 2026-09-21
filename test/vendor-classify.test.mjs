/**
 * What the Add Device wizard makes of each device in the vendor cloud project.
 *
 * Found 2026-09-17, when the IR blaster was re-paired: the wizard listed every unclaimed cloud device
 * as enrollable as an outlet or a switch — including "Air", a VIRTUAL aircon remote with no network
 * presence at all, which would have produced a node that can never connect. And it said nothing about
 * the IR hub itself.
 *
 * The categories are the vendor's own, measured on this project: `pc` outlets, `tdq` switches, `cz` CT
 * meters, `wnykq` the IR hub, `infrared_ac` its aircon remote.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyVendorDevice, VENDOR_KINDS } from '../shared/enrollment.mjs';

const registry = [
  { id: 'co1', class: 'outlet_dual', display_name: 'Outlet 1' },
  { id: 'acu_main', class: 'acu_ir', display_name: 'CARE ACU IR', flow_node: 'NBRIC IR Blaster' },
];

test('the vendor categories on this project each have a kind', () => {
  for (const c of ['pc', 'tdq', 'cz', 'wnykq', 'infrared_ac']) assert.ok(VENDOR_KINDS[c], c);
});

test('the virtual aircon remote is never enrollable, and says which aircon it belongs to', () => {
  const r = classifyVendorDevice({ id: 'air', category: 'infrared_ac', sub: true }, { registry });
  assert.equal(r.kind, 'ir_ac_remote');
  assert.equal(r.enrollable, false);
  assert.equal(r.action, 'linked');
  assert.match(r.reason, /CARE ACU IR/);
  assert.match(r.reason, /no network presence/);
});

test('with no single aircon on the site, the remote says so instead of naming one', () => {
  const r = classifyVendorDevice({ id: 'air', category: 'infrared_ac', sub: true }, { registry: [registry[0]] });
  assert.equal(r.action, 'none');
  assert.match(r.reason, /no single aircon/);
});

test('an IR hub already in the flow is reported as such', () => {
  const r = classifyVendorDevice({ id: 'hub', category: 'wnykq' }, { registry, claimedBy: 'NBRIC IR Blaster' });
  assert.equal(r.kind, 'ir_hub');
  assert.equal(r.enrollable, false);
  assert.match(r.reason, /NBRIC IR Blaster/);
});

test('a new IR hub whose aircon node lost its device is offered as a rebind of that node', () => {
  // The exact case of 2026-09-17: re-paired in Smart Life, new vendor id, the old node orphaned.
  const r = classifyVendorDevice(
    { id: 'hub-new', category: 'wnykq' },
    { registry, orphanNodes: [{ name: 'NBRIC IR Blaster', class: 'acu_ir' }] },
  );
  assert.equal(r.action, 'rebind');
  assert.equal(r.rebindNode, 'NBRIC IR Blaster');
});

test('a rebind is only offered to a node of the same kind', () => {
  const r = classifyVendorDevice({ id: 'hub-new', category: 'wnykq' }, { registry, orphanNodes: [{ name: 'CO5', class: 'outlet_dual' }] });
  assert.notEqual(r.action, 'rebind');
});

test('a new IR hub with nothing to rebind is not enrollable from the form', () => {
  const r = classifyVendorDevice({ id: 'hub-new', category: 'wnykq' }, { registry });
  assert.equal(r.enrollable, false);
  assert.match(r.reason, /deliberately/);
});

test('an unclaimed outlet or switch is enrollable, with its class suggested', () => {
  const o = classifyVendorDevice({ id: 'x', category: 'pc' }, { registry });
  assert.deepEqual([o.action, o.enrollable, o.suggestedClass], ['enroll', true, 'outlet_dual']);
  const s = classifyVendorDevice({ id: 'y', category: 'tdq' }, { registry });
  assert.equal(s.suggestedClass, 'switch');
});

test('a CT meter is not enrollable from the form, for the electrical reason', () => {
  const r = classifyVendorDevice({ id: 'm', category: 'cz' }, { registry });
  assert.equal(r.enrollable, false);
  assert.match(r.reason, /electrical/);
});

test('an unknown category is named, not guessed at', () => {
  const r = classifyVendorDevice({ id: 'z', category: 'kg' }, { registry });
  assert.equal(r.kind, 'unknown');
  assert.equal(r.enrollable, false);
  assert.match(r.label, /kg/);
});

test('a device heard on the network with no imported key asks for the key, whatever its kind', () => {
  // A new pairing announces itself within seconds, with no category — the key tool's export is what
  // names it and carries its key. Until then there is nothing to enrol from.
  const r = classifyVendorDevice({ id: 'new', category: null, credential_source: null, on_lan: true }, { registry });
  assert.equal(r.action, 'needs_key');
  assert.equal(r.enrollable, false);
  assert.match(r.reason, /Import keys/);
});

test('a device already in the flow is reported as such even with no imported key — its key lives in the node', () => {
  const r = classifyVendorDevice({ id: 'co1', category: null, credential_source: null, on_lan: true }, { registry, claimedBy: 'CO1' });
  assert.equal(r.action, 'none');
  assert.match(r.reason, /Already in the flow as "CO1"/);
});

test('a device from the vendor cloud, where no credential source is named, is classified as before', () => {
  const r = classifyVendorDevice({ id: 'x', category: 'pc' }, { registry });
  assert.equal(r.action, 'enroll');
});

test('the rebind reason does not claim the cloud decided it', () => {
  const r = classifyVendorDevice({ id: 'hub-new', category: 'wnykq', credential_source: 'imported' }, { registry, orphanNodes: [{ name: 'NBRIC IR Blaster', class: 'acu_ir' }] });
  assert.doesNotMatch(r.reason, /cloud project/);
  assert.match(r.reason, /no longer heard/);
});

test('any other sub-device is refused: it is reached through its gateway', () => {
  const r = classifyVendorDevice({ id: 'zb', category: 'pc', sub: true }, { registry });
  assert.equal(r.enrollable, false);
  assert.match(r.reason, /gateway/);
});
