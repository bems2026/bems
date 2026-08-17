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
 */
function startFakeSupabaseAuth() {
  return new Promise((resolve) => {
    const port = nextPort++;
    const state = { insertedCommands: [], rejectCommandInserts: false };
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
        state.insertedCommands.push(JSON.parse(raw));
        res.writeHead(201, { 'Content-Type': 'application/json' });
        return res.end('[]');
      }
      res.writeHead(404);
      res.end();
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
    assert.deepEqual(await res.json(), { hardware_dispatch_enabled: false });
  } finally {
    cleanup();
  }
});

test('GET /api/capabilities reports true once the gate is explicitly opened', async () => {
  const { proxyUrl, cleanup } = await setup({ HARDWARE_DISPATCH_ENABLED: 'true' });
  try {
    const res = await fetch(`${proxyUrl}/api/capabilities`, { headers: { Authorization: `Bearer ${VALID_TOKEN}` } });
    assert.deepEqual(await res.json(), { hardware_dispatch_enabled: true });
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

test('a command with the gate open is logged as dispatched, not dry_run', async () => {
  const { proxyUrl, supabaseState, cleanup } = await setup({ HARDWARE_DISPATCH_ENABLED: 'true' });
  try {
    const res = await fetch(`${proxyUrl}/api/command`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${VALID_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: 'l1', action: 'off' }),
    });
    assert.equal(res.status, 202);
    assert.equal(supabaseState.insertedCommands[0].status, 'dispatched');
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
