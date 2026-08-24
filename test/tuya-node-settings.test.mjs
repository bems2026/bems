/**
 * Drift guard for the tuya node settings that live on the four hand-built source tabs.
 *
 * `build-flow.mjs` does not generate those nodes, so nothing else in this repo would notice
 * if their `findTimeout` or `tuyaVersion` changed. The committed, redacted
 * `live-flow-baseline.json` is the only in-repo record of what the running system holds — so
 * checking the declaration against it turns a silent regression into a failing test, without
 * needing a network or a Pi.
 *
 * What this does NOT prove: that the *live* flow still matches. The baseline is a snapshot;
 * re-run `npm run capture-flow:pi` to refresh it. This catches the case where someone changes
 * one of the two and forgets the other.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  TUYA_FIND_TIMEOUT,
  TUYA_NODE_VERSIONS,
  TUYA_VERSION_UNVERIFIED,
  findSettingsDrift,
} from '../shared/tuyaNodeSettings.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const baseline = JSON.parse(readFileSync(join(ROOT, 'node-red-bridge', 'live-flow-baseline.json'), 'utf8'));
const tuyaNodes = baseline.filter((n) => n.type === 'tuya-smart-device');

test('the baseline still has every tuya node the declaration covers', () => {
  assert.equal(tuyaNodes.length, Object.keys(TUYA_NODE_VERSIONS).length);
});

test('no drift between the declaration and the captured flow', () => {
  const drift = findSettingsDrift(baseline);
  assert.deepEqual(
    drift,
    [],
    drift.map((d) => `${d.node}.${d.field}: expected ${d.expected}, baseline has ${d.actual}`).join('\n'),
  );
});

test('findTimeout stays well above the measured 5.0s broadcast interval', () => {
  // The regression this exists to prevent is someone "tidying" it back toward the old 1000.
  assert.ok(Number(TUYA_FIND_TIMEOUT) >= 10000, `findTimeout ${TUYA_FIND_TIMEOUT}ms leaves too little headroom`);
});

test('every declared version is one the tuya library actually speaks', () => {
  const supported = new Set(['3.1', '3.2', '3.3', '3.4', '3.5']);
  for (const [node, version] of Object.entries(TUYA_NODE_VERSIONS)) {
    assert.ok(supported.has(version), `${node} declares ${version}, which tuyapi does not support`);
  }
});

test('every unverified node is a real node, so the caveat list cannot rot', () => {
  const names = new Set(Object.keys(TUYA_NODE_VERSIONS));
  for (const node of TUYA_VERSION_UNVERIFIED) {
    assert.ok(names.has(node), `${node} is listed as unverified but is not a declared node`);
  }
});

test('findSettingsDrift reports a changed value rather than passing it', () => {
  const tampered = baseline.map((n) =>
    n.type === 'tuya-smart-device' && n.deviceName === 'L.O red' ? { ...n, tuyaVersion: '3.3' } : n,
  );
  const drift = findSettingsDrift(tampered);
  assert.equal(drift.length, 1);
  assert.deepEqual(drift[0], { node: 'L.O red', field: 'tuyaVersion', expected: '3.5', actual: '3.3' });
});

test('findSettingsDrift reports a reverted findTimeout, the exact defect that was latent for months', () => {
  const tampered = baseline.map((n) => (n.type === 'tuya-smart-device' ? { ...n, findTimeout: '1000' } : n));
  const drift = findSettingsDrift(tampered);
  assert.equal(drift.length, tuyaNodes.length);
  assert.ok(drift.every((d) => d.field === 'findTimeout' && d.actual === '1000'));
});

test('findSettingsDrift reports a node that has gone missing entirely', () => {
  const without = baseline.filter((n) => !(n.type === 'tuya-smart-device' && n.deviceName === 'CO1'));
  const drift = findSettingsDrift(without);
  assert.deepEqual(drift, [{ node: 'CO1', field: 'presence', expected: 'a node in the flow', actual: 'missing' }]);
});
