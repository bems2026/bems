/**
 * A device-level intent expanded into the per-target commands the hardware actually takes.
 *
 * WHY. `shared/commands.mjs` has always said an outlet command MUST name a socket — *"There is no
 * whole-outlet relay... A UI wanting 'turn off Outlet 3' fans out to two commands itself; that's
 * the truth, not a shortcut."* The Control page does exactly that. The two UNATTENDED callers
 * never did:
 *
 *   - `src/lib/supabaseConfig.ts:122` reads and writes schedules `.is('socket', null)` only, so
 *     the Automation page cannot express a socket at all;
 *   - `server/shedPlan.mjs:62` hard-codes `socket: null` on every shed target.
 *
 * `socket: null` resolves correctly for a switch (it becomes `state_key`) and is refused for an
 * outlet, measured:
 *
 *     l7  socket:null  ->  ok:true    target "L7"
 *     co5 socket:null  ->  ok:false   socket_required
 *
 * REPORTED FROM THE BUILDING 2026-09-07: Light Switch 7 passed every test including its schedule;
 * Outlet 5 passed manual and remote control and its schedule never fired. It was never about
 * Outlet 5 — no outlet could be scheduled, and none could be shed.
 *
 * THE SHED HALF IS THE SERIOUS ONE. All 14 devices are tiered: `group_1` is the seven switches
 * (~16 W), `group_2` and `group_3` are all seven outlets (561 W, 61% of metered demand). Arming
 * auto-shed would shed the lighting, escalate through both outlet tiers, fail silently on every
 * one, and stay over the 2.21 kW ceiling.
 *
 * ============================================================================
 * BOTH CALLER FACTS ABOVE STOPPED BEING TRUE ON 2026-09-09 (RM-066, RM-067), and this header is
 * kept rather than rewritten because the reasoning is why `fanOutCommand` exists at all.
 *
 *   - The Automation page expresses a socket now. `supabase/phase33_schedules_stackable.sql`
 *     dropped `unique (device_id)`, the client no longer filters `.is('socket', null)`, and an
 *     outlet appears as two independently schedulable targets.
 *   - `server/shedPlan.mjs` enumerates shed targets PER SOCKET and every command it emits already
 *     names one, so `server/scheduler.mjs` no longer calls `fanOutCommand` on either path.
 *
 * `fanOutCommand` ITSELF IS UNCHANGED and every assertion below still holds. It is now the
 * safety net rather than the mechanism: a legacy or hand-written `socket: null` outlet row must
 * still expand to both relays rather than going inert. The expansion happens inside
 * `server/schedulePlan.mjs`'s `resolveDue`, where it is followed by a per-target collapse —
 * because a legacy row surviving beside its two migrated children is three distinct keys, and
 * expanding after a collapse turns that into four dispatches for two relays. See `resolveDue`'s
 * docblock and the two regression tests in `server/resolveDue.test.mjs`.
 * ============================================================================
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fanOutCommand } from '../shared/commands.mjs';
import { DEVICE_REGISTRY } from '../shared/registry.mjs';

const dev = (id) => DEVICE_REGISTRY.find((d) => d.id === id);

test('a switch command passes through untouched — the case that works today', () => {
  // l7 is the control case. It passed all six of its tests on real hardware; this must not move.
  const cmd = { device_id: 'l7', socket: null, action: 'on', source: 'schedule' };
  assert.deepEqual(fanOutCommand(cmd, dev('l7')), [cmd]);
});

test('an outlet command with no socket becomes one command per socket', () => {
  const out = fanOutCommand({ device_id: 'co5', socket: null, action: 'off' }, dev('co5'));
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((c) => c.socket), [1, 2]);
});

test('the fanned-out commands are the ones the command layer accepts', () => {
  // The whole point: before this, every one of these was refused with socket_required.
  const out = fanOutCommand({ device_id: 'co5', socket: null, action: 'off' }, dev('co5'));
  for (const c of out) {
    assert.equal(typeof c.socket, 'number');
    assert.ok(c.socket >= 1 && c.socket <= 2);
  }
});

test('an outlet command that already names a socket is left alone', () => {
  // The Control page fans out for itself. Expanding an already-targeted command would double it.
  const cmd = { device_id: 'co5', socket: 2, action: 'on' };
  assert.deepEqual(fanOutCommand(cmd, dev('co5')), [cmd]);
});

test('socket 0 is not mistaken for absent', () => {
  // 0 is not a valid socket, but it is falsy — a truthiness test here would silently fan out.
  const out = fanOutCommand({ device_id: 'co5', socket: 0, action: 'on' }, dev('co5'));
  assert.deepEqual(out, [{ device_id: 'co5', socket: 0, action: 'on' }]);
});

test('every other field is carried onto each fanned-out command', () => {
  // requested_by is NOT NULL on the audit table, and source is how a shed is told from a schedule.
  const out = fanOutCommand(
    { device_id: 'co5', socket: null, action: 'off', requested_by: 'u-1', source: 'dsm_autoshed' },
    dev('co5'),
  );
  for (const c of out) {
    assert.equal(c.action, 'off');
    assert.equal(c.requested_by, 'u-1');
    assert.equal(c.source, 'dsm_autoshed');
    assert.equal(c.device_id, 'co5');
  }
});

test('the socket count comes from the device, not from a hard-coded 2', () => {
  const out = fanOutCommand({ device_id: 'co5', socket: null, action: 'off' }, dev('co5'));
  assert.equal(out.length, dev('co5').sockets.length);
});

test('order is stable, lowest socket first', () => {
  const a = fanOutCommand({ device_id: 'co1', socket: null, action: 'off' }, dev('co1'));
  const b = fanOutCommand({ device_id: 'co1', socket: null, action: 'off' }, dev('co1'));
  assert.deepEqual(a.map((c) => c.socket), [1, 2]);
  assert.deepEqual(a, b);
});

test('an acu_ir command passes through — it has one target and no sockets', () => {
  const cmd = { device_id: 'acu_main', socket: null, action: 'on' };
  assert.deepEqual(fanOutCommand(cmd, dev('acu_main')), [cmd]);
});

test('an unknown device passes through rather than throwing', () => {
  // The caller resolves the device and already handles a miss; this must not be a second place
  // that can crash the scheduler loop.
  const cmd = { device_id: 'nope', socket: null, action: 'on' };
  assert.deepEqual(fanOutCommand(cmd, undefined), [cmd]);
});

test('a shed of group_2 becomes six commands from three outlets', () => {
  // The measured tier. Before this it was three refusals and 561 W left running.
  const group2 = ['co1', 'co4', 'co5'];
  const shed = group2.flatMap((id) =>
    fanOutCommand({ device_id: id, socket: null, action: 'off', source: 'dsm_autoshed' }, dev(id)));
  assert.equal(shed.length, 6);
  assert.deepEqual([...new Set(shed.map((c) => c.device_id))].sort(), group2);
});
