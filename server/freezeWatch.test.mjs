import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFreezeWatch, freezeMessage } from './freezeWatch.mjs';

/**
 * RM-163 (2026-10-14). A frozen meter is flagged on its reading only after the rule's wait (up to twelve
 * hours at 0 W), and nobody was told: the four CT meters sat frozen for days while the site was offline and
 * were revived only by a power cycle. This turns the flags in each tick's readings into events, once per
 * freeze, for ingest to mark the archive back to the start and to tell the operator.
 */

const reading = (id, frozenSince, ts = '2026-10-14T10:00:00+08:00') => ({
  device_id: id, ts,
  capabilities: frozenSince ? { measurement_frozen: true, frozen_since: frozenSince, sync_request: 'request' } : { sync_request: 'request' },
});

test('a freeze is reported once, when it is first seen, with when it started', () => {
  const w = createFreezeWatch();
  assert.deepEqual(w.observe([reading('mtr_lo_red', '2026-10-13T22:00:00+08:00'), reading('co1', null)]), {
    started: [{ deviceId: 'mtr_lo_red', frozenSince: '2026-10-13T22:00:00+08:00', ts: '2026-10-14T10:00:00+08:00' }],
    cleared: [],
  });
  assert.deepEqual(w.observe([reading('mtr_lo_red', '2026-10-13T22:00:00+08:00')]), { started: [], cleared: [] }, 'not again next minute');
});

test('a freeze that ends is reported as cleared, and a new one starts afresh', () => {
  const w = createFreezeWatch();
  w.observe([reading('mtr_lo_red', '2026-10-13T22:00:00+08:00')]);
  assert.deepEqual(w.observe([reading('mtr_lo_red', null)]), { started: [], cleared: ['mtr_lo_red'] });
  assert.equal(w.observe([reading('mtr_lo_red', '2026-10-15T01:00:00+08:00')]).started.length, 1);
});

test('an earlier start for the same freeze is reported again, so the archive is marked back to it', () => {
  const w = createFreezeWatch();
  w.observe([reading('mtr_co_yellow', '2026-10-14T07:00:00+08:00')]);
  const { started } = w.observe([reading('mtr_co_yellow', '2026-10-14T04:00:00+08:00')]);
  assert.deepEqual(started.map((s) => s.frozenSince), ['2026-10-14T04:00:00+08:00']);
});

test('a device missing from a tick is neither cleared nor forgotten', () => {
  const w = createFreezeWatch();
  w.observe([reading('mtr_lo_red', '2026-10-13T22:00:00+08:00')]);
  assert.deepEqual(w.observe([reading('co1', null)]), { started: [], cleared: [] });
  assert.deepEqual(w.observe([reading('mtr_lo_red', '2026-10-13T22:00:00+08:00')]), { started: [], cleared: [] });
});

test('the message names the device, since when, and what cures it', () => {
  const m = freezeMessage({ name: 'L.O Red', frozenSince: '2026-10-13T22:00:00+08:00', isMeter: true });
  assert.match(m.title, /L\.O Red/);
  assert.match(m.body, /2026-10-13 22:00/);
  assert.match(m.body, /power-cycle/i);
  assert.equal(m.priority, 'high');
});

test('ingest acts on each tick\'s freezes before archiving it, and sends marked minutes again after an upload', async () => {
  // Read from the source: ingest is a daemon no test spawns, and the order is the property.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./ingest.mjs', import.meta.url), 'utf8');
  assert.match(src, /void noteFreezes\(batch\.readings\);\s*return archive\.insertTick\(batch\);/);
  assert.match(src, /archive\.flagFrozen\(s\.deviceId, \{ fromMs: sinceMs \+ 60_000, toMs, frozenSince: s\.frozenSince \}\)/,
    'the first minute of the held value was a real measurement and is not marked');
  assert.equal(src.match(/if \(synced\.ok\) await resendFlagged\(\);/g)?.length, 2, 'after the regular upload and after a catch-up one');
});
