import test from 'node:test';
import assert from 'node:assert/strict';
import { redactFlow, findResidualSecrets, REDACTED, SECRET_FIELDS } from '../node-red-bridge/redactFlow.mjs';

const sample = () => [
  { id: 't1', type: 'tab', label: 'Switch' },
  { id: 'n1', type: 'tuya-smart-device', name: 'L.O yellow', deviceId: 'bf1234567890abcdef', deviceKey: 'a1b2c3d4e5f60718', z: 't1', wires: [['n2']] },
  { id: 'n2', type: 'function', name: 'Collect status', func: 'return msg;', z: 't1', wires: [[]] },
  { id: 'n3', type: 'GSheet', name: 'log', sheet: '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789', z: 't1', wires: [[]] },
];

test('redacts every Tuya device key — these are real device credentials and the repo is public', () => {
  const out = redactFlow(sample());
  const tuya = out.find((n) => n.type === 'tuya-smart-device');
  assert.equal(tuya.deviceKey, REDACTED);
  assert.equal(tuya.deviceId, REDACTED);
});

test('redacts Google Sheet ids — a sheet id is a capability, not just a name', () => {
  assert.equal(redactFlow(sample()).find((n) => n.type === 'GSheet').sheet, REDACTED);
});

test('leaves structure untouched, which is the entire point of keeping a baseline', () => {
  const out = redactFlow(sample());
  const fn = out.find((n) => n.id === 'n2');
  assert.equal(fn.func, 'return msg;');
  assert.equal(fn.name, 'Collect status');
  assert.deepEqual(out.find((n) => n.id === 'n1').wires, [['n2']]);
  assert.equal(out.find((n) => n.type === 'tab').label, 'Switch');
  assert.equal(out.length, 4);
});

test('does not mutate the caller\'s flow — the live copy must never be altered by redaction', () => {
  const original = sample();
  redactFlow(original);
  assert.equal(original.find((n) => n.type === 'tuya-smart-device').deviceKey, 'a1b2c3d4e5f60718');
});

test('findResidualSecrets is clean on redacted output', () => {
  assert.deepEqual(findResidualSecrets(redactFlow(sample())), []);
});

test('findResidualSecrets catches an unredacted secret field, so the writer can refuse to save', () => {
  const residual = findResidualSecrets(sample());
  assert.ok(residual.length > 0, 'must flag the raw flow');
  assert.ok(residual.some((r) => r.includes('deviceKey')));
});

test('findResidualSecrets catches a long opaque blob in a field nobody thought to list', () => {
  const sneaky = [{ id: 'x', type: 'http request', name: 'n', someNewField: 'Zm9vYmFyYmF6cXV1eGNvcmdlZ3JhdWx0Z2FycGx5' }];
  assert.ok(findResidualSecrets(sneaky).length > 0);
});

test('every field named in SECRET_FIELDS is actually redacted, so the list cannot drift from the code', () => {
  const node = { id: 'a', type: 'whatever' };
  for (const f of SECRET_FIELDS) node[f] = 'some-real-looking-value';
  const out = redactFlow([node])[0];
  for (const f of SECRET_FIELDS) assert.equal(out[f], REDACTED, `${f} was not redacted`);
});
