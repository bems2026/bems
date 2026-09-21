/**
 * Importing device ids and local keys from an export, instead of reading them from the vendor cloud.
 *
 * WHY (2026-09-17): the Tuya IoT Core subscription is a time-limited trial, and this project uses it
 * only to extract ids and keys once. Keys can instead come from a tool that logs in with the Smart
 * Life app's QR code and needs no developer account, or from `tinytuya wizard`'s `devices.json`. The
 * importer takes whichever the operator has, so onboarding no longer depends on a subscription.
 *
 * It refuses rather than guesses. A row without an id or a plausible key is reported, not stored,
 * because a wrong key does not fail loudly: it produces a node that reads offline forever.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseCredentialExport } from './credentialImport.mjs';
import { createCredentialStore } from './credentialStore.mjs';

const KEY = 'abcdefghijklmnop'; // 16 chars, the shape of a Tuya local key
const KEY2 = 'ponmlkjihgfedcba';

test('reads tinytuya devices.json', () => {
  const content = JSON.stringify([
    { name: 'CO8', id: 'bf0000000000000000aaaa', key: KEY, category: 'pc', product_name: 'Smart Wall Socket', product_id: 'prodyhan', sub: false, uuid: 'u1', mac: '00:11', version: '3.4' },
  ]);
  const { devices, problems, format } = parseCredentialExport(content);
  assert.equal(format, 'json');
  assert.deepEqual(problems, []);
  assert.deepEqual(devices, [
    { id: 'bf0000000000000000aaaa', name: 'CO8', localKey: KEY, category: 'pc', productName: 'Smart Wall Socket', productId: 'prodyhan', sub: false, nodeId: null },
  ]);
});

test('reads the device-sharing SDK record shape (local_key, product_id, node_id)', () => {
  const content = JSON.stringify({
    devices: [{ id: 'bf1', name: 'Smart IR', local_key: KEY, category: 'wnykq', product_id: 'prodwarp', product_name: 'Smart IR', sub: false }],
  });
  const { devices } = parseCredentialExport(content);
  assert.equal(devices[0].localKey, KEY);
  assert.equal(devices[0].category, 'wnykq');
});

test('reads a CSV export with human column names', () => {
  const csv = 'Name,Device ID,Local Key,Category,Product ID,Sub Device\n"Outlet, spare",bf2,' + KEY + ',pc,prodyhan,false\nAir,bf3,' + KEY2 + ',infrared_ac,prodair,true\n';
  const { devices, problems, format } = parseCredentialExport(csv);
  assert.equal(format, 'csv');
  assert.deepEqual(problems, []);
  assert.deepEqual(devices.map((d) => [d.id, d.name, d.category, d.sub]), [
    ['bf2', 'Outlet, spare', 'pc', false],
    ['bf3', 'Air', 'infrared_ac', true],
  ]);
});

test('a row with no id, or a key that is not a key, is reported and not imported', () => {
  const content = JSON.stringify([
    { name: 'no id', key: KEY },
    { name: 'no key', id: 'bf4' },
    { name: 'short key', id: 'bf5', key: 'abc' },
    { name: 'ok', id: 'bf6', key: KEY },
  ]);
  const { devices, problems } = parseCredentialExport(content);
  assert.deepEqual(devices.map((d) => d.id), ['bf6']);
  assert.equal(problems.length, 3);
  // Problems name the row, never the key.
  assert.equal(problems.join(' ').includes(KEY), false);
});

test('a Bluetooth-only device, which the SDK reports without a local key, is skipped with a reason', () => {
  const { devices, problems } = parseCredentialExport(JSON.stringify([{ id: 'ble1', name: 'Lock', local_key: '-' }]));
  assert.deepEqual(devices, []);
  assert.match(problems[0], /no local key/);
});

test('something that is neither JSON nor a CSV with the needed columns is refused', () => {
  const { devices, problems } = parseCredentialExport('hello world');
  assert.deepEqual(devices, []);
  assert.match(problems[0], /not a recognised export/);
});

// --- the store ---------------------------------------------------------------------------------

const tempStore = () => join(mkdtempSync(join(tmpdir(), 'ibems-creds-')), 'device-credentials.json');

test('the store keeps keys on disk and never hands them back in its public view', () => {
  const path = tempStore();
  const store = createCredentialStore({ path, now: () => 1000 });
  const r = store.importDevices([{ id: 'bf6', name: 'CO8', localKey: KEY, category: 'pc', productName: null, productId: null, sub: false, nodeId: null }], { source: 'tinytuya' });
  assert.deepEqual([r.added, r.updated], [1, 0]);
  assert.equal(JSON.stringify(store.publicView()).includes(KEY), false);
  assert.deepEqual(store.publicView()[0], { id: 'bf6', name: 'CO8', category: 'pc', product_name: null, product_id: null, sub: false, credential_length: 16, imported_at: new Date(1000).toISOString(), source: 'tinytuya' });
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).devices.bf6.localKey, KEY);
});

test('the store file is readable by its owner only', { skip: process.platform === 'win32' && 'POSIX modes are not enforced on Windows' }, () => {
  const path = tempStore();
  createCredentialStore({ path }).importDevices([{ id: 'x', name: 'x', localKey: KEY, category: null, productName: null, productId: null, sub: false, nodeId: null }]);
  assert.equal(statSync(path).mode & 0o777, 0o600);
});

test('a later import replaces a device\'s key — a re-pair issues a new one', () => {
  const path = tempStore();
  const store = createCredentialStore({ path });
  store.importDevices([{ id: 'bf6', name: 'CO8', localKey: KEY, category: 'pc', productName: null, productId: null, sub: false, nodeId: null }]);
  const r = store.importDevices([{ id: 'bf6', name: 'CO8', localKey: KEY2, category: 'pc', productName: null, productId: null, sub: false, nodeId: null }]);
  assert.deepEqual([r.added, r.updated], [0, 1]);
  assert.equal(store.localKeyFor('bf6'), KEY2);
});

test('the store is a device source with the vendor client\'s shape, so enrolment can use either', async () => {
  const store = createCredentialStore({ path: tempStore() });
  store.importDevices([{ id: 'bf1', name: 'Smart IR', localKey: KEY, category: 'wnykq', productName: 'Smart IR', productId: 'p', sub: false, nodeId: null }]);
  const source = store.asDeviceSource();
  assert.deepEqual(await source.listDevices(), [{ id: 'bf1', name: 'Smart IR', category: 'wnykq', product_name: 'Smart IR', product_id: 'p', sub: false, online: null }]);
  assert.deepEqual(await source.describeDevice('bf1'), { local_key: KEY });
  assert.equal(await source.describeDevice('nope'), null);
});

test('a missing store file is an empty store, and removing a device takes its key with it', () => {
  const path = tempStore();
  const store = createCredentialStore({ path });
  assert.deepEqual(store.publicView(), []);
  assert.equal(existsSync(path), false);
  store.importDevices([{ id: 'bf6', name: 'CO8', localKey: KEY, category: null, productName: null, productId: null, sub: false, nodeId: null }]);
  assert.equal(store.remove('bf6'), true);
  assert.equal(store.localKeyFor('bf6'), null);
});
