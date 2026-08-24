/**
 * The property under test is the one that was violated twice by hand: after probing whether a
 * value is accepted, the row must be exactly as it was — including when the probe throws.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeRejects, probeAccepts, CHECK_VIOLATION } from './schemaProbe.mjs';

/** A fake PostgREST holding one row, recording every request it received. */
function fakeDb(initial, { rejectValues = [], failOnWrite = false } = {}) {
  const row = { ...initial };
  const seen = [];
  const request = async ({ method, path, body }) => {
    seen.push({ method, path, body });
    if (method === 'GET') return { status: 200, body: [{ ...row }] };
    const [column, value] = Object.entries(body)[0];
    if (failOnWrite) throw new Error('network died mid-probe');
    if (rejectValues.includes(value)) {
      return { status: 400, body: { code: CHECK_VIOLATION, message: 'violates check constraint' } };
    }
    row[column] = value;
    return { status: 204, body: null };
  };
  return { request, seen, current: () => ({ ...row }) };
}

const args = (request, value) => ({
  request, table: 'device_config', keyColumn: 'device_id', keyValue: 'l1', column: 'category', value,
});

test('probeRejects reports a refusal and leaves the row alone', async () => {
  const db = fakeDb({ category: 'lighting' }, { rejectValues: ['kitchen'] });
  const { rejected, code } = await probeRejects(args(db.request, 'kitchen'));
  assert.equal(rejected, true);
  assert.equal(code, CHECK_VIOLATION);
  assert.equal(db.current().category, 'lighting');
});

test('probeRejects does not call a value accepted a rejection — a 204 is not a refusal', async () => {
  const db = fakeDb({ category: 'lighting' });
  const { rejected } = await probeRejects(args(db.request, 'sensor'));
  assert.equal(rejected, false);
});

test('probeAccepts restores the original value', async () => {
  const db = fakeDb({ category: 'lighting' });
  const { accepted, restoredTo } = await probeAccepts(args(db.request, 'sensor'));
  assert.equal(accepted, true);
  assert.equal(restoredTo, 'lighting');
  assert.equal(db.current().category, 'lighting', 'the row was left holding the probe value');
});

test('probeAccepts restores even when the probe throws — the failure it exists for', async () => {
  // The realistic failure is not malice, it is attention moving to the error and the row being
  // left holding a value nobody chose. That is exactly what happened twice by hand.
  const db = fakeDb({ category: 'lighting' });
  let calls = 0;
  const flaky = async (req) => {
    calls += 1;
    if (calls === 2) throw new Error('network died mid-probe');
    return db.request(req);
  };
  await assert.rejects(() => probeAccepts(args(flaky, 'sensor')), /network died/);
  // The restore is in a finally, so it still ran after the throw.
  assert.equal(db.current().category, 'lighting');
});

test('probeAccepts refuses to run when the key does not identify exactly one row', async () => {
  // Borrowing a row to probe with only makes sense if it is one known row; restoring "the"
  // value across several would be a guess.
  const request = async () => ({ status: 200, body: [{ category: 'a' }, { category: 'b' }] });
  await assert.rejects(() => probeAccepts(args(request, 'sensor')), /exactly one row/);
});

test('probeAccepts issues the restore as its own write, not as a hoped-for rollback', async () => {
  const db = fakeDb({ category: 'lighting' });
  await probeAccepts(args(db.request, 'sensor'));
  const writes = db.seen.filter((r) => r.method === 'PATCH');
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1].body, { category: 'lighting' });
});
