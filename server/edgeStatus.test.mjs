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
