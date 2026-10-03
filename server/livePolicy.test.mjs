import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLivePolicy, POLICY_TTL_MS } from './livePolicy.mjs';

/**
 * The property every one of these defends: **a policy floor must never disappear because a
 * database was unreachable.** The floor exists to refuse commands; losing it silently lets
 * through exactly what it was there to stop, and nothing on any screen would say so.
 */

const BUILD = { acu_min_setpoint_c: 25, dispatch: 'local-first' };

/** A fake PostgREST that returns whatever `rows` is set to, or throws. */
function fakeFetch(rows, { status = 200, boom = false } = {}) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    if (boom) throw new Error('network down');
    return { ok: status >= 200 && status < 300, status, json: async () => rows };
  };
  impl.calls = calls;
  return impl;
}

const make = (fetchImpl, now = () => 1000) =>
  createLivePolicy({ buildPolicy: BUILD, siteId: 's1', supabaseUrl: 'https://db.test', supabaseKey: 'k', fetchImpl, now });

test('before any read, the build policy is what applies', () => {
  const p = make(fakeFetch([]));
  assert.deepEqual(p.current(), BUILD);
  assert.equal(p.status().source, 'build');
});

test('a successful read wins over the build value, including when it is more permissive', async () => {
  // The point of the feature: an operator lowering the floor is making the decision the setter
  // function exists to let them make. The hardware bound still applies afterwards.
  const p = make(fakeFetch([{ policy: { acu_min_setpoint_c: 24, dispatch: 'local-first' } }]));
  await p.refresh();
  assert.equal(p.current().acu_min_setpoint_c, 24);
  assert.equal(p.status().source, 'database');
});

test('a key the database does not carry keeps what the site file declared', async () => {
  // Otherwise a row written before a policy key existed would blank it, and `dispatch` becoming
  // undefined means the proxy falls back to `local-first` — a change nobody asked for.
  const p = make(fakeFetch([{ policy: { acu_min_setpoint_c: 24 } }]));
  await p.refresh();
  assert.equal(p.current().dispatch, 'local-first');
});

test('a network failure leaves the build policy in force, not an empty one', async () => {
  const p = make(fakeFetch(null, { boom: true }));
  await p.refresh();
  assert.deepEqual(p.current(), BUILD);
  assert.match(p.status().error, /network down/);
});

test('a failure AFTER a good read keeps the good read, not the build value', async () => {
  // THE CASE THIS MODULE EXISTS FOR. The operator set 24; the database then went away. The
  // floor in force must still be 24 — reverting to the build's 25 would start refusing commands
  // the operator had permitted, with no indication why.
  let rows = [{ policy: { acu_min_setpoint_c: 24 } }];
  let boom = false;
  let t = 1000;
  const impl = async () => {
    if (boom) throw new Error('down');
    return { ok: true, status: 200, json: async () => rows };
  };
  const p = createLivePolicy({ buildPolicy: BUILD, siteId: 's1', supabaseUrl: 'u', supabaseKey: 'k', fetchImpl: impl, now: () => t });
  await p.refresh();
  assert.equal(p.current().acu_min_setpoint_c, 24);
  boom = true;
  t += POLICY_TTL_MS + 1;
  await p.refresh();
  assert.equal(p.current().acu_min_setpoint_c, 24);
});

test('a corrupt policy column is treated as a failed read, not as an empty policy', async () => {
  const p = make(fakeFetch([{ policy: 'local-first' }]));
  await p.refresh();
  assert.deepEqual(p.current(), BUILD);
  assert.match(p.status().error, /not an object/);
});

test('a missing row is a failure, not a reason to drop the floor', async () => {
  const p = make(fakeFetch([]));
  await p.refresh();
  assert.deepEqual(p.current(), BUILD);
  assert.match(p.status().error, /no sites row/);
});

test('inside the TTL it does not read again', async () => {
  const f = fakeFetch([{ policy: { acu_min_setpoint_c: 24 } }]);
  const p = make(f, () => 1000);
  await p.refresh();
  await p.refresh();
  assert.equal(f.calls.length, 1);
});

test('a FAILED read does not buy another TTL of not trying', async () => {
  // Stamping the clock on failure would mean one blip locked the process out of the live value
  // for a full minute, and a chain of blips forever.
  let boom = true;
  let calls = 0;
  const impl = async () => {
    calls++;
    if (boom) throw new Error('down');
    return { ok: true, status: 200, json: async () => [{ policy: { acu_min_setpoint_c: 24 } }] };
  };
  const p = createLivePolicy({ buildPolicy: BUILD, siteId: 's1', supabaseUrl: 'u', supabaseKey: 'k', fetchImpl: impl, now: () => 1000 });
  await p.refresh();
  boom = false;
  await p.refresh();
  assert.equal(calls, 2);
  assert.equal(p.current().acu_min_setpoint_c, 24);
});

test('concurrent refreshes share one request', async () => {
  const f = fakeFetch([{ policy: { acu_min_setpoint_c: 24 } }]);
  const p = make(f);
  await Promise.all([p.refresh(), p.refresh(), p.refresh()]);
  assert.equal(f.calls.length, 1);
});

test('with no credentials it never calls out and stays on the build policy', async () => {
  const f = fakeFetch([{ policy: { acu_min_setpoint_c: 24 } }]);
  const p = createLivePolicy({ buildPolicy: BUILD, siteId: 's1', supabaseUrl: null, supabaseKey: null, fetchImpl: f });
  await p.refresh();
  assert.equal(f.calls.length, 0);
  assert.deepEqual(p.current(), BUILD);
});

test('asks for exactly one site, by id', async () => {
  const f = fakeFetch([{ policy: {} }]);
  const p = make(f);
  await p.refresh();
  assert.match(f.calls[0], /sites\?select=policy&id=eq\.s1$/);
});

// ---------------------------------------------------------------------------------------------
// RM-158: the proxy read this with the anon key, which phase39 stopped granting `sites` — so every
// read was a 401 and a "permission denied" error line in the database's log, retried on every
// command and every page load, and the policy in force was the build's all along.
// ---------------------------------------------------------------------------------------------

function recordingFetch(rows, status = 200) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, headers: init?.headers ?? {} });
    return { ok: status >= 200 && status < 300, status, json: async () => rows };
  };
  impl.calls = calls;
  return impl;
}

test('RM-158: reads with the caller\'s own session when one is given', async () => {
  const f = recordingFetch([{ policy: { acu_min_setpoint_c: 24 } }]);
  const p = make(f);
  await p.refresh(false, { token: 'user-jwt' });
  assert.equal(f.calls[0].headers.Authorization, 'Bearer user-jwt');
  assert.equal(f.calls[0].headers.apikey, 'k', 'the project key still identifies the project');
  assert.equal(p.status().source, 'database');
});

test('RM-158: an ANSWERED failure waits a minute before asking again; a network blip does not', async () => {
  // A refusal reaches the database's logs every time it is asked. An outage reaches nobody.
  let t = 1000;
  const f = recordingFetch(null, 401);
  const p = createLivePolicy({ buildPolicy: BUILD, siteId: 's1', supabaseUrl: 'u', supabaseKey: 'k', fetchImpl: f, now: () => t });
  await p.refresh();
  await p.refresh();
  t += 30_000;
  await p.refresh();
  assert.equal(f.calls.length, 1, 'refused once, then left alone inside the minute');
  t += POLICY_TTL_MS;
  await p.refresh();
  assert.equal(f.calls.length, 2, 'and asked again after it');
  assert.deepEqual(p.current(), BUILD);
});
