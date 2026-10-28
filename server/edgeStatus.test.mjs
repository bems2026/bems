import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readEdgeStatus, writeEdgeStatus, STALE_AFTER_MS } from './edgeStatus.mjs';

/**
 * RM-165 (2026-10-28). Ingest writes whether it reaches the cloud; the proxy serves it, so the page can say
 * "no internet: logging on the edge, N rows waiting" instead of looking live while 566,000 rows wait.
 */

const dir = mkdtempSync(join(tmpdir(), 'edge-status-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const base = {
  at: '2026-10-28T03:30:00.000Z', cloudReachable: false, waiting: 566_184,
  lastUploadOkAt: '2026-10-15T01:00:00.000Z', lastUploadFailAt: '2026-10-28T03:30:00.000Z',
  frozen: [{ deviceId: 'mtr_arec_acu', frozenSince: '2026-10-14T13:22:01+08:00' }],
};
const now = Date.parse(base.at) + 30_000;

test('an unreachable cloud reads as offline, with what is waiting and which meters hold', () => {
  const file = join(dir, 'a.json');
  writeEdgeStatus(file, base);
  assert.deepEqual(readEdgeStatus(file, now), {
    state: 'offline', at: base.at, waiting: 566_184,
    last_upload_ok_at: base.lastUploadOkAt, last_upload_fail_at: base.lastUploadFailAt,
    frozen: [{ device_id: 'mtr_arec_acu', frozen_since: '2026-10-14T13:22:01+08:00' }],
  });
});

test('a reachable cloud reads as online, and a paused upload as paused', () => {
  const file = join(dir, 'b.json');
  writeEdgeStatus(file, { ...base, cloudReachable: true, waiting: 1200 });
  assert.equal(readEdgeStatus(file, now).state, 'online');
  writeEdgeStatus(file, { ...base, cloudReachable: false, paused: true });
  assert.equal(readEdgeStatus(file, now).state, 'paused');
});

test('no file, a broken one, or one older than three ticks reads as unknown', () => {
  assert.deepEqual(readEdgeStatus(join(dir, 'missing.json'), now), { state: 'unknown' });
  const broken = join(dir, 'c.json');
  writeFileSync(broken, '{not json');
  assert.deepEqual(readEdgeStatus(broken, now), { state: 'unknown' });
  const old = join(dir, 'd.json');
  writeEdgeStatus(old, base);
  assert.deepEqual(readEdgeStatus(old, Date.parse(base.at) + STALE_AFTER_MS + 1), { state: 'unknown' });
});

test('RM-165: one timed-out batch on a slow link is not "no internet" while an upload went through recently', async () => {
  // 28 Oct, 14:29: after a restart the batch size starts large and times out on the slow link, while the
  // previous minutes' uploads had gone through. The page must not say the site has no internet.
  const { cloudReachable, RECENT_OK_MS } = await import('./edgeStatus.mjs');
  const now = Date.parse('2026-10-28T06:29:10Z');
  assert.equal(cloudReachable({ reachable: false, okAt: '2026-10-28T06:25:00Z' }, now), true);
  assert.equal(cloudReachable({ reachable: false, okAt: new Date(now - RECENT_OK_MS - 1).toISOString() }, now), false);
  assert.equal(cloudReachable({ reachable: false, okAt: null }, now), false);
  assert.equal(cloudReachable({ reachable: true, okAt: null }, now), true);
});

test('RM-165: the last good and failed uploads are carried across a restart', async () => {
  const { previousSeen } = await import('./edgeStatus.mjs');
  const file = join(dir, 'prev.json');
  writeEdgeStatus(file, { ...base, cloudReachable: true, lastUploadOkAt: '2026-10-28T06:20:00.000Z' });
  assert.deepEqual(previousSeen(file), { reachable: null, okAt: '2026-10-28T06:20:00.000Z', failAt: base.lastUploadFailAt });
  assert.deepEqual(previousSeen(join(dir, 'none.json')), { reachable: null, okAt: null, failAt: null });
});
