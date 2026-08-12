/**
 * Transport-level tests for `POST`/`GET /api/context` — spawns the actual mock-bridge
 * process and hits it over real HTTP, mirroring `command.test.mjs`'s structure exactly.
 * `contract.test.mjs`'s validation matrix covers `validateContextWrite` as a pure function;
 * what that can't reach is the body parser, HTTP status behaviour, and the round-trip
 * through the in-memory context store back out via GET — all of which need a real server.
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

let nextPort = 18900; // distinct range from command.test.mjs's 18800+, so parallel runs never collide

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

async function postJson(baseUrl, path, body, { rawBody } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: rawBody !== undefined ? rawBody : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function getJson(baseUrl, path) {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, body: await res.json() };
}

// ---------------------------------------------------------------------------

test('a context write round-trips: POST then GET shows the new value', async () => {
  const { child, baseUrl } = await spawnMock();
  try {
    const post = await postJson(baseUrl, '/api/context', { writes: { 'global.schedule.l1.on': '07:30' } });
    assert.equal(post.status, 202);
    assert.equal(post.body.confirmed, false);
    assert.deepEqual(post.body.keys, ['global.schedule.l1.on']);

    const after = await getJson(baseUrl, '/api/context');
    assert.equal(after.status, 200);
    assert.equal(after.body['global.schedule.l1.on'], '07:30');
  } finally {
    await stopMock(child);
  }
});

test('GET /api/context is an empty object on a freshly started mock — no fabricated defaults', async () => {
  const { child, baseUrl } = await spawnMock();
  try {
    const res = await getJson(baseUrl, '/api/context');
    assert.deepEqual(res.body, {});
  } finally {
    await stopMock(child);
  }
});

test('a bulk write lands every key in one request', async () => {
  const { child, baseUrl } = await spawnMock();
  try {
    await postJson(baseUrl, '/api/context', {
      writes: { 'global.dsm.max_phase_a': '22', 'global.dsm.max_total_kw': '9', 'global.trigger.care_acu_on': '28' },
    });
    const after = await getJson(baseUrl, '/api/context');
    assert.equal(after.body['global.dsm.max_phase_a'], '22');
    assert.equal(after.body['global.dsm.max_total_kw'], '9');
    assert.equal(after.body['global.trigger.care_acu_on'], '28');
  } finally {
    await stopMock(child);
  }
});

test('a later write only overwrites the keys it names, not the whole store', async () => {
  const { child, baseUrl } = await spawnMock();
  try {
    await postJson(baseUrl, '/api/context', { writes: { 'global.schedule.l1.on': '07:30', 'global.schedule.l1.off': '17:30' } });
    await postJson(baseUrl, '/api/context', { writes: { 'global.schedule.l1.on': '08:00' } });
    const after = await getJson(baseUrl, '/api/context');
    assert.equal(after.body['global.schedule.l1.on'], '08:00');
    assert.equal(after.body['global.schedule.l1.off'], '17:30');
  } finally {
    await stopMock(child);
  }
});

test('an unknown device in a schedule key is 400 invalid_key', async () => {
  const { child, baseUrl } = await spawnMock();
  try {
    const res = await postJson(baseUrl, '/api/context', { writes: { 'global.schedule.co9.on': '07:00' } });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'invalid_key');
  } finally {
    await stopMock(child);
  }
});

test('a meter has no schedulable state — its schedule key is rejected', async () => {
  const { child, baseUrl } = await spawnMock();
  try {
    const res = await postJson(baseUrl, '/api/context', { writes: { 'global.schedule.mtr_lo_red.armed': 'true' } });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'invalid_key');
  } finally {
    await stopMock(child);
  }
});

test('an empty writes object is 400 empty_writes', async () => {
  const { child, baseUrl } = await spawnMock();
  try {
    const res = await postJson(baseUrl, '/api/context', { writes: {} });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'empty_writes');
  } finally {
    await stopMock(child);
  }
});

test('malformed JSON is 400 malformed_json, same body parser as /api/command', async () => {
  const { child, baseUrl } = await spawnMock();
  try {
    const res = await postJson(baseUrl, '/api/context', undefined, { rawBody: '{not json' });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'malformed_json');
  } finally {
    await stopMock(child);
  }
});

test('one invalid key in a bulk write rejects the whole batch — no partial writes', async () => {
  const { child, baseUrl } = await spawnMock();
  try {
    const res = await postJson(baseUrl, '/api/context', {
      writes: { 'global.trigger.care_acu_on': '28', 'global.trigger.unknown_trigger': '1' },
    });
    assert.equal(res.status, 400);
    const after = await getJson(baseUrl, '/api/context');
    assert.deepEqual(after.body, {}, 'the valid key must not have landed alongside the invalid one');
  } finally {
    await stopMock(child);
  }
});

test('--500 fails context writes too, same as every other route', async () => {
  const { child, baseUrl } = await spawnMock(['--500']);
  try {
    const res = await postJson(baseUrl, '/api/context', { writes: { 'global.trigger.care_acu_on': '28' } });
    assert.equal(res.status, 500);
  } finally {
    await stopMock(child);
  }
});
