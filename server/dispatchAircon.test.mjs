/**
 * How an aircon command reaches the unit — 2026-09-17.
 *
 * The aircon has two paths, and neither can confirm anything: the IR hub's local code library
 * (OFF and 16..30 °C, in one mode/fan/swing), and the vendor cloud's DP route on the virtual "Air"
 * remote, which can express every state. The rules under test:
 *
 *   - Both paths are handed the SAME full state, resolved once from the command and the last
 *     commanded state — so a setpoint step keeps the operator's mode.
 *   - Local first, the site's standing posture. The cloud carries a state the library has no code
 *     for (422 no_local_code) and recovers a hub whose session is down (409 / offline).
 *   - EXCEPT while the local library is unverified on this unit: then an ON state goes cloud first,
 *     because a wrong IR code does not fail — it succeeds at doing the wrong thing. OFF stays local.
 *   - `local-only` means no vendor in the path, whatever else is true.
 *   - Whatever the cloud carried is recorded back into the flow (`record_only`), so the app shows
 *     the state that was actually commanded.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dispatchCommand, routeFor } from './dispatchLight.mjs';
import { DEVICE_REGISTRY } from '../shared/registry.mjs';

const ACU = DEVICE_REGISTRY.find((d) => d.id === 'acu_main');

const resp = (status, body = {}) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });

/** Replaces fetch for one test. `responder(url, body)` returns a response; every call is recorded. */
async function withBridge(responder, fn) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url: String(url), body });
    return responder(String(url), body);
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

function cloud({ fail = null, remote = { ok: true, id: 'air-remote' } } = {}) {
  const calls = [];
  return {
    calls,
    opts: {
      client: {
        call: async (method, path, o) => {
          calls.push({ method, path, body: o?.body });
          if (fail) throw new Error(fail);
        },
      },
      tuyaDeviceIdFor: () => undefined,
      acRemoteId: async () => remote,
    },
  };
}

const base = (extra = {}) => ({ bridgeHost: '127.0.0.1', bridgePort: 1, lightApiToken: 't', policy: 'local-first', ...extra });
const acuCalls = (calls) => calls.filter((c) => c.url.endsWith('/acu'));

test('the local route carries one full state, not a bare IR key', () => {
  const r = routeFor(ACU, { action: 'on', target_c: 24, ac_state: { power: 'on', mode: 'cool', setpoint_c: 24, fan: 'auto', swing: false } });
  assert.deepEqual(r, { path: '/acu', body: { state: { power: 'on', mode: 'cool', setpoint_c: 24, fan: 'auto', swing: false } } });
});

test('verified library, a state it holds: sent over the LAN and the cloud is never touched', async () => {
  const c = cloud();
  await withBridge(() => resp(200, { ok: true, sent: 'local' }), async (calls) => {
    const r = await dispatchCommand(ACU, { action: 'on', target_c: 24 }, base({ cloud: c.opts, localIrVerified: true }));
    assert.equal(r.ok, true);
    assert.equal(r.via, 'local');
    assert.deepEqual(r.ac_state, { power: 'on', mode: 'cool', setpoint_c: 24, fan: 'auto', swing: false });
    assert.equal(c.calls.length, 0);
    assert.equal(acuCalls(calls).length, 1, 'no record_only post for a local send — the flow recorded it itself');
  });
});

test('a setpoint step keeps the mode, fan and swing last commanded', async () => {
  const c = cloud();
  const readLatest = async () => ({ online: true, setpoint_c: 25, ac_mode: 'dry', ac_fan: 'high', ac_swing: true });
  await withBridge(() => resp(422, { ok: false, error: 'no_local_code' }), async () => {
    const r = await dispatchCommand(ACU, { action: 'on', target_c: 24 }, base({ cloud: c.opts, localIrVerified: true, readLatest }));
    assert.deepEqual(r.ac_state, { power: 'on', mode: 'dry', setpoint_c: 24, fan: 'high', swing: true });
  });
});

test('a state the library has no code for goes through the cloud as DP properties on the Air remote', async () => {
  const c = cloud();
  await withBridge(() => resp(422, { ok: false, error: 'no_local_code' }), async (calls) => {
    const r = await dispatchCommand(ACU, { action: 'on', target_c: 22, mode: 'dry', fan: 'high', swing: true }, base({ cloud: c.opts, localIrVerified: true }));
    assert.equal(r.ok, true);
    assert.equal(r.via, 'cloud');
    assert.match(r.detail, /no local IR code/);
    assert.equal(c.calls.length, 1);
    assert.equal(c.calls[0].method, 'POST');
    assert.equal(c.calls[0].path, '/v2.0/cloud/thing/air-remote/shadow/properties/issue');
    assert.deepEqual(JSON.parse(c.calls[0].body.properties), { switch_power: true, mode: '4', temperature: 22, fan: '3', swing: true });
    // And what the cloud carried is recorded back into the flow, so the app shows it.
    const record = acuCalls(calls).at(-1);
    assert.deepEqual(record.body, { state: { power: 'on', mode: 'dry', setpoint_c: 22, fan: 'high', swing: true }, record_only: true });
  });
});

test('a hub the flow reports offline (409) falls back to the cloud', async () => {
  const c = cloud();
  await withBridge((url, body) => (body?.record_only ? resp(200) : resp(409, { ok: false, error: 'device_offline' })), async () => {
    const r = await dispatchCommand(ACU, { action: 'off' }, base({ cloud: c.opts, localIrVerified: true }));
    assert.equal(r.ok, true);
    assert.equal(r.via, 'cloud');
    assert.deepEqual(JSON.parse(c.calls[0].body.properties), { switch_power: false });
  });
});

test('while the library is unverified, an ON state goes cloud first and the LAN is not tried', async () => {
  const c = cloud();
  await withBridge(() => resp(200), async (calls) => {
    const r = await dispatchCommand(ACU, { action: 'on', target_c: 24 }, base({ cloud: c.opts, localIrVerified: false }));
    assert.equal(r.ok, true);
    assert.equal(r.via, 'cloud');
    assert.match(r.detail, /not yet verified/);
    assert.equal(c.calls.length, 1);
    assert.deepEqual(acuCalls(calls).map((x) => x.body.record_only), [true], 'the only /acu call is the record');
  });
});

test('while unverified, OFF still goes over the LAN first', async () => {
  const c = cloud();
  await withBridge(() => resp(200, { ok: true }), async () => {
    const r = await dispatchCommand(ACU, { action: 'off' }, base({ cloud: c.opts, localIrVerified: false }));
    assert.equal(r.via, 'local');
    assert.equal(c.calls.length, 0);
  });
});

test('unverified and the cloud fails: the LAN is still tried, and both reasons are kept', async () => {
  const c = cloud({ fail: 'code 1106: permission deny' });
  await withBridge(() => resp(200, { ok: true }), async () => {
    const r = await dispatchCommand(ACU, { action: 'on', target_c: 24 }, base({ cloud: c.opts, localIrVerified: false }));
    assert.equal(r.ok, true);
    assert.equal(r.via, 'local');
    assert.match(r.detail, /permission deny/);
  });
});

test('an unresolved Air remote is a cloud failure with its reason, not a guess', async () => {
  const c = cloud({ remote: { ok: false, reason: '2 aircon remotes in the cloud project' } });
  await withBridge(() => resp(422, { ok: false, error: 'no_local_code' }), async () => {
    const r = await dispatchCommand(ACU, { action: 'on', mode: 'heat' }, base({ cloud: c.opts, localIrVerified: true }));
    assert.equal(r.ok, false);
    assert.equal(r.via, 'none');
    assert.equal(r.reason, 'no_local_code');
    assert.match(r.detail, /2 aircon remotes/);
    assert.equal(c.calls.length, 0, 'nothing was posted to a remote nobody could identify');
  });
});

test('local-only never reaches the vendor, even for a state only the cloud could send', async () => {
  const c = cloud();
  await withBridge(() => resp(422, { ok: false, error: 'no_local_code' }), async () => {
    const r = await dispatchCommand(ACU, { action: 'on', mode: 'dry' }, base({ cloud: c.opts, localIrVerified: false, policy: 'local-only' }));
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'no_local_code');
    assert.match(r.detail, /local-only/);
    assert.equal(c.calls.length, 0);
  });
});

test('with no cloud configured, the local failure is reported as it is', async () => {
  await withBridge(() => resp(409, { ok: false, error: 'device_offline' }), async () => {
    const r = await dispatchCommand(ACU, { action: 'off' }, base());
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'device_offline');
  });
});

test('a failed record-back does not turn a cloud success into a failure', async () => {
  const c = cloud();
  await withBridge((url, body) => (body?.record_only ? resp(500) : resp(422, { error: 'no_local_code' })), async () => {
    const r = await dispatchCommand(ACU, { action: 'on', mode: 'fan' }, base({ cloud: c.opts, localIrVerified: true }));
    assert.equal(r.ok, true);
    assert.equal(r.via, 'cloud');
  });
});

test('never throws, whatever the bridge and the cloud do', async () => {
  const c = cloud({ fail: 'boom' });
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
  try {
    await assert.doesNotReject(() => dispatchCommand(ACU, { action: 'on', mode: 'dry' }, base({ cloud: c.opts, localIrVerified: false })));
  } finally {
    globalThis.fetch = original;
  }
});

// --- generated frames (2026-09-22) ---------------------------------------------------------------

test('a state the flow sent as a generated frame says so in the detail, for the audit row', async () => {
  // With SITE.aircon.ir_protocol the flow builds a dry/high/swing frame itself and answers 200 with
  // `source: generated`. Until the unit is verified, that fact belongs next to the command it moved.
  await withBridge(() => resp(200, { ok: true, sent: 'local', key: null, source: 'generated' }), async () => {
    const r = await dispatchCommand(ACU, { action: 'on', target_c: 26, mode: 'dry', fan: 'high', swing: true }, base({ localIrVerified: true }));
    assert.equal(r.ok, true);
    assert.equal(r.via, 'local');
    assert.match(r.detail, /generated/);
  });
});

test('a captured frame carries no generated note, and an unparseable 200 is still a success', async () => {
  await withBridge(() => resp(200, { ok: true, sent: 'local', key: '24', source: 'captured' }), async () => {
    const r = await dispatchCommand(ACU, { action: 'on', target_c: 24 }, base({ localIrVerified: true }));
    assert.equal(r.detail, undefined);
  });
  await withBridge(() => ({ ok: true, status: 200, text: async () => 'not json' }), async () => {
    const r = await dispatchCommand(ACU, { action: 'on', target_c: 24 }, base({ localIrVerified: true }));
    assert.equal(r.ok, true);
  });
});
