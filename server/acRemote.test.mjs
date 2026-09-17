/**
 * Finding the aircon's virtual remote in the vendor cloud without writing its id anywhere.
 *
 * The "Air" remote has no node in the flow — it has no network presence to poll — so the flow
 * cannot be where its id lives, and this repository is public. It is resolved from the cloud
 * listing instead: the project's one `infrared_ac` device. Zero or several is an answer with a
 * reason, never a guess: commanding the wrong remote would point one room's aircon at another's.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createAcRemoteResolver } from './acRemote.mjs';

const listing = (devices) => ({ listDevices: async () => devices });

test('the sole infrared_ac device is the remote', async () => {
  const resolve = createAcRemoteResolver({
    client: listing([{ id: 'hub', category: 'wnykq' }, { id: 'air', category: 'infrared_ac', sub: true }, { id: 'co1', category: 'pc' }]),
  });
  assert.deepEqual(await resolve(), { ok: true, id: 'air' });
});

test('none is a reason, not an error thrown', async () => {
  const r = await createAcRemoteResolver({ client: listing([{ id: 'hub', category: 'wnykq' }]) })();
  assert.equal(r.ok, false);
  assert.match(r.reason, /no aircon remote/);
});

test('two is refused rather than picking one', async () => {
  const r = await createAcRemoteResolver({ client: listing([{ id: 'a', category: 'infrared_ac' }, { id: 'b', category: 'infrared_ac' }]) })();
  assert.equal(r.ok, false);
  assert.match(r.reason, /2 aircon remotes/);
  assert.equal('id' in r, false);
});

test('an answer is cached for ten minutes, so a command does not cost a listing call', async () => {
  let calls = 0;
  let now = 0;
  const resolve = createAcRemoteResolver({
    client: { listDevices: async () => { calls += 1; return [{ id: 'air', category: 'infrared_ac' }]; } },
    now: () => now,
  });
  await resolve();
  now = 9 * 60_000;
  await resolve();
  assert.equal(calls, 1);
  now = 11 * 60_000;
  await resolve();
  assert.equal(calls, 2);
});

test('a failed listing is reported, and retried after half a minute rather than ten', async () => {
  let calls = 0;
  let now = 0;
  const resolve = createAcRemoteResolver({
    client: { listDevices: async () => { calls += 1; throw new Error('Tuya GET failed (code 1010): token invalid'); } },
    now: () => now,
  });
  const r = await resolve();
  assert.equal(r.ok, false);
  assert.match(r.reason, /could not list/);
  now = 31_000;
  await resolve();
  assert.equal(calls, 2);
});

test('no client is a reason too', async () => {
  const r = await createAcRemoteResolver({ client: null })();
  assert.equal(r.ok, false);
  assert.match(r.reason, /not configured/);
});
