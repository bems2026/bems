/**
 * RM-159: each daemon counts its own requests to Supabase, so the log budget can be read on the edge
 * without spending the project's log-query allowance.
 *
 *     node --test server/requestMeter.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequestMeter, requestKind, describeCounts, installRequestMeter } from './requestMeter.mjs';

const BASE = 'https://project.example';

test('a request is counted by what it asks the project for', () => {
  assert.equal(requestKind(`${BASE}/rest/v1/rpc/ingest_upload`, BASE), 'rpc');
  assert.equal(requestKind(`${BASE}/rest/v1/readings?select=ts`, BASE), 'rest');
  assert.equal(requestKind(`${BASE}/auth/v1/user`, BASE), 'auth');
  assert.equal(requestKind(`${BASE}/storage/v1/object/ibems-archive/x`, BASE), 'storage');
  assert.equal(requestKind(`${BASE}/functions/v1/x`, `${BASE}/`), 'other');
});

function tempFile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ibems-meter-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'request-meter', 'ibems-test.json');
}

test('the day\'s count survives a restart, and a new day starts at zero with yesterday kept', (t) => {
  const file = tempFile(t);
  let ms = Date.parse('2026-10-05T10:00:00Z');
  const first = createRequestMeter({ daemon: 'ibems-test', file, now: () => ms });
  first.count('rpc');
  first.count('rest');
  first.save();

  const again = createRequestMeter({ daemon: 'ibems-test', file, now: () => ms });
  again.count('auth');
  assert.deepEqual(again.snapshot().counts, { rest: 1, rpc: 1, auth: 1, storage: 0, other: 0, total: 3 });

  ms = Date.parse('2026-10-06T00:00:30Z');
  again.count('rpc');
  const snap = again.snapshot();
  assert.equal(snap.day, '2026-10-06');
  assert.equal(snap.counts.total, 1);
  assert.deepEqual(snap.previous, { day: '2026-10-05', counts: { rest: 1, rpc: 1, auth: 1, storage: 0, other: 0, total: 3 } });

  again.save();
  const tomorrow = createRequestMeter({ daemon: 'ibems-test', file, now: () => ms });
  assert.equal(tomorrow.snapshot().previous.counts.total, 3, 'yesterday is still there after a restart');
});

test('a restart on a later day keeps the last day it saw as the previous one', (t) => {
  const file = tempFile(t);
  let ms = Date.parse('2026-10-05T23:00:00Z');
  const m = createRequestMeter({ daemon: 'ibems-test', file, now: () => ms });
  m.count('rest');
  m.save();
  ms = Date.parse('2026-10-06T08:00:00Z');
  const next = createRequestMeter({ daemon: 'ibems-test', file, now: () => ms });
  assert.equal(next.snapshot().counts.total, 0);
  assert.equal(next.snapshot().previous.day, '2026-10-05');
});

test('the summary window empties each time it is read, and names only what happened', () => {
  const m = createRequestMeter({ daemon: 'ibems-test', file: null });
  m.count('rpc');
  m.count('rpc');
  m.count('auth');
  assert.equal(describeCounts(m.takeWindow()), 'rpc ×2, auth ×1');
  assert.equal(m.takeWindow().total, 0);
  assert.equal(m.snapshot().counts.total, 3, 'the day keeps counting');
});

test('installed, it counts only requests to the project, and still makes them', async (t) => {
  const dir = path.dirname(tempFile(t));
  const seen = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => { seen.push(String(input)); return new Response('{}'); };
  t.after(() => { globalThis.fetch = original; });
  const meter = installRequestMeter({ daemon: 'ibems-test', supabaseUrl: BASE, dir, summaryMs: 3_600_000, log: () => {} });
  await fetch(`${BASE}/rest/v1/rpc/scheduler_snapshot`, { method: 'POST' });
  await fetch(`${BASE}/auth/v1/user`);
  await fetch('http://127.0.0.1:1880/api/readings/latest');
  assert.equal(seen.length, 3, 'every request still goes out');
  assert.deepEqual(meter.snapshot().counts, { rest: 0, rpc: 1, auth: 1, storage: 0, other: 0, total: 2 });
});
