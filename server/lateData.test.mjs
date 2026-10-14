import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { noteLateUpload, readLate, writeLate, LATE_AFTER_MS } from './lateData.mjs';

/**
 * RM-163 (2026-10-14). Rows that reach the cloud long after their minute may belong to a period already
 * reported. The record of them is what makes those reports be built again (server/reports.mjs).
 */

const NOW = Date.parse('2026-10-14T05:00:00Z');

test('an upload of fresh rows is not late', () => {
  assert.equal(noteLateUpload(null, { fromMs: NOW - 4 * 60_000, toMs: NOW - 60_000 }, NOW), null);
});

test('an upload of rows older than the threshold is recorded, with when it arrived', () => {
  const late = noteLateUpload(null, { fromMs: Date.parse('2026-10-07T07:29:00Z'), toMs: Date.parse('2026-10-07T09:00:00Z') }, NOW);
  assert.deepEqual(late, { fromMs: Date.parse('2026-10-07T07:29:00Z'), untilMs: Date.parse('2026-10-07T09:00:00Z'), arrivedAtMs: NOW });
  assert.equal(LATE_AFTER_MS, 60 * 60_000);
});

test('later late uploads widen the record and move its arrival on', () => {
  const first = noteLateUpload(null, { fromMs: Date.parse('2026-10-07T07:29:00Z'), toMs: Date.parse('2026-10-07T09:00:00Z') }, NOW);
  const second = noteLateUpload(first, { fromMs: Date.parse('2026-10-07T09:00:00Z'), toMs: Date.parse('2026-10-08T00:00:00Z') }, NOW + 60_000);
  assert.deepEqual(second, { fromMs: Date.parse('2026-10-07T07:29:00Z'), untilMs: Date.parse('2026-10-08T00:00:00Z'), arrivedAtMs: NOW + 60_000 });
  assert.equal(noteLateUpload(second, null, NOW + 120_000), second, 'nothing moved: unchanged');
});

test('kept across a restart; a missing or broken file reads as none', () => {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'ibems-late-'));
  try {
    const file = join(dir, 'report-late.json');
    assert.equal(readLate(file), null);
    const late = { fromMs: 1, untilMs: 2, arrivedAtMs: 3 };
    writeLate(file, late);
    assert.deepEqual(readLate(file), late);
    fs.writeFileSync(file, '{not json');
    assert.equal(readLate(file), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
