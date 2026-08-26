import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readBuffer } from './ingestBuffer.mjs';
import { createBufferedAudit, takeBufferedCommands, restoreUndrained, BUFFERED_ID_PREFIX } from './auditQueue.mjs';

const tmpPath = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ibems-audit-')), 'commands.ndjson');

const row = (over = {}) => ({
  device_id: 'l1',
  action: 'off',
  target: 'relay',
  requested_by: 'user-123',
  status: 'dispatching',
  ...over,
});

const remoteOk = () => async () => ({ ok: true, id: 'remote-id-1' });
const remoteRejected = () => async () => ({ ok: false, detail: 'HTTP 401 permission denied' });
const remoteUnreachable = () => async () => ({ ok: false, unreachable: true, detail: 'fetch failed' });

test('a reachable Supabase is used directly and nothing is buffered', async () => {
  const bufferPath = tmpPath();
  const audit = createBufferedAudit({ insert: remoteOk(), update: async () => ({ ok: true }), bufferPath });
  const res = await audit.insertAudit(row());
  assert.equal(res.ok, true);
  assert.equal(res.id, 'remote-id-1');
  assert.equal(res.buffered, undefined);
  assert.deepEqual(readBuffer(bufferPath), [], 'nothing should be buffered while online');
});

test('a REJECTED insert still refuses — this is the safety property', async () => {
  // The distinction the whole design turns on. A 4xx is Supabase ANSWERING: this caller may
  // not write that row. Buffering it would convert an authorization refusal into a local
  // queue entry and then move a relay on the strength of it. Only an outage may be buffered.
  const bufferPath = tmpPath();
  const audit = createBufferedAudit({ insert: remoteRejected(), update: async () => ({ ok: true }), bufferPath });
  const res = await audit.insertAudit(row());
  assert.equal(res.ok, false, 'a rejected insert must fail, so auditedDispatch refuses to dispatch');
  assert.deepEqual(readBuffer(bufferPath), [], 'a rejection must never be buffered');
});

test('an UNREACHABLE insert is buffered durably and reports success', async () => {
  const bufferPath = tmpPath();
  const audit = createBufferedAudit({ insert: remoteUnreachable(), update: async () => ({ ok: true }), bufferPath });
  const res = await audit.insertAudit(row());
  assert.equal(res.ok, true, 'the record is durable, so dispatch may proceed');
  assert.equal(res.buffered, true);
  assert.ok(String(res.id).startsWith(BUFFERED_ID_PREFIX));

  const entries = readBuffer(bufferPath);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].table, 'commands', 'must match the shape ingest replays');
  assert.equal(entries[0].rows[0].requested_by, 'user-123', 'attribution has to survive replay');
  assert.ok(entries[0].buffered_at, 'buffered_at is what makes an outage visible afterwards');
});

test('the outcome is written into the buffered row, so one correct row replays', async () => {
  // `command_id` has no unique constraint, so an upsert-on-replay is unavailable without a
  // migration. The entry has not been sent yet, so amending it in place is legitimate and
  // yields a single row carrying its final status.
  const bufferPath = tmpPath();
  const audit = createBufferedAudit({ insert: remoteUnreachable(), update: async () => ({ ok: true }), bufferPath });
  const inserted = await audit.insertAudit(row());
  const updated = await audit.updateAudit(inserted.id, { status: 'dispatched', via: 'local', note: 'done' });
  assert.equal(updated.ok, true);

  const entries = readBuffer(bufferPath);
  assert.equal(entries.length, 1, 'amended in place, not appended as a second row');
  assert.equal(entries[0].rows[0].status, 'dispatched');
  assert.equal(entries[0].rows[0].via, 'local');
});

test('updating a buffered row never touches the network', async () => {
  // If it did, the outcome patch would fail during the very outage that produced the entry.
  const bufferPath = tmpPath();
  let remoteCalls = 0;
  const audit = createBufferedAudit({
    insert: remoteUnreachable(),
    update: async () => {
      remoteCalls++;
      return { ok: true };
    },
    bufferPath,
  });
  const inserted = await audit.insertAudit(row());
  await audit.updateAudit(inserted.id, { status: 'dispatched' });
  assert.equal(remoteCalls, 0);
});

test('a real id still goes to the network', async () => {
  const bufferPath = tmpPath();
  let seen = null;
  const audit = createBufferedAudit({
    insert: remoteOk(),
    update: async (id, patch) => {
      seen = { id, patch };
      return { ok: true };
    },
    bufferPath,
  });
  const inserted = await audit.insertAudit(row());
  await audit.updateAudit(inserted.id, { status: 'dispatched' });
  assert.deepEqual(seen, { id: 'remote-id-1', patch: { status: 'dispatched' } });
});

test('concurrent commands amend their own entries, not each other', async () => {
  // Two people pressing buttons during the same outage. Matching on anything less specific
  // than a per-command id would write one command's outcome onto the other's row.
  const bufferPath = tmpPath();
  const audit = createBufferedAudit({ insert: remoteUnreachable(), update: async () => ({ ok: true }), bufferPath });
  const a = await audit.insertAudit(row({ device_id: 'l1' }));
  const b = await audit.insertAudit(row({ device_id: 'l2' }));
  assert.notEqual(a.id, b.id, 'each buffered command needs its own identity');

  await audit.updateAudit(b.id, { status: 'failed' });
  const rows = readBuffer(bufferPath).map((e) => e.rows[0]);
  assert.equal(rows.find((r) => r.device_id === 'l1').status, 'dispatching');
  assert.equal(rows.find((r) => r.device_id === 'l2').status, 'failed');
});

test('a claim detaches the live file, so a later append starts a fresh one', async () => {
  // WHAT THIS DOES AND DOES NOT PROVE, stated because it is easy to over-read.
  // It pins the observable contract: a claim takes what was there, leaves nothing behind, and
  // a subsequent append accumulates separately rather than joining the batch being uploaded.
  //
  // It does NOT prove the atomicity that makes the design safe. The hazard is an append
  // landing *between* a read and a truncate; the implementation avoids it by using rename(2),
  // which is a single atomic operation with no such gap. An interleaving test cannot
  // distinguish the two, because a hook can only be placed where a window exists and the
  // correct implementation has none — an earlier attempt here added exactly that hook and it
  // passed against a deliberately broken copy-then-truncate version. The atomicity rests on
  // rename(2), not on this test, and pretending otherwise would be worse than saying so.
  const bufferPath = tmpPath();
  const audit = createBufferedAudit({ insert: remoteUnreachable(), update: async () => ({ ok: true }), bufferPath });
  await audit.insertAudit(row({ device_id: 'l1' }));

  const taken = takeBufferedCommands(bufferPath);
  assert.deepEqual(taken.entries.map((e) => e.rows[0].device_id), ['l1']);
  assert.equal(fs.existsSync(bufferPath), false, 'the live file is detached, not left empty');

  await audit.insertAudit(row({ device_id: 'l2' }));
  assert.deepEqual(
    readBuffer(bufferPath).map((e) => e.rows[0].device_id),
    ['l2'],
    'a later append must not join the batch already claimed',
  );
});

test('a crash mid-drain leaves the entries recoverable, not lost', async () => {
  // If the drainer dies after rotating and before uploading, those rows are in the rotated
  // file and nowhere else. The next take must find them.
  const bufferPath = tmpPath();
  const audit = createBufferedAudit({ insert: remoteUnreachable(), update: async () => ({ ok: true }), bufferPath });
  await audit.insertAudit(row({ device_id: 'l1' }));
  takeBufferedCommands(bufferPath); // rotated, then "crash" — never acknowledged

  const again = takeBufferedCommands(bufferPath);
  assert.equal(again.entries.length, 1, 'a rotated-but-undrained file must be picked up again');
});

test('restoreUndrained puts back what could not be uploaded, oldest first', async () => {
  const bufferPath = tmpPath();
  const audit = createBufferedAudit({ insert: remoteUnreachable(), update: async () => ({ ok: true }), bufferPath });
  await audit.insertAudit(row({ device_id: 'l1' }));
  await audit.insertAudit(row({ device_id: 'l2' }));

  const taken = takeBufferedCommands(bufferPath);
  restoreUndrained(bufferPath, taken, taken.entries.slice(1)); // first uploaded, second did not

  const left = readBuffer(bufferPath);
  assert.equal(left.length, 1);
  assert.equal(left[0].rows[0].device_id, 'l2');
});

test('taking from an empty buffer is a no-op, not an error', async () => {
  const taken = takeBufferedCommands(tmpPath());
  assert.deepEqual(taken.entries, []);
});
