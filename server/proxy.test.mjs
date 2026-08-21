/**
 * Transport-level tests for server/proxy.mjs — spawns a real mock-bridge process (as the
 * "Node-RED bridge" being proxied to) plus a tiny in-process fake Supabase-auth server,
 * then spawns the proxy itself pointed at both. Exercises the actual HTTP surface, not
 * just the pure logic in breakGlass.mjs.
 *
 *     npm run test:server
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { hashBreakGlassPassword } from './breakGlass.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MOCK_BRIDGE = join(ROOT, 'mock-bridge', 'server.mjs');
const PROXY = join(ROOT, 'server', 'proxy.mjs');

let nextPort = 19100; // distinct range from every other test file's port allocation

const VALID_TOKEN = 'valid-supabase-token';
const BREAK_GLASS_PASSWORD = 'test-break-glass-password';
const BREAK_GLASS_HASH = hashBreakGlassPassword(BREAK_GLASS_PASSWORD);

/**
 * A minimal stand-in for Supabase — `/auth/v1/user` (accepts exactly VALID_TOKEN) plus
 * `POST /rest/v1/commands`, the audit-log insert `handleCommand` writes to. Every inserted
 * row is recorded on `.insertedCommands` so tests can assert on what was actually logged,
 * not just the HTTP response. `rejectCommandInserts` flips the REST endpoint to always
 * 500, for testing the "audit log unreachable" path.
 *
 * The recorded row is MUTATED by the daemon's follow-up PATCH: auditedDispatch writes the
 * row before dispatching (status 'dispatching') and attaches the outcome afterwards, so the
 * fake has to apply the patch for `.insertedCommands[0].status` to read the row's final
 * state. That makes these assertions stronger than they were — they now prove the whole
 * record -> dispatch -> record-outcome sequence, not just the opening insert.
 */
function startFakeSupabaseAuth() {
  return new Promise((resolve) => {
    const port = nextPort++;
    const state = { insertedCommands: [], rejectCommandInserts: false, blockCommandUpdates: false };
    const server = http.createServer(async (req, res) => {
      if (req.method === 'GET' && req.url === '/auth/v1/user') {
        const auth = req.headers['authorization'];
        if (auth === `Bearer ${VALID_TOKEN}`) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: 'user-1', email: 'test@example.com' }));
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid token' }));
        }
        return;
      }
      if (req.method === 'POST' && req.url === '/rest/v1/commands') {
        if (state.rejectCommandInserts) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'simulated outage' }));
        }
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const row = { id: `cmd-${state.insertedCommands.length + 1}`, ...JSON.parse(raw) };
        state.insertedCommands.push(row);
        // handleCommand asks for `Prefer: return=representation` so it gets an id back to
        // PATCH the outcome onto; returning nothing would leave the row stuck at
        // 'dispatching' with no way to complete it.
        res.writeHead(201, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify([row]));
      }
      if (req.method === 'PATCH' && req.url.startsWith('/rest/v1/commands')) {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        if (state.blockCommandUpdates) {
          // How PostgREST reports an RLS-blocked UPDATE: 200, no error, empty result.
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end('[]');
        }
        const id = decodeURIComponent((req.url.match(/id=eq\.([^&]+)/) ?? [])[1] ?? '');
        const row = state.insertedCommands.find((c) => c.id === id);
        if (row) Object.assign(row, JSON.parse(raw));
        // Answer the way real PostgREST does for `Prefer: return=representation` — the
        // updated rows, or an empty array when nothing matched. handleCommand reads that
        // count to tell a real update from an RLS-blocked one, so a fake that always
        // returned 204 would let a silently-failing update pass as healthy.
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(row ? [row] : []));
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(port, () => resolve({ server, port, url: `http://localhost:${port}`, state }));
  });
}

/**
 * Stand-in for the live Node-RED flow's `POST /light/:id` (Phase 7) — `.requests` records
 * everything received so tests can assert on the real outbound call (method, path, headers,
 * body), not just the proxy's own response. `failNext`/`statusCode` inject a downstream
 * failure to exercise the "audit row says failed, not dispatched" path.
 */
function startFakeLightEndpoint() {
  return new Promise((resolve) => {
    const port = nextPort++;
    const state = { requests: [], failNext: false, statusCode: null };
    const server = http.createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      state.requests.push({
        method: req.method,
        url: req.url,
        headers: { 'x-auth-token': req.headers['x-auth-token'] },
        body: raw ? JSON.parse(raw) : null,
      });
      if (state.failNext) {
        res.writeHead(state.statusCode || 500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'injected failure' }));
      }
      // Mirrors the real flow's actual response shape (verified live): statusCode is
      // unset on the success path, so Node-RED defaults to 200, and the body is the full
      // lights-state object, not any {ok:true}-style envelope. dispatchLightCommand keys
      // success purely on res.ok, never on this body, so the exact shape here is
      // deliberately NOT the real one — proving the implementation doesn't secretly depend on it.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ L1: true, L2: false }));
    });
    server.listen(port, () => resolve({ server, port, url: `http://localhost:${port}`, state }));
  });
}

function spawnChild(script, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const onData = (chunk) => {
      out += chunk.toString();
      if (out.includes('listening') || out.includes('mock bridge')) {
        child.stdout.off('data', onData);
        resolve(child);
      }
    };
    child.stdout.on('data', onData);
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== null && code !== 0) reject(new Error(`${script} exited early (code ${code}): ${out}`));
    });
  });
}

/** Spins up: fake Supabase auth + a real mock-bridge + the proxy pointed at both.
 * `proxyEnv` merges in extra env for the proxy child — used to toggle
 * `HARDWARE_DISPATCH_ENABLED` per test. */
async function setup(proxyEnv = {}) {
  const fakeAuth = await startFakeSupabaseAuth();
  const bridgePort = nextPort++;
  // mock-bridge takes its port via CLI flag, not env.
  const bridgeChild = spawn(process.execPath, [MOCK_BRIDGE, `--port=${bridgePort}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    let out = '';
    const onData = (chunk) => {
      out += chunk.toString();
      if (out.includes('iBEMS mock bridge')) {
        bridgeChild.stdout.off('data', onData);
        resolve();
      }
    };
    bridgeChild.stdout.on('data', onData);
    bridgeChild.on('error', reject);
  });

  const proxyPort = nextPort++;
  const proxyChild = await spawnChild(PROXY, {
    PROXY_PORT: String(proxyPort),
    BRIDGE_HOST: '127.0.0.1',
    BRIDGE_PORT: String(bridgePort),
    SUPABASE_URL: fakeAuth.url,
    VITE_SUPABASE_ANON_KEY: 'dummy-anon-key',
    BREAK_GLASS_PASSWORD_HASH: BREAK_GLASS_HASH,
    ...proxyEnv,
  });

  return {
    proxyUrl: `http://localhost:${proxyPort}`,
    supabaseState: fakeAuth.state,
    cleanup: () => {
      fakeAuth.server.close();
      bridgeChild.kill();
      proxyChild.kill();
    },
  };
}

/**
 * Spins up: fake Supabase auth + a fake light endpoint (standing in for the real Node-RED
 * flow's POST /light/:id) + the proxy pointed at the light endpoint as its "bridge". No real
 * mock-bridge is spawned — dispatch tests only ever hit POST /api/command, never a bridge
 * GET route, so pointing BRIDGE_HOST/BRIDGE_PORT at the fake light endpoint directly is
 * sufficient and avoids a third child process per test.
 */
async function setupDispatch(proxyEnv = {}) {
  const fakeAuth = await startFakeSupabaseAuth();
  const fakeLight = await startFakeLightEndpoint();
  const proxyPort = nextPort++;
  const proxyChild = await spawnChild(PROXY, {
    PROXY_PORT: String(proxyPort),
    BRIDGE_HOST: '127.0.0.1',
    BRIDGE_PORT: String(fakeLight.port),
    SUPABASE_URL: fakeAuth.url,
    VITE_SUPABASE_ANON_KEY: 'dummy-anon-key',
    BREAK_GLASS_PASSWORD_HASH: BREAK_GLASS_HASH,
    HARDWARE_DISPATCH_ENABLED: 'true',
    LIGHT_API_TOKEN: 'test-light-token',
    ...proxyEnv,
  });
  return {
    proxyUrl: `http://localhost:${proxyPort}`,
    supabaseState: fakeAuth.state,
    lightState: fakeLight.state,
    cleanup: () => {
      fakeAuth.server.close();
      fakeLight.server.close();
      proxyChild.kill();
    },
  };
}

test('a request with no token is rejected with 401, never reaches the bridge', async () => {
  const { proxyUrl, cleanup } = await setup();
  try {
    const res = await fetch(`${proxyUrl}/api/devices`);
    assert.equal(res.status, 401);
  } finally {
    cleanup();
  }
});

test('a request with an invalid token is rejected with 401', async () => {
  const { proxyUrl, cleanup } = await setup();
  try {
    const res = await fetch(`${proxyUrl}/api/devices`, { headers: { Authorization: 'Bearer garbage' } });
    assert.equal(res.status, 401);
  } finally {
    cleanup();
  }
});

test('a request with a valid Supabase token is forwarded to the bridge and the real response comes back', async () => {
  const { proxyUrl, cleanup } = await setup();
  try {
    const res = await fetch(`${proxyUrl}/api/devices`, { headers: { Authorization: `Bearer ${VALID_TOKEN}` } });
    assert.equal(res.status, 200);
    const devices = await res.json();
    assert.ok(Array.isArray(devices));
    assert.ok(devices.length > 0);
    assert.ok(devices[0].id);
  } finally {
    cleanup();
  }
});

test('local-login with the correct break-glass password issues a token that then authorizes requests', async () => {
  const { proxyUrl, cleanup } = await setup();
  try {
    const loginRes = await fetch(`${proxyUrl}/api/local-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: BREAK_GLASS_PASSWORD }),
    });
    assert.equal(loginRes.status, 200);
    const { token, mode } = await loginRes.json();
    assert.equal(mode, 'local');
    assert.ok(token);

    const dataRes = await fetch(`${proxyUrl}/api/devices?token=${token}`);
    assert.equal(dataRes.status, 200);
  } finally {
    cleanup();
  }
});

test('local-login with the wrong password is rejected with 401', async () => {
  const { proxyUrl, cleanup } = await setup();
  try {
    const res = await fetch(`${proxyUrl}/api/local-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'not-the-password' }),
    });
    assert.equal(res.status, 401);
  } finally {
    cleanup();
  }
});

test('the proxy-only token query param is stripped before forwarding — the bridge never sees it', async () => {
  const { proxyUrl, cleanup } = await setup();
  try {
    const res = await fetch(`${proxyUrl}/api/readings/history?device_id=co3&range=24h&token=${VALID_TOKEN}`, {
      headers: { Authorization: `Bearer ${VALID_TOKEN}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    // The mock bridge honors device_id/range — if those survived stripping, this is well-formed.
    assert.equal(body.device_id, 'co3');
    assert.equal(body.range, '24h');
  } finally {
    cleanup();
  }
});

test('a forwarded response carries exactly one Access-Control-Allow-Origin header, not a duplicate', async () => {
  // The mock bridge sets its own `Access-Control-Allow-Origin: *` (mirroring Node-RED's
  // httpNodeCors), same as proxy.mjs does for every response it sends. Naively spreading
  // both header sets together produces the SAME header twice under different casing
  // (Node lowercases `proxyRes.headers` but not the proxy's own CORS_HEADERS object) — a
  // real browser's fetch() rejects a response with more than one Access-Control-Allow-Origin
  // value outright, per the Fetch spec, but neither `fetch()` in Node (undici) nor curl
  // enforce that at all, so this regressed silently through every prior check in this file.
  // http.get + res.rawHeaders is used here (not fetch) specifically because it's the only
  // way from Node to see duplicate header instances on the wire the way a browser would.
  const { proxyUrl, cleanup } = await setup();
  try {
    await new Promise((resolve, reject) => {
      http.get(`${proxyUrl}/api/devices`, { headers: { Authorization: `Bearer ${VALID_TOKEN}` } }, (res) => {
        const allowOriginCount = res.rawHeaders.filter((h, i) => i % 2 === 0 && h.toLowerCase() === 'access-control-allow-origin').length;
        res.resume();
        try {
          assert.equal(allowOriginCount, 1, `expected exactly one Access-Control-Allow-Origin header, got ${allowOriginCount}`);
          resolve();
        } catch (err) {
          reject(err);
        }
      }).on('error', reject);
    });
  } finally {
    cleanup();
  }
});

test('CORS preflight is answered without requiring auth', async () => {
  const { proxyUrl, cleanup } = await setup();
  try {
    const res = await fetch(`${proxyUrl}/api/devices`, { method: 'OPTIONS' });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Phase 6 — POST /api/command and GET /api/capabilities
// ---------------------------------------------------------------------------

test('GET /api/capabilities reflects HARDWARE_DISPATCH_ENABLED — false by default', async () => {
  const { proxyUrl, cleanup } = await setup();
  try {
    const res = await fetch(`${proxyUrl}/api/capabilities`, { headers: { Authorization: `Bearer ${VALID_TOKEN}` } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { hardware_dispatch_enabled: false, dispatch_classes: [] });
  } finally {
    cleanup();
  }
});

test('GET /api/capabilities reports true once the gate is explicitly opened', async () => {
  const { proxyUrl, cleanup } = await setup({ HARDWARE_DISPATCH_ENABLED: 'true', LIGHT_API_TOKEN: 'test-light-token' });
  try {
    const res = await fetch(`${proxyUrl}/api/capabilities`, { headers: { Authorization: `Bearer ${VALID_TOKEN}` } });
    assert.deepEqual(await res.json(), { hardware_dispatch_enabled: true, dispatch_classes: ['switch', 'outlet_dual', 'acu_ir'] });
  } finally {
    cleanup();
  }
});

// The list must match what handleCommand will really do, not merely look plausible. It began
// as lights-only; outlets and the aircon joined once the flow gained their endpoints, and this
// is what stops the advertisement drifting from the behaviour again.
test('the classes /api/capabilities advertises are exactly the ones that actually dispatch', async () => {
  const { proxyUrl, lightState, cleanup } = await setupDispatch();
  try {
    const res = await fetch(`${proxyUrl}/api/capabilities`, { headers: { Authorization: `Bearer ${VALID_TOKEN}` } });
    const { dispatch_classes } = await res.json();
    assert.deepEqual(dispatch_classes, ['switch', 'outlet_dual', 'acu_ir']);

    // A class it advertises really does reach the hardware endpoint...
    const lightRes = await fetch(`${proxyUrl}/api/command`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${VALID_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: 'l1', action: 'on' }),
    });
    assert.equal(lightRes.status, 202);
    assert.equal(lightState.requests.length, 1);

    // ...and one it does NOT advertise really does not.
    const outletRes = await fetch(`${proxyUrl}/api/command`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${VALID_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: 'co1', socket: 1, action: 'on' }),
    });
    assert.equal(outletRes.status, 202);
    assert.equal(lightState.requests.length, 2, 'an advertised class must reach the bridge too');
    assert.equal(lightState.requests[1].url, '/outlet/CO1_1', 'outlets route by wire target, not by numeric id');
  } finally {
    cleanup();
  }
});

test('a command with the gate closed is accepted, dry_run, and audit-logged with the real user id', async () => {
  const { proxyUrl, supabaseState, cleanup } = await setup();
  try {
    const res = await fetch(`${proxyUrl}/api/command`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${VALID_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: 'l1', action: 'on', command_id: 'cmd-1' }),
    });
    assert.equal(res.status, 202);
    const ack = await res.json();
    assert.equal(ack.confirmed, false);
    assert.equal(ack.target, 'L1');

    assert.equal(supabaseState.insertedCommands.length, 1);
    const row = supabaseState.insertedCommands[0];
    assert.equal(row.status, 'dry_run');
    assert.equal(row.device_id, 'l1');
    assert.equal(row.action, 'on');
    assert.equal(row.requested_by, 'user-1'); // the fake auth server's id for VALID_TOKEN
    assert.equal(row.source, 'ibems-app');
  } finally {
    cleanup();
  }
});

test('the gate alone never claims success — a dispatch that fails is recorded as failed, not dispatched', async () => {
  // This used to be proven with an outlet, on the grounds that outlets had no dispatch path at
  // all. They do now, so the same guarantee is shown the only way still available: a real
  // attempt against a bridge with nothing listening must not be reported as success.
  const { proxyUrl, supabaseState, cleanup } = await setup({ HARDWARE_DISPATCH_ENABLED: 'true', LIGHT_API_TOKEN: 'test-light-token' });
  try {
    const res = await fetch(`${proxyUrl}/api/command`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${VALID_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: 'co1', socket: 1, action: 'off' }),
    });
    assert.equal(res.status, 502, 'the caller must not be told it worked');
    assert.equal(supabaseState.insertedCommands[0].status, 'failed');
  } finally {
    cleanup();
  }
});

test('an invalid command is rejected with the same validation error shared/commands.mjs produces, and nothing is audit-logged', async () => {
  const { proxyUrl, supabaseState, cleanup } = await setup();
  try {
    const res = await fetch(`${proxyUrl}/api/command`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${VALID_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: 'l1', action: 'toggle' }), // not "on"/"off"
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, 'invalid_action');
    assert.equal(supabaseState.insertedCommands.length, 0);
  } finally {
    cleanup();
  }
});

test('a break-glass session cannot send a command — it has no real user id to attribute the audit row to', async () => {
  const { proxyUrl, supabaseState, cleanup } = await setup();
  try {
    const loginRes = await fetch(`${proxyUrl}/api/local-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: BREAK_GLASS_PASSWORD }),
    });
    const { token } = await loginRes.json();

    const res = await fetch(`${proxyUrl}/api/command`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: 'l1', action: 'on' }),
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, 'break_glass_cannot_command');
    assert.equal(supabaseState.insertedCommands.length, 0);
  } finally {
    cleanup();
  }
});

test('a command with no token at all is rejected with 401, same as every other route', async () => {
  const { proxyUrl, cleanup } = await setup();
  try {
    const res = await fetch(`${proxyUrl}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: 'l1', action: 'on' }),
    });
    assert.equal(res.status, 401);
  } finally {
    cleanup();
  }
});

test('a command is refused, not silently un-logged, when the audit insert itself fails', async () => {
  const { proxyUrl, supabaseState, cleanup } = await setup();
  try {
    supabaseState.rejectCommandInserts = true;
    const res = await fetch(`${proxyUrl}/api/command`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${VALID_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: 'l1', action: 'on' }),
    });
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.error, 'audit_log_unreachable');
  } finally {
    cleanup();
  }
});

test('with the gate OPEN, a failed audit insert stops the command reaching hardware at all', async () => {
  // Strengthens the test above. handleCommand used to dispatch FIRST and record after, so a
  // failed insert could only be detected once the relay had already moved — the 502 was a
  // report of an incomplete trail, not a prevention of one. auditedDispatch writes the row
  // first, so "hardware moved with no audit row" is now unrepresentable. This is also the
  // asymmetry scheduler.mjs was on the wrong side of; both go through the same helper now.
  const { proxyUrl, supabaseState, lightState, cleanup } = await setupDispatch();
  try {
    supabaseState.rejectCommandInserts = true;
    const res = await fetch(`${proxyUrl}/api/command`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${VALID_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: 'l1', action: 'on' }),
    });
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error, 'audit_log_unreachable');
    assert.equal(lightState.requests.length, 0, 'no audit row means nothing may reach the light');
  } finally {
    cleanup();
  }
});

test('an outcome update that silently affects no rows leaves the row honestly at "dispatching"', async () => {
  // This is how RLS refuses an UPDATE through PostgREST: 200, no error, empty result — the
  // same shape that let a schedule save report "saved" while writing nothing (2e4c0c2).
  // `commands` grants authenticated select and insert but no update, so without
  // supabase/phase9_command_outcome.sql applied every proxy-issued command would be
  // stranded here. It must be visible when that happens, not assumed away.
  const { proxyUrl, supabaseState, lightState, cleanup } = await setupDispatch();
  try {
    supabaseState.blockCommandUpdates = true;
    const res = await fetch(`${proxyUrl}/api/command`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${VALID_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: 'l1', action: 'on' }),
    });

    // The dispatch itself succeeded, so the caller is told so — the command really did reach
    // the light.
    assert.equal(res.status, 202);
    assert.equal(lightState.requests.length, 1);
    // But the row keeps the only status we actually earned. 'dispatched' would be a claim
    // the database never confirmed, and 'failed' would be a claim about hardware that is
    // flatly untrue.
    assert.equal(supabaseState.insertedCommands[0].status, 'dispatching');
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Phase 7 — real dispatch for lights (switch-class), via the live flow's POST /light/:id
// ---------------------------------------------------------------------------

test('dispatch open + switch command: a real POST is made to /light/:id with correct headers/body, audit row says dispatched', async () => {
  const { proxyUrl, supabaseState, lightState, cleanup } = await setupDispatch();
  try {
    const res = await fetch(`${proxyUrl}/api/command`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${VALID_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: 'l3', action: 'on' }),
    });
    assert.equal(res.status, 202);
    assert.equal(lightState.requests.length, 1);
    assert.equal(lightState.requests[0].method, 'POST');
    assert.equal(lightState.requests[0].url, '/light/3');
    assert.equal(lightState.requests[0].headers['x-auth-token'], 'test-light-token');
    assert.deepEqual(lightState.requests[0].body, { state: true });
    assert.equal(supabaseState.insertedCommands[0].status, 'dispatched');
  } finally {
    cleanup();
  }
});

test('dispatch open + switch + downstream failure: 502 hardware_dispatch_failed, audit row says failed not dispatched', async () => {
  const { proxyUrl, supabaseState, lightState, cleanup } = await setupDispatch();
  try {
    lightState.failNext = true;
    lightState.statusCode = 401; // simulates a token mismatch — the most realistic real failure
    const res = await fetch(`${proxyUrl}/api/command`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${VALID_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: 'l3', action: 'off' }),
    });
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.error, 'hardware_dispatch_failed');
    assert.equal(supabaseState.insertedCommands.length, 1);
    assert.equal(supabaseState.insertedCommands[0].status, 'failed');
  } finally {
    cleanup();
  }
});

test('dispatch open + outlet command: routed to /outlet/<target> and audited as dispatched', async () => {
  const { proxyUrl, supabaseState, lightState, cleanup } = await setupDispatch();
  try {
    const res = await fetch(`${proxyUrl}/api/command`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${VALID_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: 'co3', socket: 2, action: 'on' }),
    });
    assert.equal(res.status, 202);
    assert.equal(lightState.requests.length, 1);
    assert.equal(lightState.requests[0].url, '/outlet/CO3_2');
    assert.deepEqual(lightState.requests[0].body, { state: true });
    assert.equal(supabaseState.insertedCommands[0].status, 'dispatched');
  } finally {
    cleanup();
  }
});

test('dispatch open + ACU command: routed to /acu as an IR code, not a relay state', async () => {
  const { proxyUrl, supabaseState, lightState, cleanup } = await setupDispatch();
  try {
    const res = await fetch(`${proxyUrl}/api/command`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${VALID_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: 'acu_main', action: 'on', target_c: 22 }),
    });
    assert.equal(res.status, 202);
    assert.equal(lightState.requests[0].url, '/acu');
    assert.deepEqual(lightState.requests[0].body, { mode: '22' }, 'the setpoint becomes the IR library key');
    assert.equal(supabaseState.insertedCommands[0].status, 'dispatched');
  } finally {
    cleanup();
  }
});

test('an ACU command with no setpoint falls back to 25, exactly what the retired dashboard switch sent', async () => {
  const { proxyUrl, lightState, cleanup } = await setupDispatch();
  try {
    await fetch(`${proxyUrl}/api/command`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${VALID_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: 'acu_main', action: 'on' }),
    });
    assert.deepEqual(lightState.requests[0].body, { mode: '25' });
  } finally {
    cleanup();
  }
});

test('an ACU off command sends the OFF code rather than a temperature', async () => {
  const { proxyUrl, lightState, cleanup } = await setupDispatch();
  try {
    await fetch(`${proxyUrl}/api/command`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${VALID_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: 'acu_main', action: 'off' }),
    });
    assert.deepEqual(lightState.requests[0].body, { mode: 'OFF' });
  } finally {
    cleanup();
  }
});

test('dispatch closed: a switch command never reaches the light endpoint', async () => {
  const { proxyUrl, lightState, cleanup } = await setupDispatch({ HARDWARE_DISPATCH_ENABLED: 'false' });
  try {
    const res = await fetch(`${proxyUrl}/api/command`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${VALID_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: 'l3', action: 'on' }),
    });
    assert.equal(res.status, 202);
    assert.equal(lightState.requests.length, 0);
  } finally {
    cleanup();
  }
});

test('the proxy refuses to start with HARDWARE_DISPATCH_ENABLED=true and no LIGHT_API_TOKEN', async () => {
  const fakeAuth = await startFakeSupabaseAuth();
  // Tracked separately from spawnChild's own promise: if the fail-fast check is ever
  // missing or broken, spawnChild RESOLVES with a live, listening child instead of
  // rejecting — assert.rejects then throws its own assertion error, but an untracked
  // child would be orphaned, keep its stdio pipes open, and hang the entire test file's
  // exit indefinitely (confirmed the hard way: this is exactly what happened before this
  // child-tracking was added). Capturing it here means a regression fails loudly and fast
  // instead of hanging the whole suite.
  let leakedChild = null;
  try {
    await assert.rejects(
      spawnChild(PROXY, {
        PROXY_PORT: String(nextPort++),
        SUPABASE_URL: fakeAuth.url,
        VITE_SUPABASE_ANON_KEY: 'dummy-anon-key',
        HARDWARE_DISPATCH_ENABLED: 'true',
        LIGHT_API_TOKEN: '',
      }).then((child) => {
        leakedChild = child;
        return child;
      }),
    );
  } finally {
    if (leakedChild) leakedChild.kill();
    fakeAuth.server.close();
  }
});

// ---------------------------------------------------------------------------
// Phase 9 — the two paths the suite never reached: a HUNG upstream, and the WS relay
// ---------------------------------------------------------------------------

/** A bridge that accepts the connection and then never answers. Distinct from a refused
 * connection, which raises 'error' immediately and was already covered. */
function startHangingBridge() {
  return new Promise((resolve) => {
    const port = nextPort++;
    const sockets = [];
    const server = http.createServer(() => { /* deliberately never responds */ });
    server.on('connection', (s) => sockets.push(s));
    server.listen(port, () => resolve({
      port,
      close: () => { sockets.forEach((s) => s.destroy()); server.close(); },
    }));
  });
}

test('a bridge that accepts and then hangs is given up on, rather than held open forever', async () => {
  // proxyHttp used raw http.request with no timeout: 'error' fires for a REFUSED connection
  // but never for one that is accepted and then stalls. Node-RED under a Tuya
  // discovery-retry storm is exactly the process that hangs rather than refuses, and every
  // such request used to hold a socket on both legs indefinitely.
  const fakeAuth = await startFakeSupabaseAuth();
  const bridge = await startHangingBridge();
  const proxyPort = nextPort++;
  const proxyChild = await spawnChild(PROXY, {
    PROXY_PORT: String(proxyPort),
    BRIDGE_HOST: '127.0.0.1',
    BRIDGE_PORT: String(bridge.port),
    BRIDGE_TIMEOUT_MS: '600',
    SUPABASE_URL: fakeAuth.url,
    VITE_SUPABASE_ANON_KEY: 'dummy-anon-key',
  });
  try {
    const started = Date.now();
    const res = await fetch(`http://localhost:${proxyPort}/api/devices`, {
      headers: { Authorization: `Bearer ${VALID_TOKEN}` },
    });
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error, 'bridge_unreachable');
    assert.ok(Date.now() - started < 5000, 'the request must not wait out the client timeout');
  } finally {
    fakeAuth.server.close();
    bridge.close();
    proxyChild.kill();
  }
});

test('a 502 does not leak the raw upstream error to the caller', async () => {
  // String(err) on a bridge or Supabase failure can carry project-identifying strings, and
  // the caller has no use for them. dispatchLight.mjs's 502 path already drew this line.
  const fakeAuth = await startFakeSupabaseAuth();
  const proxyPort = nextPort++;
  const proxyChild = await spawnChild(PROXY, {
    PROXY_PORT: String(proxyPort),
    BRIDGE_HOST: '127.0.0.1',
    BRIDGE_PORT: String(nextPort++), // nothing listening: connection refused
    SUPABASE_URL: fakeAuth.url,
    VITE_SUPABASE_ANON_KEY: 'dummy-anon-key',
  });
  try {
    const res = await fetch(`http://localhost:${proxyPort}/api/devices`, {
      headers: { Authorization: `Bearer ${VALID_TOKEN}` },
    });
    const body = await res.json();
    assert.equal(res.status, 502);
    assert.equal(body.error, 'bridge_unreachable');
    assert.equal(/ECONNREFUSED|127\.0\.0\.1|Error:/.test(body.detail ?? ''), false, `detail leaked: ${body.detail}`);
  } finally {
    fakeAuth.server.close();
    proxyChild.kill();
  }
});

/** Issues a raw HTTP Upgrade and resolves with either the upgrade or the plain response. */
function upgrade(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      port, host: '127.0.0.1', path, method: 'GET',
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version': '13',
      },
    });
    req.on('upgrade', (res, socket) => { socket.destroy(); resolve({ upgraded: true, status: res.statusCode }); });
    req.on('response', (res) => { res.resume(); resolve({ upgraded: false, status: res.statusCode }); });
    req.on('error', reject);
    req.end();
  });
}

test('the WebSocket relay refuses an upgrade carrying no token', async () => {
  // The relay is a raw net.connect TCP pipe, and no test had ever issued an Upgrade request
  // against it — the auth check, the header forwarding, and the failure path were all
  // unexercised, on the one route that carries live data continuously.
  const { proxyUrl, cleanup } = await setup();
  try {
    const port = Number(new URL(proxyUrl).port);
    const result = await upgrade(port, '/ws/live');
    assert.equal(result.upgraded, false, 'an unauthenticated upgrade must not be relayed');
    assert.equal(result.status, 401);
  } finally {
    cleanup();
  }
});

test('the WebSocket relay refuses an upgrade carrying a bad token', async () => {
  const { proxyUrl, cleanup } = await setup();
  try {
    const port = Number(new URL(proxyUrl).port);
    const result = await upgrade(port, '/ws/live?token=not-a-real-token');
    assert.equal(result.upgraded, false);
    assert.equal(result.status, 401);
  } finally {
    cleanup();
  }
});

test('the WebSocket relay passes a valid token through to the bridge', async () => {
  const { proxyUrl, cleanup } = await setup();
  try {
    const port = Number(new URL(proxyUrl).port);
    const result = await upgrade(port, `/ws/live?token=${VALID_TOKEN}`);
    assert.equal(result.upgraded, true, 'a valid session must reach the bridge’s WS endpoint');
    assert.equal(result.status, 101);
  } finally {
    cleanup();
  }
});
