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
import { SITE } from '../shared/siteConfig.mjs';

/**
 * The floor these tests expect the proxy to report with no database behind it — RM-038.
 *
 * DERIVED, not restated. The number itself is a university policy that changes; asserting a
 * literal here made an unrelated capabilities test fail the moment the site file was corrected
 * from 25 to 24. What these assertions are actually for is the SHAPE of the payload — that no
 * field appears or vanishes unnoticed — and that survives a policy revision.
 *
 * `policy_source: 'build'` beside it is the load-bearing half: with no SUPABASE_URL in the test
 * environment the proxy must fall back to what it was built with rather than dropping the floor.
 */
const BUILD_FLOOR = SITE.policy.acu_min_setpoint_c;
import nodeCrypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { hashBreakGlassPassword } from './breakGlass.mjs';
import { readBuffer } from './ingestBuffer.mjs';
import { DEVICE_REGISTRY } from '../shared/registry.mjs';

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
    // `offline` names devices this bridge should report as unreachable. Empty means every
    // device is online, which is what the dispatch tests below assume.
    const state = { requests: [], healthReads: 0, offline: new Set(), failNext: false, statusCode: null };
    const server = http.createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;

      // The proxy asks this before dispatching, to avoid claiming a success the relay never
      // had (see dispatchCommand). Answered but NOT recorded in `requests`, which every test
      // below reads as "what actually reached the hardware endpoint".
      if (req.method === 'GET' && req.url === '/api/readings/latest') {
        state.healthReads += 1;
        const rows = DEVICE_REGISTRY.map((d) => ({ device_id: d.id, online: !state.offline.has(d.id) }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(rows));
      }

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
/**
 * Per-test locations for everything the proxy persists. The defaults live in `server/data/`,
 * which on the Pi is the live outage queue and the live key cache — a test must never write
 * there.
 */
function tempStatePaths() {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'ibems-proxy-state-'));
  return {
    COMMAND_AUDIT_BUFFER_PATH: join(dir, 'command-audit-buffer.ndjson'),
    SCHEDULER_AUDIT_BUFFER_PATH: join(dir, 'command-audit-buffer-scheduler.ndjson'),
    JWKS_CACHE_PATH: join(dir, 'jwks.json'),
  };
}

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
    // Never the defaults — see the note in scheduler.test.mjs. A buffered row written to
    // `server/data/` is a fabricated command queued for upload into the real audit trail.
    ...tempStatePaths(),
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
    // This harness is the one that actually dispatches, so it is the one most likely to
    // buffer a row. See tempStatePaths.
    ...tempStatePaths(),
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
    // deepEqual, not a subset match: this endpoint tells the UI what it is allowed to claim
    // about hardware, so a field appearing unnoticed is exactly what should fail a test.
    assert.deepEqual(await res.json(), { hardware_dispatch_enabled: false, dispatch_classes: [], audit_buffer_pending: 0, dispatch_policy: 'local-first', cloud_fallback_configured: false, acu_min_setpoint_c: BUILD_FLOOR, policy_source: 'build' });
  } finally {
    cleanup();
  }
});

test('GET /api/capabilities reports true once the gate is explicitly opened', async () => {
  const { proxyUrl, cleanup } = await setup({ HARDWARE_DISPATCH_ENABLED: 'true', LIGHT_API_TOKEN: 'test-light-token' });
  try {
    const res = await fetch(`${proxyUrl}/api/capabilities`, { headers: { Authorization: `Bearer ${VALID_TOKEN}` } });
    assert.deepEqual(await res.json(), { hardware_dispatch_enabled: true, dispatch_classes: ['switch', 'outlet_dual', 'acu_ir'], audit_buffer_pending: 0, dispatch_policy: 'local-first', cloud_fallback_configured: false, acu_min_setpoint_c: BUILD_FLOOR, policy_source: 'build' });
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

/**
 * The end of the false-success bug, asserted at the HTTP surface.
 *
 * The Node-RED endpoint answers 2xx as soon as it ACCEPTS a message; the tuya node then fails
 * asynchronously, after the response has gone. So a command to an unreachable device came back
 * 'dispatched' while Node-RED logged `Device not connected. Can't send the SET commmand` —
 * observed on the Pi 2026-08-25 against co1.
 *
 * Two things were wrong and both were silent: the operator was told a command worked when it
 * had not, and because local never reported failure the vendor-cloud fallback was unreachable.
 * RM-018 had been dead code the whole time, which is why nobody had ever seen it fire.
 */
test('a device the bridge reports offline is never sent a local command, nor audited as dispatched', async () => {
  const { proxyUrl, supabaseState, lightState, cleanup } = await setupDispatch();
  try {
    lightState.offline.add('l3');
    const res = await fetch(`${proxyUrl}/api/command`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${VALID_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: 'l3', action: 'on' }),
    });
    assert.equal(lightState.healthReads > 0, true, 'the proxy must ask before dispatching');
    assert.equal(lightState.requests.length, 0, 'nothing may be sent to a device known to be unreachable');
    assert.notEqual(res.status, 202, 'and the caller must not be told it was accepted');
    assert.notEqual(supabaseState.insertedCommands[0].status, 'dispatched');
  } finally {
    cleanup();
  }
});

test('dispatch open + switch + downstream failure: 502 bridge_rejected, audit row says failed not dispatched', async () => {
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
    // The bridge ANSWERED and refused. Distinct from not being reachable at all, because the
    // remedies differ: this one is a token or a route, that one is Node-RED being down.
    assert.equal(body.error, 'bridge_rejected');
    assert.equal(body.code, 'bridge_rejected');
    assert.equal(supabaseState.insertedCommands.length, 1);
    assert.equal(supabaseState.insertedCommands[0].status, 'failed');
  } finally {
    cleanup();
  }
});

/**
 * The misreading this exists to prevent, and the reason it is worth a test of its own.
 *
 * Both of the failures above and this one used to answer `hardware_dispatch_failed`, which the
 * app rendered as "The bridge did not accept the command (502)." So a fact about ONE SOCKET —
 * with a remedy at that socket — arrived looking like a building-wide outage. A physical test on
 * 2026-08-31 reported it as "bridge not reachable" while the bridge was serving readings the
 * whole time, and the diagnosis went the wrong way for a fortnight.
 */
test('a device the bridge reports offline says so by name, rather than blaming the bridge', async () => {
  const { proxyUrl, lightState, cleanup } = await setupDispatch();
  try {
    lightState.offline.add('l3');
    const res = await fetch(`${proxyUrl}/api/command`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${VALID_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: 'l3', action: 'on' }),
    });
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.code, 'device_offline');
    assert.match(body.detail, /this device/i);
    // No host, port or upstream body: this response crosses into a browser.
    assert.doesNotMatch(JSON.stringify(body), /127\.0\.0\.1|localhost|:\d{4}\b/);
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
      // 26, not 22: this site's policy floor is 25 (RM-027). The assertion here is about
      // ROUTING — that a setpoint becomes an IR code on /acu rather than a relay state — and
      // any policy-legal value proves that equally well. The floor itself is asserted below.
      body: JSON.stringify({ device_id: 'acu_main', action: 'on', target_c: 26 }),
    });
    assert.equal(res.status, 202);
    assert.equal(lightState.requests[0].url, '/acu');
    assert.deepEqual(lightState.requests[0].body, { mode: '26' }, 'the setpoint becomes the IR library key');
    assert.equal(supabaseState.insertedCommands[0].status, 'dispatched');
  } finally {
    cleanup();
  }
});

/**
 * RM-027 — the site's setpoint floor is refused at the transport layer, not hidden in the UI.
 *
 * This is the end-to-end half of the pure-function tests in `contract.test.mjs`. It matters
 * separately because the failure mode being prevented is a request that never went through the
 * dashboard at all: a curl, a stale tab, or a scheduled rule written before the policy existed.
 */
test('an ACU setpoint below the site policy floor is refused, and nothing reaches the hardware', async () => {
  const { proxyUrl, supabaseState, lightState, cleanup } = await setupDispatch();
  try {
    const res = await fetch(`${proxyUrl}/api/command`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${VALID_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: 'acu_main', action: 'on', target_c: 18 }),
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, 'below_policy_floor');
    assert.equal(lightState.requests.length, 0, 'a refused command must not reach the bridge');
    assert.equal(supabaseState.insertedCommands.length, 0, 'nor be recorded as an attempt');
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
        ...tempStatePaths(),
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
    ...tempStatePaths(),
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
    ...tempStatePaths(),
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

// ---------------------------------------------------------------------------
// GET /api/tuya/devices — the cloud fleet view
// ---------------------------------------------------------------------------

test('GET /api/tuya/devices requires a session, like every other data route', async () => {
  const { proxyUrl, cleanup } = await setup();
  try {
    const res = await fetch(`${proxyUrl}/api/tuya/devices`);
    assert.equal(res.status, 401);
  } finally {
    cleanup();
  }
});

test('GET /api/tuya/devices reports 501 when the deployment has no Tuya credentials', async () => {
  // A configuration state, not a fault: a site that was never given credentials should lose
  // this one endpoint rather than see an error for something nobody asked for.
  const { proxyUrl, cleanup } = await setup();
  try {
    const res = await fetch(`${proxyUrl}/api/tuya/devices`, { headers: { Authorization: `Bearer ${VALID_TOKEN}` } });
    assert.equal(res.status, 501);
    assert.deepEqual(await res.json(), { error: 'tuya_not_configured' });
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// GET /api/tuya/presence — FI-015, the on-segment/absent split over HTTP
//
// The join itself is tested in server/macPresence.test.mjs, where it can be driven with
// fixtures. What belongs here is what only the running process decides: that the route is
// behind the session gate, and that a deployment without credentials degrades the same way
// /api/tuya/devices does rather than in a new way.
// ---------------------------------------------------------------------------

test('GET /api/tuya/presence requires a session, like every other data route', async () => {
  // This one matters more than most: the reply names every device in the building and says
  // which are reachable. That is a survey of the site, and it belongs behind the gate.
  const { proxyUrl, cleanup } = await setup();
  try {
    const res = await fetch(`${proxyUrl}/api/tuya/presence`);
    assert.equal(res.status, 401);
  } finally {
    cleanup();
  }
});

test('GET /api/tuya/presence reports 501 when the deployment has no Tuya credentials', async () => {
  // Same shape as /api/tuya/devices on purpose. The MAC join is worthless without the cloud
  // half, so an uncredentialled deployment loses this endpoint too — and says so as a
  // configuration state rather than an error.
  const { proxyUrl, cleanup } = await setup();
  try {
    const res = await fetch(`${proxyUrl}/api/tuya/presence`, { headers: { Authorization: `Bearer ${VALID_TOKEN}` } });
    assert.equal(res.status, 501);
    assert.deepEqual(await res.json(), { error: 'tuya_not_configured' });
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Offline operation: the internet goes away, the building does not
//
// The Tuya fleet is local — same L2 segment, local keys — so commanding it needs no internet.
// Two things needed it anyway (session verification, and the audit insert that gates dispatch),
// which between them reduced the offline command window to zero. These drive the real proxy
// process against a Supabase that genuinely refuses TCP, which is what an outage actually looks
// like: `rejectCommandInserts` above returns a STATUS CODE, and a status code is an answer.
// ---------------------------------------------------------------------------

/** A port nothing is listening on, so `fetch` fails at the transport rather than replying. */
async function deadPort() {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function makeSigningKey() {
  const { publicKey, privateKey } = nodeCrypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { jwk: { ...publicKey.export({ format: 'jwk' }), kid: 'offline-kid', alg: 'ES256', use: 'sig' }, privateKey };
}

function mintToken(privateKey, issuer, { sub = 'user-offline', expIn = 3600 } = {}) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const input = `${enc({ alg: 'ES256', typ: 'JWT', kid: 'offline-kid' })}.${enc({ sub, iss: issuer, exp: Math.floor(Date.now() / 1000) + expIn })}`;
  const sig = nodeCrypto.sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${input}.${sig.toString('base64url')}`;
}

/** Proxy pointed at an unreachable Supabase, with signing keys already cached — the real
 * sequence: they were fetched while the link was up, and the link then went down. */
async function setupOffline({ seedKeys = true, ...extraEnv } = {}) {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'ibems-offline-'));
  const { jwk, privateKey } = makeSigningKey();
  const jwksPath = join(dir, 'jwks.json');
  if (seedKeys) fs.writeFileSync(jwksPath, JSON.stringify({ keys: [jwk] }));
  const bufferPath = join(dir, 'command-audit-buffer.ndjson');

  const supabaseUrl = `http://127.0.0.1:${await deadPort()}`;
  const ctx = await setupDispatch({
    SUPABASE_URL: supabaseUrl,
    JWKS_CACHE_PATH: jwksPath,
    COMMAND_AUDIT_BUFFER_PATH: bufferPath,
    HARDWARE_DISPATCH_ENABLED: 'true',
    LIGHT_API_TOKEN: 'test-light-token',
    ...extraEnv,
  });
  return {
    ...ctx,
    token: mintToken(privateKey, `${supabaseUrl}/auth/v1`),
    foreignToken: mintToken(makeSigningKey().privateKey, `${supabaseUrl}/auth/v1`),
    bufferPath,
    readBufferedRows: () => readBuffer(bufferPath).map((e) => e.rows[0]),
  };
}

test('a real session still commands hardware while Supabase is unreachable', async () => {
  // The whole point of the change. Before it, this returned 403: the session could not be
  // verified and the audit row could not be written, so a WAN outage removed every control in
  // the building while the devices themselves sat there perfectly reachable.
  const ctx = await setupOffline();
  try {
    const res = await fetch(`${ctx.proxyUrl}/api/command`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ctx.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: 'l1', action: 'off' }),
    });
    assert.equal(res.status, 202, await res.text());

    const rows = ctx.readBufferedRows();
    assert.equal(rows.length, 1, 'the command must be recorded durably, or it must not dispatch');
    assert.equal(rows[0].device_id, 'l1');
    assert.equal(rows[0].requested_by, 'user-offline', 'attribution has to survive the outage');
    assert.equal(rows[0].status, 'dispatched', 'the outcome is written back into the buffered row');

    // And the operator is told. A command accepted into the buffer is not the same fact as one
    // recorded in the audit table, so the backlog has to be visible rather than inferred.
    const caps = await fetch(`${ctx.proxyUrl}/api/capabilities`, { headers: { Authorization: `Bearer ${ctx.token}` } });
    assert.equal((await caps.json()).audit_buffer_pending, 1);
  } finally {
    ctx.cleanup();
  }
});

test('offline, a token signed by anyone else is refused', async () => {
  // Offline verification is the only check running, so it is the entire boundary between the
  // LAN and a relay. A self-signed token must not open it.
  const ctx = await setupOffline();
  try {
    const res = await fetch(`${ctx.proxyUrl}/api/command`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ctx.foreignToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: 'l1', action: 'off' }),
    });
    assert.equal(res.status, 401);
    assert.deepEqual(ctx.readBufferedRows(), [], 'nothing may be recorded for a refused caller');
  } finally {
    ctx.cleanup();
  }
});

test('offline with no cached keys, everything is refused rather than waved through', async () => {
  // Fails closed. A fresh install that has never been online has no keys, and "no keys" must
  // never collapse into "no checking".
  const ctx = await setupOffline({ seedKeys: false });
  try {
    const res = await fetch(`${ctx.proxyUrl}/api/command`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ctx.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: 'l1', action: 'off' }),
    });
    assert.equal(res.status, 401);
    assert.deepEqual(ctx.readBufferedRows(), []);
  } finally {
    ctx.cleanup();
  }
});

test('offline, a break-glass session is still view-only', async () => {
  // The decision was real sessions only. Break-glass authenticates against a local password
  // hash, so it works offline by construction — which is exactly why it needs an explicit
  // check that the outage has not quietly promoted it to a command-capable session.
  const ctx = await setupOffline();
  try {
    const login = await fetch(`${ctx.proxyUrl}/api/local-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: BREAK_GLASS_PASSWORD }),
    });
    assert.equal(login.status, 200, 'break-glass must still let someone in to LOOK');
    const { token } = await login.json();

    const res = await fetch(`${ctx.proxyUrl}/api/command`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: 'l1', action: 'off' }),
    });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, 'break_glass_cannot_command');
    assert.deepEqual(ctx.readBufferedRows(), []);
  } finally {
    ctx.cleanup();
  }
});
