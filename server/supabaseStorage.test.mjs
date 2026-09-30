/**
 * Tests for server/supabaseStorage.mjs — the hand-rolled client for the project's file storage,
 * where RM-148 keeps each sealed day off the edge. A hand-rolled `fetchImpl` is the network.
 *
 *     node --test server/supabaseStorage.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeStorageClient } from './supabaseStorage.mjs';

function network(answer = () => new Response('{}', { status: 200 })) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return answer(url, init);
  };
  return { calls, fetchImpl };
}

test('an upload overwrites the object at its path, as the service role, with its content type', async () => {
  const { calls, fetchImpl } = network();
  const storage = makeStorageClient({ url: 'https://db.example/', serviceRoleKey: 'k', fetchImpl });
  await storage.upload('ibems-archive', 'site/raw/2026/08/2026-08-16.readings.csv.gz', Buffer.from('x'));
  const [{ url, init }] = calls;
  assert.equal(url, 'https://db.example/storage/v1/object/ibems-archive/site/raw/2026/08/2026-08-16.readings.csv.gz');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['x-upsert'], 'true');
  assert.equal(init.headers['Content-Type'], 'application/gzip');
  assert.equal(init.headers.Authorization, 'Bearer k');
  assert.equal(init.headers.apikey, 'k');
});

test('a refusal carries its status, like the database client', async () => {
  const { fetchImpl } = network(() => new Response('{"error":"Payload too large"}', { status: 413 }));
  const storage = makeStorageClient({ url: 'https://db.example', serviceRoleKey: 'k', fetchImpl });
  await assert.rejects(storage.upload('b', 'p', Buffer.from('x')), (err) => err.status === 413 && /Payload too large/.test(err.message));
});

test('a bucket that does not exist reads as null, not as an error', async () => {
  const missing = network(() => new Response('{"statusCode":"404","error":"Bucket not found"}', { status: 400 }));
  assert.equal(await makeStorageClient({ url: 'https://db.example', serviceRoleKey: 'k', fetchImpl: missing.fetchImpl }).getBucket('ibems-archive'), null);
  const present = network(() => new Response('{"id":"ibems-archive","public":false}', { status: 200 }));
  assert.deepEqual(await makeStorageClient({ url: 'https://db.example', serviceRoleKey: 'k', fetchImpl: present.fetchImpl }).getBucket('ibems-archive'), { id: 'ibems-archive', public: false });
});

test('a bucket is created private', async () => {
  const { calls, fetchImpl } = network();
  await makeStorageClient({ url: 'https://db.example', serviceRoleKey: 'k', fetchImpl }).createBucket('ibems-archive');
  assert.equal(calls[0].url, 'https://db.example/storage/v1/bucket');
  assert.deepEqual(JSON.parse(calls[0].init.body), { id: 'ibems-archive', name: 'ibems-archive', public: false });
});

test('a download comes back as bytes', async () => {
  const { fetchImpl } = network(() => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
  const bytes = await makeStorageClient({ url: 'https://db.example', serviceRoleKey: 'k', fetchImpl }).download('b', 'p');
  assert.deepEqual([...bytes], [1, 2, 3]);
});

test('a listing asks for one folder, by name, and pages past the first thousand', async () => {
  // RM-149's weekly backups rotate by listing their folder. Storage returns at most `limit` entries
  // and says nothing when it stops there, so a full page means ask again.
  const pages = [Array.from({ length: 1000 }, (_, i) => ({ name: `a${i}`, id: String(i) })), [{ name: 'last', id: 'x' }]];
  const { calls, fetchImpl } = network(() => new Response(JSON.stringify(pages.shift() ?? []), { status: 200 }));
  const storage = makeStorageClient({ url: 'https://db.example', serviceRoleKey: 'k', fetchImpl });
  const entries = await storage.list('ibems-archive', 'site/backup');
  assert.equal(entries.length, 1001);
  assert.equal(calls[0].url, 'https://db.example/storage/v1/object/list/ibems-archive');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), { prefix: 'site/backup', limit: 1000, offset: 0, sortBy: { column: 'name', order: 'asc' } });
  assert.equal(JSON.parse(calls[1].init.body).offset, 1000);
});

test('removing names each object, and nothing is sent for an empty list', async () => {
  const { calls, fetchImpl } = network(() => new Response('[]', { status: 200 }));
  const storage = makeStorageClient({ url: 'https://db.example', serviceRoleKey: 'k', fetchImpl });
  await storage.remove('ibems-archive', []);
  assert.equal(calls.length, 0);
  await storage.remove('ibems-archive', ['site/backup/2026-08-01/sites.ndjson.gz']);
  assert.equal(calls[0].url, 'https://db.example/storage/v1/object/ibems-archive');
  assert.equal(calls[0].init.method, 'DELETE');
  assert.deepEqual(JSON.parse(calls[0].init.body), { prefixes: ['site/backup/2026-08-01/sites.ndjson.gz'] });
});
