/**
 * Tests for server/auditedDispatch.mjs — the shared record-then-act path.
 *
 * The load-bearing case is `refuses to dispatch when the audit row cannot be written`:
 * scheduler.mjs used to dispatch first and merely console.error a failed insert, so a
 * scheduled or auto-shed command could move a real relay and never enter the audit trail.
 *
 * No mocking library, matching this repo's house style.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditedDispatch, STATUS_IN_FLIGHT } from './auditedDispatch.mjs';

const LIGHT = { id: 'l1', class: 'switch' };
const OUTLET = { id: 'co1', class: 'outlet_dual' };
const CMD = { device_id: 'l1', action: 'on', socket: null };

function harness(overrides = {}) {
  const calls = { inserts: [], updates: [], dispatches: [], logs: [] };
  const args = {
    device: LIGHT,
    cmd: CMD,
    note: 'schedule due',
    auditRow: { device_id: 'l1', source: 'schedule', requested_by: 'user-1' },
    dispatchEnabled: true,
    dispatchClasses: ['switch'],
    dispatch: async (d, c) => { calls.dispatches.push({ device: d.id, action: c.action }); return { ok: true }; },
    insertAudit: async (row) => { calls.inserts.push(row); return { ok: true, id: 'row-1' }; },
    updateAudit: async (id, patch) => { calls.updates.push({ id, patch }); return { ok: true }; },
    log: (m) => calls.logs.push(m),
    ...overrides,
  };
  return { args, calls };
}

test('records the row BEFORE dispatching, not after', async () => {
  const order = [];
  const { args } = harness({
    insertAudit: async () => { order.push('insert'); return { ok: true, id: 'row-1' }; },
    dispatch: async () => { order.push('dispatch'); return { ok: true }; },
    updateAudit: async () => { order.push('update'); return { ok: true }; },
  });
  await auditedDispatch(args);
  assert.deepEqual(order, ['insert', 'dispatch', 'update']);
});

test('refuses to dispatch when the audit row cannot be written', async () => {
  // The bug. Dispatch-then-record can only detect an incomplete trail; by then the relay
  // has moved. Record-first makes "hardware moved with no audit row" unrepresentable.
  const { args, calls } = harness({
    insertAudit: async () => ({ ok: false, detail: 'HTTP 503' }),
  });
  const result = await auditedDispatch(args);

  assert.equal(result.ok, false);
  assert.match(result.auditFailure, /503/);
  assert.deepEqual(calls.dispatches, [], 'nothing may reach hardware without an audit row');
});

test('opens the row at "dispatching" so an unknown outcome is never mistaken for success', async () => {
  const { args, calls } = harness();
  await auditedDispatch(args);
  assert.equal(calls.inserts[0].status, STATUS_IN_FLIGHT);
  assert.equal(calls.updates[0].patch.status, 'dispatched');
});

test('a row left at "dispatching" is the honest outcome when the update fails', async () => {
  // "failed" is a claim about the hardware we did not earn; the relay may well have moved.
  const { args, calls } = harness({ updateAudit: async () => ({ ok: false, detail: 'HTTP 500' }) });
  const result = await auditedDispatch(args);

  assert.equal(result.ok, true, 'the dispatch itself succeeded');
  assert.equal(result.statusRecorded, false);
  assert.equal(calls.inserts[0].status, STATUS_IN_FLIGHT);
  assert.match(calls.logs.join(' '), /outcome could not be recorded/i);
});

test('records dry_run and never dispatches while the gate is closed', async () => {
  const { args, calls } = harness({ dispatchEnabled: false });
  const result = await auditedDispatch(args);

  assert.equal(result.status, 'dry_run');
  assert.equal(calls.inserts[0].status, 'dry_run');
  assert.deepEqual(calls.dispatches, []);
  assert.deepEqual(calls.updates, [], 'a dry run has no outcome to update to');
});

test('records dry_run for a device class that does not reach hardware, gate open or not', async () => {
  const { args, calls } = harness({ device: OUTLET, dispatchClasses: ['switch'] });
  const result = await auditedDispatch(args);

  assert.equal(result.status, 'dry_run');
  assert.deepEqual(calls.dispatches, []);
});

test('a failed dispatch is recorded as failed, never silently omitted', async () => {
  const { args, calls } = harness({
    dispatch: async () => ({ ok: false, detail: 'bridge endpoint unreachable' }),
  });
  const result = await auditedDispatch(args);

  assert.equal(result.ok, false);
  assert.equal(result.status, 'failed');
  assert.match(result.dispatchFailure, /unreachable/);
  assert.equal(calls.updates[0].patch.status, 'failed');
  assert.match(calls.updates[0].patch.note, /dispatch failed/);
});

test('carries the caller-owned attribution columns through untouched', async () => {
  // Attribution is what makes the trail worth keeping — a row nobody can be traced to is
  // barely better than no row. dab49de made this a hard requirement.
  const { args, calls } = harness({
    auditRow: { device_id: 'l1', source: 'dsm_autoshed', requested_by: 'user-42', socket: 2 },
  });
  await auditedDispatch(args);

  assert.equal(calls.inserts[0].requested_by, 'user-42');
  assert.equal(calls.inserts[0].source, 'dsm_autoshed');
  assert.equal(calls.inserts[0].socket, 2);
});

test('an insert that succeeds without returning an id still blocks nothing but flags itself', async () => {
  const { args, calls } = harness({ insertAudit: async () => ({ ok: true }) });
  const result = await auditedDispatch(args);

  assert.equal(result.ok, true);
  assert.equal(calls.dispatches.length, 1, 'the row exists, so dispatching is allowed');
  assert.equal(result.statusRecorded, false, 'but the outcome could not be attached to it');
  assert.deepEqual(calls.updates, []);
});

/**
 * `via` is recorded as a column, not only inside the note.
 *
 * The note has carried it since the fallback was built, but prose is not queryable — and
 * "which devices have needed the cloud fallback this week" is the question that spots a device
 * going bad before it goes dark. On 2026-08-25 the fallback turned out never to have worked at
 * all (RM-018); now that it does, its use is a leading indicator worth counting.
 */
test('records via=local on the audit row when the local path worked', async () => {
  const { args, calls } = harness({ dispatch: async () => ({ ok: true, via: 'local' }) });
  await auditedDispatch(args);
  assert.equal(calls.updates[0].patch.via, 'local');
});

test('records via=cloud, which is the whole point — the device stopped answering locally', async () => {
  const { args, calls } = harness({
    dispatch: async () => ({ ok: true, via: 'cloud', detail: 'local failed (offline); recovered via cloud' }),
  });
  await auditedDispatch(args);
  assert.equal(calls.updates[0].patch.via, 'cloud');
  // The prose stays as well: the note explains, the column counts.
  assert.match(calls.updates[0].patch.note, /cloud fallback/);
});

test('records via=none when both paths failed', async () => {
  const { args, calls } = harness({
    dispatch: async () => ({ ok: false, via: 'none', detail: 'local: x | cloud: y' }),
  });
  await auditedDispatch(args);
  assert.equal(calls.updates[0].patch.via, 'none');
  assert.equal(calls.updates[0].patch.status, 'failed');
});

test('leaves via unset for a dry run — no path was attempted, and NULL says so', async () => {
  // Distinct from 'none', which is a positive claim that both paths were tried and both failed.
  const { args, calls } = harness({ dispatchEnabled: false });
  await auditedDispatch(args);
  assert.equal(calls.updates.length, 0, 'a dry run writes no outcome patch at all');
  assert.equal('via' in calls.inserts[0], false);
});

/**
 * The outcome still lands when the database does not yet have the `via` column.
 *
 * `supabase/phase18_command_via.sql` is applied by hand, so there is a window — however
 * short — where this code is deployed and the column is not there. PostgREST rejects an
 * UPDATE naming an unknown column, which would fail the outcome patch for EVERY command and
 * leave rows stuck at 'dispatching': the audit trail degrading quietly, to add a nicety.
 *
 * So the patch retries once without `via`. The status and note — the parts that matter — land
 * either way, and the migration simply starts working when it is applied. Order-independent
 * beats a deployment note nobody reads at the right moment.
 */
test('retries the outcome patch without via when the column does not exist yet', async () => {
  const attempts = [];
  const { args, calls } = harness({
    dispatch: async () => ({ ok: true, via: 'cloud' }),
    updateAudit: async (id, patch) => {
      attempts.push(patch);
      if ('via' in patch) return { ok: false, detail: `column "via" of relation "commands" does not exist` };
      return { ok: true };
    },
  });
  const out = await auditedDispatch(args);

  assert.equal(attempts.length, 2, 'tried with via, then without');
  assert.equal('via' in attempts[1], false);
  assert.equal(attempts[1].status, 'dispatched', 'the status still lands');
  assert.equal(out.statusRecorded, true, 'and the caller is told it was recorded');
  assert.ok(calls.logs.some((m) => /via/.test(m)), 'the reason is logged, not swallowed');
});

test('does not retry when the patch failed for some other reason', async () => {
  // A genuine outage must still surface as an unrecorded outcome, not be masked by a retry
  // that drops a field and calls it success.
  const attempts = [];
  const { args } = harness({
    dispatch: async () => ({ ok: true, via: 'local' }),
    updateAudit: async (id, patch) => {
      attempts.push(patch);
      return { ok: false, detail: 'HTTP 503 upstream unavailable' };
    },
  });
  const out = await auditedDispatch(args);
  assert.equal(attempts.length, 1, 'no second attempt for an unrelated failure');
  assert.equal(out.statusRecorded, false);
});
