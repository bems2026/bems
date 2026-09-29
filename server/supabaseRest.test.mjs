/**
 * Tests for server/supabaseRest.mjs — the hand-rolled PostgREST client.
 *
 * What these pin is the one fact RM-148's uploader decides on: a refusal carries the HTTP status
 * it came with, so "the database said no to these rows" can be told from "the database could not
 * be reached". A hand-rolled `fetchImpl` stands in for the network.
 *
 *     node --test server/supabaseRest.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeSupabaseClient } from './supabaseRest.mjs';

const answering = (status, body = '') => async () => new Response(body, { status });

test('a refusal carries its HTTP status and keeps its message', async () => {
  const client = makeSupabaseClient({ url: 'https://db.example', serviceRoleKey: 'k', fetchImpl: answering(400, '{"code":"23514"}') });
  await assert.rejects(client.upsert('readings', [{ a: 1 }], { onConflict: 'device_id,ts' }), (err) => {
    assert.equal(err.status, 400);
    assert.match(err.message, /-> 400: \{"code":"23514"\}/);
    return true;
  });
});

test('an unreachable database fails with no status at all', async () => {
  const client = makeSupabaseClient({ url: 'https://db.example', serviceRoleKey: 'k', fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(client.upsert('readings', [{ a: 1 }]), (err) => {
    assert.equal(err.status, undefined);
    return true;
  });
});

test('upsert asks PostgREST to merge duplicates on the named conflict target', async () => {
  let seen;
  const client = makeSupabaseClient({
    url: 'https://db.example/', serviceRoleKey: 'k',
    fetchImpl: async (url, init) => { seen = { url, init }; return new Response(null, { status: 201 }); },
  });
  await client.upsert('readings', [{ a: 1 }], { onConflict: 'device_id,ts' });
  assert.equal(seen.url, 'https://db.example/rest/v1/readings?on_conflict=device_id%2Cts');
  assert.equal(seen.init.headers.Prefer, 'resolution=merge-duplicates,return=minimal');
});
