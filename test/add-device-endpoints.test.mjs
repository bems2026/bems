import test from 'node:test';
import assert from 'node:assert/strict';
import { addDeviceEndpoints } from '../node-red-bridge/addDeviceEndpoints.mjs';

const base = () => [
  { id: 'tabS', type: 'tab', label: 'Switch' },
  { id: 'tabA', type: 'tab', label: 'Aircon' },
  { id: 'hub', type: 'function', name: 'Outlet Logic Hub', z: 'tabS', wires: [[], [], []] },
  { id: 'acu', type: 'function', name: 'AC Master Logic', z: 'tabA', wires: [[]] },
  { id: 'light', type: 'http in', url: '/light/:id', method: 'post', z: 'tabS', wires: [[]] },
];
const opts = { switchTabId: 'tabS', acuTabId: 'tabA', outletHubId: 'hub', acuLogicId: 'acu' };
const build = (flows = base()) => addDeviceEndpoints(flows, opts);
const find = (out, pred) => out.find(pred);

test('adds the two endpoints the flow was missing', () => {
  const out = build();
  assert.ok(find(out, (n) => n.type === 'http in' && n.url === '/outlet/:target'));
  assert.ok(find(out, (n) => n.type === 'http in' && n.url === '/acu'));
});

test('both are POST — a control endpoint must not be reachable by following a link', () => {
  const out = build();
  for (const url of ['/outlet/:target', '/acu']) {
    assert.equal(find(out, (n) => n.type === 'http in' && n.url === url).method, 'post');
  }
});

test('the outlet endpoint feeds the real Outlet Logic Hub, not a parallel copy of its logic', () => {
  const auth = find(build(), (n) => n.name === 'Outlet auth + validate');
  assert.ok(auth.wires[0].includes('hub'));
});

test('the ACU endpoint feeds the real AC Master Logic', () => {
  const auth = find(build(), (n) => n.name === 'ACU auth + validate');
  assert.ok(auth.wires[0].includes('acu'));
});

test('each auth node has a second output for the rejection reply, mirroring the light endpoint', () => {
  const out = build();
  for (const name of ['Outlet auth + validate', 'ACU auth + validate']) {
    const auth = find(out, (n) => n.name === name);
    assert.equal(auth.outputs, 2);
    assert.equal(auth.wires.length, 2);
    assert.equal(auth.wires[1].length, 1, 'the failure path must go somewhere');
  }
});

test('both check the shared token, so an unauthenticated caller cannot switch anything', () => {
  const out = build();
  for (const name of ['Outlet auth + validate', 'ACU auth + validate']) {
    const fn = find(out, (n) => n.name === name).func;
    assert.match(fn, /env\.get\('LIGHT_API_TOKEN'\)/);
    assert.match(fn, /x-auth-token/);
    assert.match(fn, /401/);
  }
});

test('the outlet target is validated against the hub\'s real key shape, not trusted from the network', () => {
  const fn = find(build(), (n) => n.name === 'Outlet auth + validate').func;
  assert.match(fn, /CO\[1-7\]_\[12\]/);
});

test('the ACU mode is bounded to codes the IR library actually has, so a bad value fails loudly instead of doing nothing', () => {
  const fn = find(build(), (n) => n.name === 'ACU auth + validate').func;
  assert.match(fn, /OFF/);
  assert.match(fn, /16/);
  assert.match(fn, /30/);
  assert.match(fn, /400/);
});

test('is idempotent — running it twice does not duplicate an endpoint', () => {
  const once = build();
  const twice = addDeviceEndpoints(once, opts);
  assert.equal(twice.filter((n) => n.type === 'http in' && n.url === '/outlet/:target').length, 1);
  assert.equal(twice.filter((n) => n.type === 'http in' && n.url === '/acu').length, 1);
});

test('does not disturb anything already in the flow', () => {
  const before = base();
  const out = build(before);
  for (const original of before) {
    const after = out.find((n) => n.id === original.id);
    assert.deepEqual(after, original, `${original.id} must be untouched`);
  }
});

test('leaves the existing light endpoint exactly as it was', () => {
  const out = build();
  assert.equal(out.filter((n) => n.type === 'http in' && n.url === '/light/:id').length, 1);
});

test('every added node is placed on a real tab, or it would not deploy', () => {
  const out = build();
  const added = out.filter((n) => String(n.id).startsWith('bems_'));
  assert.equal(added.length, 8);
  for (const n of added) assert.ok(['tabS', 'tabA'].includes(n.z), `${n.id} has no tab`);
});
