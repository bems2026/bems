import test from 'node:test';
import assert from 'node:assert/strict';
import { dueCommands, appDayIndex } from './schedulePlan.mjs';

const USER = '11111111-1111-1111-1111-111111111111';
const row = (over = {}) => ({
  device_id: 'l1',
  socket: null,
  rule: { on: '08:00', off: '18:00', days: '1111100' }, // Mon..Fri
  enabled: true,
  updated_by: USER,
  ...over,
});
// 2026-08-24 is a Monday. Local time is what schedules are expressed in.
const at = (iso) => new Date(iso);
const fire = (rows, when, opts) => dueCommands(rows, at(when), { dispatchableDeviceIds: ['l1', 'l2'], ...opts });

test('the app encodes days Mon..Sun but JS getDay() is Sun..Sat — a rotation, not an offset', () => {
  assert.equal(appDayIndex(new Date('2026-08-23T00:00:00')), 6, 'Sunday -> app index 6');
  assert.equal(appDayIndex(new Date('2026-08-24T00:00:00')), 0, 'Monday -> app index 0');
  assert.equal(appDayIndex(new Date('2026-08-29T00:00:00')), 5, 'Saturday -> app index 5');
});

test('fires on at the on time on an enabled day', () => {
  const out = fire([row()], '2026-08-24T08:00:30');
  assert.equal(out.length, 1);
  assert.deepEqual({ d: out[0].device_id, a: out[0].action, s: out[0].source }, { d: 'l1', a: 'on', s: 'schedule' });
});

test('fires off at the off time', () => {
  const out = fire([row()], '2026-08-24T18:00:00');
  assert.equal(out[0].action, 'off');
});

test('does not fire a minute early or late — the match is to the minute', () => {
  assert.equal(fire([row()], '2026-08-24T07:59:59').length, 0);
  assert.equal(fire([row()], '2026-08-24T08:01:00').length, 0);
});

test('Sunday schedules fire on Sunday, not Saturday — the rotation bug this guards against', () => {
  const sundayOnly = row({ rule: { on: '09:00', days: '0000001' } });
  assert.equal(fire([sundayOnly], '2026-08-23T09:00:00').length, 1, 'should fire on Sunday');
  assert.equal(fire([sundayOnly], '2026-08-29T09:00:00').length, 0, 'must NOT fire on Saturday');
});

test('Monday schedules fire on Monday, not Sunday', () => {
  const mondayOnly = row({ rule: { on: '09:00', days: '1000000' } });
  assert.equal(fire([mondayOnly], '2026-08-24T09:00:00').length, 1);
  assert.equal(fire([mondayOnly], '2026-08-23T09:00:00').length, 0);
});

test('does not fire on a day that is switched off', () => {
  assert.equal(fire([row()], '2026-08-29T08:00:00').length, 0, 'Saturday is 0 in 1111100');
});

test('a disarmed schedule never fires', () => {
  assert.equal(fire([row({ enabled: false })], '2026-08-24T08:00:00').length, 0);
});

test('an unset or malformed days value never fires, matching the app parseDays contract of no fabricated default', () => {
  for (const days of [undefined, '', '111', '11111111']) {
    assert.equal(fire([row({ rule: { on: '08:00', days } })], '2026-08-24T08:00:00').length, 0, `days=${JSON.stringify(days)}`);
  }
});

test('a missing on or off time simply has nothing to fire', () => {
  assert.equal(fire([row({ rule: { off: '18:00', days: '1111100' } })], '2026-08-24T08:00:00').length, 0);
  assert.equal(fire([row({ rule: { on: '08:00', days: '1111100' } })], '2026-08-24T18:00:00').length, 0);
});

test('off wins when on and off collide, because failing safe means off', () => {
  const out = fire([row({ rule: { on: '08:00', off: '08:00', days: '1111100' } })], '2026-08-24T08:00:00');
  assert.equal(out.length, 1);
  assert.equal(out[0].action, 'off');
});

test('attributes the command to whoever saved the schedule, which is who actually asked for it', () => {
  assert.equal(fire([row()], '2026-08-24T08:00:00')[0].requested_by, USER);
});

test('skips a schedule with no updated_by rather than inventing an attribution for the audit trail', () => {
  const out = fire([row({ updated_by: null })], '2026-08-24T08:00:00');
  assert.equal(out.length, 0);
});

test('only emits for devices the command path can actually dispatch, so no audit row claims dry_run while Node-RED really switched it', () => {
  const outlet = row({ device_id: 'co1' });
  assert.equal(fire([outlet], '2026-08-24T08:00:00').length, 0, 'co1 is not dispatchable');
  assert.equal(fire([row()], '2026-08-24T08:00:00').length, 1, 'l1 is');
});

test('carries the socket through for a per-socket schedule', () => {
  const out = fire([row({ device_id: 'l2', socket: 2 })], '2026-08-24T08:00:00', { dispatchableDeviceIds: ['l2'] });
  assert.equal(out[0].socket, 2);
});

test('handles several devices due in the same minute', () => {
  const out = fire([row(), row({ device_id: 'l2' })], '2026-08-24T08:00:00');
  assert.deepEqual(out.map((c) => c.device_id).sort(), ['l1', 'l2']);
});
