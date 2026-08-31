/**
 * Guards `healthWiringPlan` — the repair that lets a meter's health flag go false at all.
 *
 * The properties worth pinning are almost all about restraint. These nodes live on the four
 * hand-built source tabs, which `build-flow.mjs` does not generate and nothing in this repo can
 * restore: `findTimeout` and `tuyaVersion` exist only there, and losing them presents as every
 * device going offline, which reads as a network fault and has already cost this project days.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planHealthWiring, validateHealthWiring, needsHealthWiring } from '../node-red-bridge/healthWiringPlan.mjs';

const tuya = (over = {}) => ({
  type: 'tuya-smart-device',
  id: 'n1',
  deviceName: 'A',
  tuyaVersion: '3.5',
  findTimeout: '10000',
  disableAutoStart: false,
  wires: [['parser'], []],
  ...over,
});

test('a node whose status output leads nowhere is repaired to mirror its data output', () => {
  const before = [tuya()];
  const { flows: after, changed } = planHealthWiring(before);
  assert.equal(changed.length, 1);
  assert.deepEqual(after[0].wires, [['parser'], ['parser']]);
  assert.deepEqual(validateHealthWiring(before, after), []);
});

test('a node already wired is left byte-identical — it may be wired somewhere unusual on purpose', () => {
  const before = [tuya({ wires: [['parser'], ['somewhere-else']] })];
  const { flows: after, changed } = planHealthWiring(before);
  assert.equal(changed.length, 0);
  assert.equal(JSON.stringify(after[0]), JSON.stringify(before[0]));
});

test('a node with no data target is left alone rather than reported as repaired', () => {
  // Copying an empty list into output 2 achieves nothing; claiming it as a fix would make the
  // report assert a repair that did not happen.
  const before = [tuya({ wires: [[], []] })];
  const { changed } = planHealthWiring(before);
  assert.equal(changed.length, 0);
  assert.equal(needsHealthWiring(before).length, 0);
});

test('a node feeding two parsers mirrors both, not just the first', () => {
  // The real case: one physical meter reporting two logical channels, so its data output goes
  // to two parsers. Mirroring only the first would leave the second channel's health flag
  // exactly as broken as before, and the fix would look done.
  const before = [tuya({ wires: [['parserA', 'parserB'], []] })];
  const { flows: after } = planHealthWiring(before);
  assert.deepEqual(after[0].wires[1], ['parserA', 'parserB']);
  assert.deepEqual(validateHealthWiring(before, after), []);
});

test('the two outputs do not alias, so editing one later cannot silently rewire the other', () => {
  const before = [tuya()];
  const { flows: after } = planHealthWiring(before);
  assert.notEqual(after[0].wires[0], after[0].wires[1], 'must be distinct arrays, not one reference twice');
});

test('re-running changes nothing — the plan is idempotent', () => {
  const first = planHealthWiring([tuya()]);
  const second = planHealthWiring(first.flows);
  assert.equal(second.changed.length, 0);
  assert.equal(JSON.stringify(second.flows), JSON.stringify(first.flows));
});

test('non-tuya nodes are never touched, however they are wired', () => {
  const before = [{ type: 'function', id: 'f1', name: 'parser', wires: [['x'], []] }];
  const { flows: after, changed } = planHealthWiring(before);
  assert.equal(changed.length, 0);
  assert.equal(JSON.stringify(after), JSON.stringify(before));
});

test('the settings that exist only on the live flow survive the edit', () => {
  // findTimeout and tuyaVersion are declared nowhere in this repo. An edit that dropped them
  // would present as every device going offline, with no diff and no alarm.
  const before = [tuya()];
  const { flows: after } = planHealthWiring(before);
  assert.equal(after[0].tuyaVersion, '3.5');
  assert.equal(after[0].findTimeout, '10000');
  assert.equal(after[0].disableAutoStart, false);
});

// --- the validator has to be able to fail, or it is counted as coverage while asserting nothing

test('the validator rejects a changed data output', () => {
  const before = [tuya()];
  const after = [{ ...tuya(), wires: [['someone-else'], ['someone-else']] }];
  assert.match(validateHealthWiring(before, after).join(' '), /DATA output was modified/);
});

test('the validator rejects a property change smuggled in beside the rewire', () => {
  const before = [tuya()];
  const after = [{ ...tuya(), tuyaVersion: '3.3', wires: [['parser'], ['parser']] }];
  assert.match(validateHealthWiring(before, after).join(' '), /property other than wires/);
});

test('the validator rejects touching a node whose status output was already wired', () => {
  const before = [tuya({ wires: [['parser'], ['somewhere-else']] })];
  const after = [tuya({ wires: [['parser'], ['parser']] })];
  assert.match(validateHealthWiring(before, after).join(' '), /already wired/);
});

test('the validator rejects an added or removed node', () => {
  assert.match(validateHealthWiring([tuya()], []).join(' '), /node count changed/);
  assert.match(validateHealthWiring([tuya()], [tuya(), tuya({ id: 'n2' })]).join(' '), /node count changed/);
});

test('the validator rejects a status output that does not mirror the data output', () => {
  const before = [tuya()];
  const after = [tuya({ wires: [['parser'], ['parser', 'extra']] })];
  assert.match(validateHealthWiring(before, after).join(' '), /must mirror the data output/);
});
