/**
 * Transport-level tests for `POST /api/command` — spawns the actual mock-bridge process
 * and hits it over real HTTP. `contract.test.mjs`'s validation matrix covers
 * `validateCommand` as a pure function; what that can't reach is the body parser, HTTP
 * status/Allow-header behaviour, the CORS preflight, and the round-trip through the
 * in-memory override map back out via `GET /api/readings/latest` — all of which need a
 * real running server. Kept in its own file so `contract.test.mjs` stays fast and IO-free.
 *
 *     npm run test:bridge
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = join(ROOT, 'mock-bridge', 'server.mjs');

let nextPort = 18800; // distinct range from the dev-default 1880, so a stray real mock never collides

/** Spawns the mock on its own port with the given extra CLI flags; resolves once it's listening. */
function spawnMock(flags = []) {
  const port = nextPort++;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER, `--port=${port}`, ...flags], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const onData = (chunk) => {
      out += chunk.toString();
      if (out.includes('iBEMS mock bridge')) {
        child.stdout.off('data', onData);
        resolve({ child, port, baseUrl: `http://localhost:${port}` });
      }
    };
    child.stdout.on('data', onData);
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== null && code !== 0) reject(new Error(`mock exited early (code ${code}): ${out}`));
    });
  });
}

function stopMock(child) {
  return new Promise((resolve) => {
    child.once('exit', resolve);
    child.kill();
  });
}

async function postJson(baseUrl, path, body, { rawBody, headers } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: rawBody !== undefined ? rawBody : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

async function getJson(baseUrl, path) {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, body: await res.json() };
}

const rowOf = (rows, id) => rows.find((r) => r.device_id === id);

// ---------------------------------------------------------------------------

test('a command round-trips: POST then GET shows the new socket state', async () => {
  const { child, baseUrl } = await spawnMock();
  try {
    const post = await postJson(baseUrl, '/api/command', { device_id: 'co3', socket: 1, action: 'off' });
    assert.equal(post.status, 202);
    assert.equal(post.body.confirmed, false);
    assert.equal(post.body.target, 'CO3_1');

    const after = await getJson(baseUrl, '/api/readings/latest');
    assert.equal(rowOf(after.body, 'co3').socket_states[1], 'off');
  } finally {
    await stopMock(child);
  }
});

test('the pin survives the occupancy simulation — it does not drift back on the next snapshot', async () => {
  const { child, baseUrl } = await spawnMock();
  try {
    await postJson(baseUrl, '/api/command', { device_id: 'co3', socket: 1, action: 'off' });
    for (let i = 0; i < 5; i++) {
      const r = await getJson(baseUrl, '/api/readings/latest');
      assert.equal(rowOf(r.body, 'co3').socket_states[1], 'off', `drifted on read #${i + 1}`);
    }
  } finally {
    await stopMock(child);
  }
});

test('switching both sockets off drops that outlet meter to zero watts', async () => {
  const { child, baseUrl } = await spawnMock();
  try {
    await postJson(baseUrl, '/api/command', { device_id: 'co4', socket: 1, action: 'off' });
    await postJson(baseUrl, '/api/command', { device_id: 'co4', socket: 2, action: 'off' });
    const r = await getJson(baseUrl, '/api/readings/latest');
    assert.equal(rowOf(r.body, 'co4').power_w, 0);
  } finally {
    await stopMock(child);
  }
});

test('a light switch command round-trips too', async () => {
  const { child, baseUrl } = await spawnMock();
  try {
    await postJson(baseUrl, '/api/command', { device_id: 'l2', action: 'on' });
    const r = await getJson(baseUrl, '/api/readings/latest');
    assert.equal(rowOf(r.body, 'l2').state, 'on');
  } finally {
    await stopMock(child);
  }
});

test('replaying the same command_id returns the original ack, not a second operation', async () => {
  const { child, baseUrl } = await spawnMock();
  try {
    const a = await postJson(baseUrl, '/api/command', { device_id: 'l2', action: 'on', command_id: 'fixed-id' });
    const b = await postJson(baseUrl, '/api/command', { device_id: 'l2', action: 'on', command_id: 'fixed-id' });
    assert.deepEqual(a.body, b.body); // identical accepted_at proves it wasn't re-executed
  } finally {
    await stopMock(child);
  }
});

test('a command without a client-supplied command_id still gets one, and it round-trips through 202', async () => {
  const { child, baseUrl } = await spawnMock();
  try {
    const res = await postJson(baseUrl, '/api/command', { device_id: 'l3', action: 'on' });
    assert.equal(res.status, 202);
    assert.equal(typeof res.body.command_id, 'string');
    assert.ok(res.body.command_id.length > 0);
  } finally {
    await stopMock(child);
  }
});

test('POST to a read route is 405 with Allow: GET', async () => {
  const { child, baseUrl } = await spawnMock();
  try {
    const res = await postJson(baseUrl, '/api/readings/latest', {});
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'GET');
  } finally {
    await stopMock(child);
  }
});

test('GET /api/command is 405 with Allow: POST', async () => {
  const { child, baseUrl } = await spawnMock();
  try {
    const res = await fetch(`${baseUrl}/api/command`);
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'POST');
  } finally {
    await stopMock(child);
  }
});

test('OPTIONS /api/command is a 204 preflight advertising POST', async () => {
  const { child, baseUrl } = await spawnMock();
  try {
    const res = await fetch(`${baseUrl}/api/command`, { method: 'OPTIONS' });
    assert.equal(res.status, 204);
    assert.match(res.headers.get('access-control-allow-methods') || '', /POST/);
  } finally {
    await stopMock(child);
  }
});

test('malformed JSON is 400 malformed_json', async () => {
  const { child, baseUrl } = await spawnMock();
  try {
    const res = await postJson(baseUrl, '/api/command', undefined, { rawBody: '{not json' });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'malformed_json');
  } finally {
    await stopMock(child);
  }
});

test('an empty body is 400 malformed_json, not a crash', async () => {
  const { child, baseUrl } = await spawnMock();
  try {
    const res = await postJson(baseUrl, '/api/command', undefined, { rawBody: '' });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'malformed_json');
  } finally {
    await stopMock(child);
  }
});

test('an oversized body is 413 body_too_large', async () => {
  const { child, baseUrl } = await spawnMock();
  try {
    const res = await postJson(baseUrl, '/api/command', undefined, { rawBody: 'x'.repeat(9 * 1024) });
    assert.equal(res.status, 413);
    assert.equal(res.body.code, 'body_too_large');
  } finally {
    await stopMock(child);
  }
});

test('a non-JSON content type is 415', async () => {
  const { child, baseUrl } = await spawnMock();
  try {
    const res = await postJson(baseUrl, '/api/command', undefined, {
      rawBody: JSON.stringify({ device_id: 'l1', action: 'on' }),
      headers: { 'Content-Type': 'text/plain' },
    });
    assert.equal(res.status, 415);
    assert.equal(res.body.code, 'unsupported_media_type');
  } finally {
    await stopMock(child);
  }
});

test('an unknown device is 404 over the wire, matching the pure validator', async () => {
  const { child, baseUrl } = await spawnMock();
  try {
    const res = await postJson(baseUrl, '/api/command', { device_id: 'co9', socket: 1, action: 'on' });
    assert.equal(res.status, 404);
    assert.equal(res.body.code, 'unknown_device');
  } finally {
    await stopMock(child);
  }
});

test('--cmd-fail=<id> returns 502 and leaves state untouched', async () => {
  const { child, baseUrl } = await spawnMock(['--cmd-fail=co5']);
  try {
    const before = await getJson(baseUrl, '/api/readings/latest');
    const beforeState = rowOf(before.body, 'co5').socket_states[1];

    const res = await postJson(baseUrl, '/api/command', { device_id: 'co5', socket: 1, action: beforeState === 'on' ? 'off' : 'on' });
    assert.equal(res.status, 502);
    assert.equal(res.body.code, 'upstream_rejected');

    const after = await getJson(baseUrl, '/api/readings/latest');
    assert.equal(rowOf(after.body, 'co5').socket_states[1], beforeState, 'state changed despite the injected failure');
  } finally {
    await stopMock(child);
  }
});

test('--cmd-fail=<id> does not affect commands for other devices', async () => {
  const { child, baseUrl } = await spawnMock(['--cmd-fail=co5']);
  try {
    const res = await postJson(baseUrl, '/api/command', { device_id: 'co6', socket: 1, action: 'off' });
    assert.equal(res.status, 202);
  } finally {
    await stopMock(child);
  }
});

test('--500 fails commands too, same as reads', async () => {
  const { child, baseUrl } = await spawnMock(['--500']);
  try {
    const res = await postJson(baseUrl, '/api/command', { device_id: 'l1', action: 'on' });
    assert.equal(res.status, 500);
  } finally {
    await stopMock(child);
  }
});

test('--cmd-drop=<id> never responds at all — exercises the client-side abort path', async () => {
  const { child, baseUrl } = await spawnMock(['--cmd-drop=co7']);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300);
    await assert.rejects(
      fetch(`${baseUrl}/api/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: 'co7', socket: 1, action: 'on' }),
        signal: controller.signal,
      }),
      /abort/i,
    );
    clearTimeout(timeout);
  } finally {
    await stopMock(child);
  }
});

test('--cmd-latency delays both the mutation and the ack', async () => {
  const { child, baseUrl } = await spawnMock(['--cmd-latency=200']);
  try {
    const start = Date.now();
    const res = await postJson(baseUrl, '/api/command', { device_id: 'l4', action: 'on' });
    assert.equal(res.status, 202);
    assert.ok(Date.now() - start >= 190, 'ack returned before the injected latency elapsed');

    const r = await getJson(baseUrl, '/api/readings/latest');
    assert.equal(rowOf(r.body, 'l4').state, 'on');
  } finally {
    await stopMock(child);
  }
});
