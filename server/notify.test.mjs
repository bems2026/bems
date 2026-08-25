/**
 * The alert channel.
 *
 * Most of these are about what it does when it is NOT configured and when it FAILS, because
 * those are the paths that decide whether adding notifications can take ingestion down with
 * it. Sending, when everything works, is the easy case.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNotifier, fleetMessage } from './notify.mjs';

const ok = async () => ({ ok: true, status: 200 });

test('is inert with no topic configured, and says nothing about it', () => {
  const logs = [];
  const n = createNotifier({}, { fetchImpl: async () => { throw new Error('must not be called'); }, log: (m) => logs.push(m) });
  assert.equal(n.configured, false);
  return n.notify('t', 'b').then(() => {
    assert.deepEqual(logs, [], 'a deployment that never asked for this must not be nagged every tick');
  });
});

test('posts to the configured topic', async () => {
  let seen = null;
  const n = createNotifier({ NTFY_TOPIC: 'my-topic' }, { fetchImpl: async (url, init) => { seen = { url, init }; return ok(); } });
  await n.notify('Title here', 'Body here', 'high');
  assert.equal(seen.url, 'https://ntfy.sh/my-topic');
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers.Title, 'Title here');
  assert.equal(seen.init.headers.Priority, 'high');
  assert.equal(seen.init.body, 'Body here');
});

test('honours a self-hosted server, and strips a trailing slash', async () => {
  let url = null;
  const n = createNotifier({ NTFY_TOPIC: 't', NTFY_SERVER: 'https://ntfy.example.org/' }, { fetchImpl: async (u) => { url = u; return ok(); } });
  await n.notify('a', 'b');
  assert.equal(url, 'https://ntfy.example.org/t');
});

test('encodes a topic that would otherwise break the URL', async () => {
  let url = null;
  const n = createNotifier({ NTFY_TOPIC: 'a b/c' }, { fetchImpl: async (u) => { url = u; return ok(); } });
  await n.notify('a', 'b');
  assert.equal(url, 'https://ntfy.sh/a%20b%2Fc');
});

test('a network failure is logged, never thrown — ingestion outranks notification', async () => {
  const logs = [];
  const n = createNotifier({ NTFY_TOPIC: 't' }, {
    fetchImpl: async () => { throw new Error('getaddrinfo ENOTFOUND'); },
    log: (m) => logs.push(m),
  });
  await n.notify('a', 'b'); // must resolve
  assert.match(logs.join(' '), /could not send/);
});

test('a refusal is logged, never thrown', async () => {
  const logs = [];
  const n = createNotifier({ NTFY_TOPIC: 't' }, { fetchImpl: async () => ({ ok: false, status: 429 }), log: (m) => logs.push(m) });
  await n.notify('a', 'b');
  assert.match(logs.join(' '), /429/);
});

test('an empty or whitespace topic counts as unconfigured', () => {
  assert.equal(createNotifier({ NTFY_TOPIC: '   ' }).configured, false);
});

/** The wording is the part a person reads at 2am, so it is asserted rather than assumed. */
test('the stuck message names the devices and the remedy', () => {
  const m = fleetMessage({ kind: 'stuck', devices: ['co1', 'co2', 'co3'] });
  assert.match(m.title, /3 devices stopped responding/);
  assert.match(m.body, /co1, co2, co3/);
  assert.match(m.body, /restarting Node-RED/);
  assert.match(m.body, /power cycling/);
  assert.equal(m.priority, 'high');
});

test('the recovery message closes the loop and asks for nothing', () => {
  const m = fleetMessage({ kind: 'recovered', devices: [] });
  assert.match(m.body, /No action needed/);
  assert.equal(m.priority, 'default');
});
