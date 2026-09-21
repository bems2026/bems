/**
 * Where Add Device, enrolment and rebind get their facts, now that the vendor cloud is optional.
 *
 * Three sources, each answering a different question:
 *   - LAN presence: what is on the device network now, with its protocol version. No cloud.
 *   - imported credentials: ids and local keys from an export. No cloud.
 *   - the vendor OpenAPI: the same, while an IoT Core subscription happens to be active.
 *
 * The rules under test are about what may be concluded, because the dangerous mistakes here are
 * quiet ones: a lapsed subscription must not hide imported devices, and a device merely unplugged
 * must never be offered as "re-paired" — a rebind would point its node at some other device.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDeviceSources } from './deviceSources.mjs';
import { createCredentialStore } from './credentialStore.mjs';

const KEY = 'abcdefghijklmnop';
const store = () => createCredentialStore({ path: join(mkdtempSync(join(tmpdir(), 'ibems-src-')), 'c.json') });
const row = (id, over = {}) => ({ id, name: id, localKey: KEY, category: 'pc', productName: null, productId: null, sub: false, nodeId: null, ...over });

/** A presence stub: `heard` is the set heard recently; `warm` whether "not heard" means anything. */
const presence = ({ heard = {}, warm = true } = {}) => ({
  get: (id) => (heard[id] ? { id, version: heard[id], productKey: 'pk', lastSeen: 0 } : null),
  heardWithin: (id) => Boolean(heard[id]),
  isWarm: () => warm,
  snapshot: () => Object.entries(heard).map(([id, version]) => ({ id, version, productKey: 'pk', lastSeen: 0 })),
});

const expiredCloud = { listDevices: async () => { throw new Error('Tuya GET /v1.0/iot-01/associated-users/devices failed (code 28841002): IoT Core service subscription has expired.'); }, describeDevice: async () => { throw new Error('expired'); } };

test('with the subscription lapsed, imported devices are still listed, and the cloud says why it is absent', async () => {
  const s = store();
  s.importDevices([row('dev-a')]);
  const sources = createDeviceSources({ store: s, cloud: expiredCloud, presence: presence({ heard: { 'dev-a': '3.4' } }) });
  const r = await sources.list();
  assert.deepEqual(r.devices.map((d) => [d.id, d.credential_source, d.on_lan, d.lan_version]), [['dev-a', 'imported', true, '3.4']]);
  assert.equal(r.sources.cloud.status, 'unavailable');
  assert.equal(r.sources.cloud.detail, 'code 28841002: IoT Core subscription expired');
  assert.equal(r.sources.imported.count, 1);
});

test('the reason served for an unavailable cloud never carries the vendor message text', async () => {
  // A network error's text names the data-centre host, and this detail is served to a browser.
  const down = { listDevices: async () => { throw new Error('fetch failed: getaddrinfo ENOTFOUND openapi-xx.example.com'); } };
  const r = await createDeviceSources({ store: store(), cloud: down, presence: presence() }).list();
  assert.equal(r.sources.cloud.detail, 'unreachable');
  const odd = { listDevices: async () => { throw new Error('Tuya GET /x failed (code 1106): permission deny for account abc'); } };
  const r2 = await createDeviceSources({ store: store(), cloud: odd, presence: presence() }).list();
  assert.equal(r2.sources.cloud.detail, 'vendor error code 1106');
});

test('listWithOrphans reads the cloud once and serves devices, sources and orphans together', async () => {
  let calls = 0;
  const cloud = { listDevices: async () => { calls += 1; return [{ id: 'hub-new', name: 'Smart IR', category: 'wnykq' }]; } };
  const r = await createDeviceSources({ store: store(), cloud, presence: presence({ heard: { 'hub-new': '3.3' } }) })
    .listWithOrphans([{ type: 'tuya-smart-device', deviceName: 'NBRIC IR Blaster', deviceId: 'hub-old', disableAutoStart: false }], () => 'acu_ir');
  assert.equal(calls, 1);
  assert.deepEqual(r.orphan_nodes, [{ name: 'NBRIC IR Blaster', class: 'acu_ir' }]);
  assert.equal(r.sources.cloud.status, 'ok');
  assert.deepEqual(r.devices.map((d) => [d.id, d.credential_source, d.on_lan]), [['hub-new', 'cloud', true]]);
});

test('isOrphan agrees with orphanNodes for a single node, and a destructured source still works', async () => {
  const s = store();
  s.importDevices([row('hub-new')], { complete: true });
  const sources = createDeviceSources({ store: s, cloud: null, presence: presence({ heard: { 'hub-new': '3.3' } }) });
  const { isOrphan, asDeviceSource } = sources;
  assert.equal(await isOrphan({ type: 'tuya-smart-device', deviceName: 'X', deviceId: 'hub-old' }), true);
  assert.equal(await isOrphan({ type: 'tuya-smart-device', deviceName: 'X', deviceId: 'hub-new' }), false);
  const { listDevices } = asDeviceSource();
  assert.equal((await listDevices()).length, 1);
});

test('with no cloud configured at all, that is a state, not an error', async () => {
  const r = await createDeviceSources({ store: store(), cloud: null, presence: presence() }).list();
  assert.equal(r.sources.cloud.status, 'unconfigured');
});

test('a device heard on the network with no key anywhere is listed, so a new pairing shows up at once', async () => {
  const r = await createDeviceSources({ store: store(), cloud: null, presence: presence({ heard: { 'new-dev': '3.5' } }) }).list();
  assert.deepEqual(r.devices.map((d) => [d.id, d.credential_source, d.on_lan, d.name]), [['new-dev', null, true, null]]);
});

test('a key is read from the import first, then the cloud, and a failing cloud is not an error', async () => {
  const s = store();
  s.importDevices([row('dev-a')]);
  const cloud = { listDevices: async () => [{ id: 'dev-c', name: 'C', category: 'tdq' }], describeDevice: async (id) => (id === 'dev-c' ? { local_key: 'cccccccccccccccc' } : null) };
  const src = createDeviceSources({ store: s, cloud, presence: presence() }).asDeviceSource();
  assert.deepEqual(await src.describeDevice('dev-a'), { local_key: KEY });
  assert.deepEqual(await src.describeDevice('dev-c'), { local_key: 'cccccccccccccccc' });
  const failing = createDeviceSources({ store: s, cloud: expiredCloud, presence: presence() }).asDeviceSource();
  assert.equal(await failing.describeDevice('dev-z'), null);
});

test('the protocol version comes from what the device announces', async () => {
  const sources = createDeviceSources({ store: store(), cloud: null, presence: presence({ heard: { 'dev-a': '3.3' } }) });
  assert.equal(await sources.versionFor('dev-a', { listen: async () => null }), '3.3');
  assert.equal(await sources.versionFor('dev-b', { listen: async () => ({ version: '3.5' }) }), '3.5');
});

// --- orphans -----------------------------------------------------------------------------------

const node = (deviceName, deviceId, over = {}) => ({ type: 'tuya-smart-device', deviceName, deviceId, disableAutoStart: false, ...over });
const classFor = (n) => ({ 'NBRIC IR Blaster': 'acu_ir', CO5: 'outlet_dual' })[n] ?? null;

test('a node is orphaned when the latest full list no longer has its device AND the network has not heard it', async () => {
  const s = store();
  s.importDevices([row('hub-new', { category: 'wnykq' }), row('co5-id')], { source: 'import', complete: true });
  const sources = createDeviceSources({ store: s, cloud: null, presence: presence({ heard: { 'hub-new': '3.3', 'co5-id': '3.4' } }) });
  const orphans = await sources.orphanNodes([node('NBRIC IR Blaster', 'hub-old'), node('CO5', 'co5-id')], classFor);
  assert.deepEqual(orphans, [{ name: 'NBRIC IR Blaster', class: 'acu_ir' }]);
});

test('a device that is merely unplugged is NOT an orphan — it is still in the list', async () => {
  const s = store();
  s.importDevices([row('co5-id')], { complete: true });
  const sources = createDeviceSources({ store: s, cloud: null, presence: presence({ heard: {} }) });
  assert.deepEqual(await sources.orphanNodes([node('CO5', 'co5-id')], classFor), []);
});

test('a node still heard on the network is never an orphan, whatever a list says', async () => {
  const s = store();
  s.importDevices([row('other')], { complete: true });
  const sources = createDeviceSources({ store: s, cloud: null, presence: presence({ heard: { 'co5-id': '3.4' } }) });
  assert.deepEqual(await sources.orphanNodes([node('CO5', 'co5-id')], classFor), []);
});

test('with no complete list from anywhere, nothing can be called an orphan', async () => {
  const s = store();
  s.importDevices([row('hub-new')]); // a partial import: it does not claim to be the whole account
  const sources = createDeviceSources({ store: s, cloud: expiredCloud, presence: presence({ heard: {} }) });
  assert.deepEqual(await sources.orphanNodes([node('NBRIC IR Blaster', 'hub-old')], classFor), []);
});

test('a quiesced node is never an orphan by network silence — it is silent on purpose', async () => {
  const s = store();
  s.importDevices([row('x')], { complete: true });
  const sources = createDeviceSources({ store: s, cloud: null, presence: presence({ heard: {} }) });
  // Outside Temp: never installed, quiesced, in no list. Its class is null anyway; the rule holds regardless.
  assert.deepEqual(await sources.orphanNodes([node('CO5', 'gone', { disableAutoStart: true })], classFor), []);
});

test('a cold listener cannot vouch for silence', async () => {
  const s = store();
  s.importDevices([row('x')], { complete: true });
  const sources = createDeviceSources({ store: s, cloud: null, presence: presence({ heard: {}, warm: false }) });
  assert.deepEqual(await sources.orphanNodes([node('CO5', 'gone')], classFor), []);
  assert.equal(await sources.isOrphan(node('CO5', 'gone'), classFor), false);
});

test('orphans carry names and classes only — never the stale vendor id', async () => {
  const s = store();
  s.importDevices([row('x')], { complete: true });
  const sources = createDeviceSources({ store: s, cloud: null, presence: presence({ heard: {} }) });
  const orphans = await sources.orphanNodes([node('NBRIC IR Blaster', 'hub-old')], classFor);
  assert.equal(orphans.length, 1);
  assert.equal(JSON.stringify(orphans).includes('hub-old'), false);
});

test('without a warm listener, rebind can listen once for the one device instead', async () => {
  const s = store();
  s.importDevices([row('hub-new')], { complete: true });
  const noPresence = createDeviceSources({ store: s, cloud: null, presence: null });
  const heardNothing = async () => null;
  const heardIt = async () => ({ version: '3.3' });
  const brokenListener = async () => { throw new Error('EADDRINUSE'); };
  assert.equal(await noPresence.isOrphan(node('X', 'hub-old'), classFor, { listen: heardNothing }), true);
  assert.equal(await noPresence.isOrphan(node('X', 'hub-old'), classFor, { listen: heardIt }), false);
  assert.equal(await noPresence.isOrphan(node('X', 'hub-old'), classFor, { listen: brokenListener }), false, 'a failed listener is not silence');
  assert.equal(await noPresence.isOrphan(node('X', 'hub-new'), classFor, { listen: heardNothing }), false, 'still listed, so merely unplugged');
  // No complete list: silence alone proves nothing, so the listener is never even consulted.
  let asked = false;
  const partial = createDeviceSources({ store: store(), cloud: null, presence: null });
  assert.equal(await partial.isOrphan(node('X', 'hub-old'), classFor, { listen: async () => { asked = true; return null; } }), false);
  assert.equal(asked, false);
});
