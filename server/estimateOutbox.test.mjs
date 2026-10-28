import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEstimateOutbox } from './estimateOutbox.mjs';

/** RM-165: an estimate is made as the internet returns, at its slowest; a failed upload must lose nothing. */

const dir = mkdtempSync(join(tmpdir(), 'estimate-outbox-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const row = (day, kwh) => ({ site_id: 's', device_id: 'mtr_arec_acu', local_day: day, held_from: '2026-10-14T05:22:01Z', held_to: '2026-10-28T03:41:04Z', kwh, basis: 'b' });

test('rows wait until an upsert takes them, and stay on record afterwards', async () => {
  const box = createEstimateOutbox({ pending: join(dir, 'p1.ndjson'), record: join(dir, 'r1.ndjson') });
  box.add([row('2026-10-20', 2.7), row('2026-10-21', 2.9)]);
  assert.equal(box.count(), 2);

  const failed = await box.flush(async () => { throw new Error('This operation was aborted'); });
  assert.deepEqual(failed, { sent: 0, error: 'This operation was aborted' });
  assert.equal(box.count(), 2, 'a failed upload keeps them');

  let got = null;
  assert.deepEqual(await box.flush(async (rows) => { got = rows; }), { sent: 2, error: null });
  assert.deepEqual(got, [row('2026-10-20', 2.7), row('2026-10-21', 2.9)]);
  assert.equal(box.count(), 0);
  assert.equal(readFileSync(join(dir, 'r1.ndjson'), 'utf8').trim().split('\n').length, 2, 'the record keeps every row');
  assert.deepEqual(await box.flush(async () => { throw new Error('not called'); }), { sent: 0, error: null }, 'nothing pending asks nothing');
});
