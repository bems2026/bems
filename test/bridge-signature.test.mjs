/**
 * Detecting that a deployed bridge tab no longer matches the generated one.
 *
 * WHY THIS EXISTS: `deploy:pi` used to decide "already deployed" from the bridge tab's id being
 * present, and nothing else. So a regenerated `bridge-flow.json` — new parser, new collector,
 * a changed `buildLatest` — reported **"Nothing to do"** and exited 0. That reads exactly like
 * success. On 2026-08-25 it silently skipped a fix to the aircon's online rule, and the only
 * reason it was caught is that someone read the live flow back and compared the two by hand.
 *
 * The signature deliberately ignores ids and canvas coordinates. `build-flow.mjs` assigns
 * per-node ids sequentially and does not guarantee them stable across a re-run (deploy.mjs says
 * so itself), so comparing on ids would report drift on every regeneration and train people to
 * pass --force reflexively — which is the same failure wearing the opposite mask.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bridgeSignature } from '../node-red-bridge/bridgeSignature.mjs';

const nodes = () => [
  { id: 'tab1', type: 'tab', label: 'iBEMS Bridge' },
  { id: 'a1', type: 'function', z: 'tab1', name: 'Build latest readings', func: 'return 1;', x: 10, y: 20, wires: [['b1']] },
  { id: 'b1', type: 'http response', z: 'tab1', name: '', x: 30, y: 20, wires: [] },
];

test('identical node sets produce identical signatures', () => {
  assert.equal(bridgeSignature(nodes()), bridgeSignature(nodes()));
});

test('a changed function body changes the signature — the case that was missed', () => {
  const changed = nodes().map((n) => (n.id === 'a1' ? { ...n, func: 'return 2;' } : n));
  assert.notEqual(bridgeSignature(nodes()), bridgeSignature(changed));
});

test('re-assigned node ids do NOT change the signature', () => {
  // build-flow.mjs numbers nodes sequentially and does not promise stability across a re-run.
  // Treating that as drift would make --force the reflex, which defeats the point of asking.
  const renumbered = nodes().map((n) => ({ ...n, id: n.id + '_regenerated' }));
  const rewired = renumbered.map((n) => (n.name === 'Build latest readings' ? { ...n, wires: [['b1_regenerated']] } : n));
  assert.equal(bridgeSignature(nodes()), bridgeSignature(rewired));
});

test('moving a node on the canvas does NOT change the signature', () => {
  const moved = nodes().map((n) => ({ ...n, x: (n.x ?? 0) + 500, y: (n.y ?? 0) + 500 }));
  assert.equal(bridgeSignature(nodes()), bridgeSignature(moved));
});

test('adding a node changes the signature', () => {
  const extra = [...nodes(), { id: 'c1', type: 'debug', z: 'tab1', name: 'extra', wires: [] }];
  assert.notEqual(bridgeSignature(nodes()), bridgeSignature(extra));
});

test('removing a node changes the signature', () => {
  assert.notEqual(bridgeSignature(nodes()), bridgeSignature(nodes().filter((n) => n.id !== 'b1')));
});

test('a renamed node changes the signature', () => {
  const renamed = nodes().map((n) => (n.id === 'a1' ? { ...n, name: 'Build latest readings v2' } : n));
  assert.notEqual(bridgeSignature(nodes()), bridgeSignature(renamed));
});

test('a changed http endpoint url changes the signature', () => {
  const withUrl = [...nodes(), { id: 'h1', type: 'http in', z: 'tab1', name: 'latest', url: '/readings/latest', wires: [[]] }];
  const moved = withUrl.map((n) => (n.id === 'h1' ? { ...n, url: '/readings/newest' } : n));
  assert.notEqual(bridgeSignature(withUrl), bridgeSignature(moved));
});

test('node order does not matter — the same set in any order is the same signature', () => {
  assert.equal(bridgeSignature(nodes()), bridgeSignature([...nodes()].reverse()));
});
