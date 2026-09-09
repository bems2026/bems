/**
 * `resolveDue` and `unfireableRows` — RM-059's stackable, per-socket scheduling.
 *
 * Kept beside `schedulePlan.test.mjs` rather than inside it because those sixteen tests pin
 * `dueCommands`'s RAW matching and must keep passing unchanged; these pin what is built on top
 * of it. The two double-fire cases (5 and 6 below) are the regressions this file exists for.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDue, unfireableRows, UNFIREABLE_REASONS } from './schedulePlan.mjs';

const USER = '11111111-1111-1111-1111-111111111111';

/** A slice of the real registry's shape: class and sockets are all these functions read. */
const DEVICES = new Map([
  ['l1', { id: 'l1', class: 'switch', state_key: 'L1' }],
  ['l2', { id: 'l2', class: 'switch', state_key: 'L2' }],
  ['co5', { id: 'co5', class: 'outlet_dual', sockets: ['CO5_1', 'CO5_2'] }],
  ['co6', { id: 'co6', class: 'outlet_dual', sockets: ['CO6_1', 'CO6_2'] }],
  ['acu_main', { id: 'acu_main', class: 'acu_ir' }],
  ['mtr_lo_red', { id: 'mtr_lo_red', class: 'meter' }],
]);
const DISPATCHABLE = ['l1', 'l2', 'co5', 'co6', 'acu_main'];

let nextId = 0;
const row = (over = {}) => ({
  id: `s${(nextId += 1)}`,
  device_id: 'l1',
  socket: null,
  rule: { on: '08:00', off: '18:00', days: '1111100' }, // Mon..Fri
  enabled: true,
  updated_by: USER,
  ...over,
});

// 2026-08-24 is a Monday.
const due = (rows, when, opts = {}) =>
  resolveDue(rows, new Date(when), { dispatchableDeviceIds: DISPATCHABLE, deviceById: DEVICES, ...opts });

const unfireable = (rows, opts = {}) =>
  unfireableRows(rows, { deviceById: DEVICES, dispatchableDeviceIds: DISPATCHABLE, ...opts });

/** `(device|socket, action)` pairs — the whole observable result of a resolution. */
const shape = (out) => out.map((c) => `${c.device_id}:${c.socket ?? '-'}=${c.action}`);

// ---------------------------------------------------------------------------
// Stacking
// ---------------------------------------------------------------------------

test('a stack of five rules fires only the one matching this minute', () => {
  const stack = [
    row({ rule: { on: '06:00', off: '07:00', days: '1111111' } }),
    row({ rule: { on: '08:00', off: '12:00', days: '1111111' } }),
    row({ rule: { on: '13:00', off: '17:00', days: '1111111' } }),
    row({ rule: { on: '19:00', off: '21:00', days: '1111111' } }),
    row({ rule: { on: '22:00', off: '23:00', days: '1111111' } }),
  ];
  assert.deepEqual(shape(due(stack, '2026-08-24T13:00:10')), ['l1:-=on']);
  assert.deepEqual(shape(due(stack, '2026-08-24T12:00:10')), ['l1:-=off']);
  // The gap between windows fires nothing at all — the whole point of a stack.
  assert.deepEqual(shape(due(stack, '2026-08-24T12:30:00')), []);
});

test('two rules on one switch both saying ON in the same minute produce ONE command', () => {
  const out = due([row({ rule: { on: '08:00', days: '1111100' } }), row({ rule: { on: '08:00', days: '1111100' } })], '2026-08-24T08:00:00');
  assert.equal(out.length, 1);
  assert.equal(out[0].action, 'on');
});

test('OFF wins a same-minute collision ACROSS rows, not only within one', () => {
  // PostgREST returns rows unordered, so without this the outcome would depend on row order.
  // Off is the one that fails safe, exactly as it is inside a single row.
  const onFirst = due([row({ rule: { on: '08:00', days: '1111100' } }), row({ rule: { off: '08:00', days: '1111100' } })], '2026-08-24T08:00:00');
  const offFirst = due([row({ rule: { off: '08:00', days: '1111100' } }), row({ rule: { on: '08:00', days: '1111100' } })], '2026-08-24T08:00:00');
  assert.deepEqual(shape(onFirst), ['l1:-=off']);
  assert.deepEqual(shape(offFirst), ['l1:-=off'], 'row order must not change the answer');
});

test('two rules on one device with different days: only today fires', () => {
  const mon = row({ rule: { on: '08:00', days: '1000000' } });
  const sun = row({ rule: { on: '08:00', days: '0000001' } });
  assert.deepEqual(shape(due([mon, sun], '2026-08-24T08:00:00')), ['l1:-=on'], 'Monday');
  assert.deepEqual(shape(due([mon, sun], '2026-08-23T08:00:00')), ['l1:-=on'], 'Sunday');
});

test('one unattributed rule in a stack does not suppress its siblings', () => {
  const out = due([row({ updated_by: null, rule: { on: '08:00', days: '1111100' } }), row({ rule: { on: '08:00', days: '1111100' } })], '2026-08-24T08:00:00');
  assert.equal(out.length, 1, 'the attributed sibling still fires');
});

test('a rule at 07:59 and one at 08:00 do not both fire at 08:00 — exact-minute matching survives stacking', () => {
  const out = due([row({ rule: { on: '07:59', days: '1111100' } }), row({ rule: { on: '08:00', days: '1111100' } })], '2026-08-24T08:00:00');
  assert.equal(out.length, 1);
});

// ---------------------------------------------------------------------------
// Per-socket addressing and the fan-out
// ---------------------------------------------------------------------------

test('two per-socket rules on one outlet both survive — the sockets are separate targets', () => {
  const out = due(
    [row({ device_id: 'co5', socket: 1, rule: { on: '08:00', days: '1111100' } }), row({ device_id: 'co5', socket: 2, rule: { on: '08:00', days: '1111100' } })],
    '2026-08-24T08:00:00',
  );
  assert.deepEqual(shape(out), ['co5:1=on', 'co5:2=on']);
});

test('sockets on one outlet can be scheduled independently — this is the feature', () => {
  const out = due(
    [row({ device_id: 'co5', socket: 1, rule: { on: '08:00', days: '1111100' } }), row({ device_id: 'co5', socket: 2, rule: { off: '08:00', days: '1111100' } })],
    '2026-08-24T08:00:00',
  );
  assert.deepEqual(shape(out), ['co5:1=on', 'co5:2=off']);
});

test('a legacy socket:null outlet row still fans out to both sockets', () => {
  // A deployment that got the code before the migration must not go inert.
  const out = due([row({ device_id: 'co5', socket: null, rule: { off: '18:00', days: '1111100' } })], '2026-08-24T18:00:00');
  assert.deepEqual(shape(out), ['co5:1=off', 'co5:2=off']);
});

test('REGRESSION: a legacy null row beside its two migrated children gives exactly TWO commands', () => {
  // The four-dispatches-for-two-relays case. Three distinct keys before the fan-out; collapsing
  // first cannot merge them, so the expansion must happen first.
  const out = due(
    [
      row({ device_id: 'co5', socket: null, rule: { off: '18:00', days: '1111100' } }),
      row({ device_id: 'co5', socket: 1, rule: { off: '18:00', days: '1111100' } }),
      row({ device_id: 'co5', socket: 2, rule: { off: '18:00', days: '1111100' } }),
    ],
    '2026-08-24T18:00:00',
  );
  assert.equal(out.length, 2, 'two relays, two commands');
  assert.deepEqual(shape(out), ['co5:1=off', 'co5:2=off']);
});

test('REGRESSION: a null row saying ON and a socket-1 row saying OFF resolve per socket', () => {
  const out = due(
    [
      row({ device_id: 'co5', socket: null, rule: { on: '08:00', days: '1111100' } }),
      row({ device_id: 'co5', socket: 1, rule: { off: '08:00', days: '1111100' } }),
    ],
    '2026-08-24T08:00:00',
  );
  assert.deepEqual(shape(out), ['co5:1=off', 'co5:2=on'], 'off wins socket 1; socket 2 is untouched by it');
});

test('a switch is never fanned out — one command, socket null', () => {
  const out = due([row({ rule: { on: '08:00', days: '1111100' } })], '2026-08-24T08:00:00');
  assert.deepEqual(shape(out), ['l1:-=on']);
  assert.equal(out[0].socket, null);
});

test('the aircon is never fanned out either', () => {
  const out = due([row({ device_id: 'acu_main', rule: { on: '08:00', days: '1111100' } })], '2026-08-24T08:00:00');
  assert.deepEqual(shape(out), ['acu_main:-=on']);
});

test('a socket the device does not have produces NO command', () => {
  const out = due([row({ device_id: 'co5', socket: 3, rule: { on: '08:00', days: '1111100' } })], '2026-08-24T08:00:00');
  assert.deepEqual(out, []);
});

test('socket 0 produces no command — invalid and falsy, the value a truthiness test would miss', () => {
  const out = due([row({ device_id: 'co5', socket: 0, rule: { on: '08:00', days: '1111100' } })], '2026-08-24T08:00:00');
  assert.deepEqual(out, []);
});

test('a socket named on a device with no sockets produces no command', () => {
  const out = due([row({ device_id: 'l1', socket: 1, rule: { on: '08:00', days: '1111100' } })], '2026-08-24T08:00:00');
  assert.deepEqual(out, []);
});

// ---------------------------------------------------------------------------
// Shape of the output
// ---------------------------------------------------------------------------

test('output is sorted by (device_id, socket) and identical across calls', () => {
  const rows = [
    row({ device_id: 'co6', socket: 2, rule: { on: '08:00', days: '1111100' } }),
    row({ device_id: 'l2', rule: { on: '08:00', days: '1111100' } }),
    row({ device_id: 'co5', socket: 2, rule: { on: '08:00', days: '1111100' } }),
    row({ device_id: 'co5', socket: 1, rule: { on: '08:00', days: '1111100' } }),
  ];
  const first = shape(due(rows, '2026-08-24T08:00:00'));
  const second = shape(due([...rows].reverse(), '2026-08-24T08:00:00'));
  assert.deepEqual(first, ['co5:1=on', 'co5:2=on', 'co6:2=on', 'l2:-=on']);
  assert.deepEqual(second, first, 'row order in must not change order out');
});

test('every command carries its rule id, so an audit row can be traced back to one of five', () => {
  const out = due([row({ id: 'rule-xyz', rule: { on: '08:00', days: '1111100' } })], '2026-08-24T08:00:00');
  assert.equal(out[0].schedule_id, 'rule-xyz');
});

test('a fanned-out command keeps the id of the row it came from', () => {
  const out = due([row({ id: 'rule-abc', device_id: 'co5', socket: null, rule: { on: '08:00', days: '1111100' } })], '2026-08-24T08:00:00');
  assert.deepEqual(out.map((c) => c.schedule_id), ['rule-abc', 'rule-abc']);
});

test('an unknown device_id does not throw — this must not be a second place that can crash the loop', () => {
  assert.doesNotThrow(() => due([row({ device_id: 'ghost' })], '2026-08-24T08:00:00'));
  assert.deepEqual(due([row({ device_id: 'ghost' })], '2026-08-24T08:00:00'), []);
});

test('accepts a plain object for deviceById as well as a Map', () => {
  const out = resolveDue([row({ rule: { on: '08:00', days: '1111100' } })], new Date('2026-08-24T08:00:00'), {
    dispatchableDeviceIds: DISPATCHABLE,
    deviceById: Object.fromEntries(DEVICES),
  });
  assert.equal(out.length, 1);
});

test('the Mon..Sun rotation survives composition into resolveDue', () => {
  // Composing dueCommands into a bigger function is exactly where a rotation gets quietly lost.
  const sundayOnly = row({ rule: { on: '08:00', days: '0000001' } });
  assert.equal(due([sundayOnly], '2026-08-23T08:00:00').length, 1, 'Sunday fires');
  assert.equal(due([sundayOnly], '2026-08-22T08:00:00').length, 0, 'Saturday does not');
  assert.equal(due([sundayOnly], '2026-08-24T08:00:00').length, 0, 'Monday does not');
});

// ---------------------------------------------------------------------------
// unfireableRows
// ---------------------------------------------------------------------------

test('reports an unattributed rule — one dead rule in a stack of five is otherwise invisible', () => {
  const out = unfireable([row({ id: 'a', updated_by: null }), row({ id: 'b' })]);
  assert.deepEqual(out.map((r) => [r.id, r.reason]), [['a', 'no_attribution']]);
});

test('reports a rule with no days set', () => {
  assert.equal(unfireable([row({ rule: { on: '08:00', days: '0000000' } })])[0].reason, 'malformed_days');
  assert.equal(unfireable([row({ rule: { on: '08:00', days: 'xyz' } })])[0].reason, 'malformed_days');
});

test('reports an unfinished rule with neither time, separately from a malformed one', () => {
  assert.equal(unfireable([row({ rule: { days: '1111100' } })])[0].reason, 'no_times');
});

test('reports a socket the device does not have, and one named on a device with no sockets', () => {
  assert.equal(unfireable([row({ device_id: 'co5', socket: 3 })])[0].reason, 'socket_not_on_device');
  assert.equal(unfireable([row({ device_id: 'l1', socket: 1 })])[0].reason, 'socket_not_applicable');
});

test('reports a device with no dispatch path, and one not in the registry at all', () => {
  assert.equal(unfireable([row({ device_id: 'mtr_lo_red' })])[0].reason, 'not_dispatchable');
  assert.equal(unfireable([row({ device_id: 'ghost' })])[0].reason, 'unknown_device');
});

test('a DISARMED rule is not reported — that is a state the operator chose, not a fault', () => {
  assert.deepEqual(unfireable([row({ enabled: false, updated_by: null })]), []);
});

test('a healthy stack reports nothing', () => {
  const healthy = [row(), row({ device_id: 'co5', socket: 1 }), row({ device_id: 'co5', socket: 2 }), row({ device_id: 'acu_main' })];
  assert.deepEqual(unfireable(healthy), []);
});

test('every reason it can emit is declared in UNFIREABLE_REASONS, so the UI mirror cannot drift', () => {
  const emitted = new Set(
    unfireable([
      row({ updated_by: null }),
      row({ rule: { on: '08:00', days: '0000000' } }),
      row({ rule: { days: '1111100' } }),
      row({ device_id: 'co5', socket: 3 }),
      row({ device_id: 'l1', socket: 1 }),
      row({ device_id: 'mtr_lo_red' }),
      row({ device_id: 'ghost' }),
    ]).map((r) => r.reason),
  );
  assert.equal(emitted.size, UNFIREABLE_REASONS.length, 'every declared reason is reachable');
  for (const r of emitted) assert.ok(UNFIREABLE_REASONS.includes(r), `${r} is not declared`);
});
