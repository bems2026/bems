/**
 * The week encoding, tested where it now lives.
 *
 * These assertions used to exist twice — in `src/components/automation/automationMath.test.ts`
 * and in `server/schedulePlan.test.mjs` — against two implementations that claimed to mirror
 * each other. RM-059 collapsed both into `shared/scheduleDays.mjs`; this is the suite that
 * holds it. `server/schedulePlan.test.mjs` keeps its own rotation assertions on purpose, as a
 * check that composing this module into the scheduling rules did not lose the rotation.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY_LABELS,
  DAY_NAMES,
  appDayIndex,
  parseDays,
  formatDays,
  toggleDay,
  anyDaySet,
  hhmm,
  minutesOfDay,
} from '../shared/scheduleDays.mjs';

test('the labels are Monday-first and seven long', () => {
  assert.equal(DAY_LABELS.length, 7);
  assert.equal(DAY_NAMES.length, 7);
  assert.equal(DAY_NAMES[0], 'Monday');
  assert.equal(DAY_NAMES[6], 'Sunday');
});

test('appDayIndex is a ROTATION of getDay(), not an offset', () => {
  // The dates are real and their weekdays checked by hand: 2026-08-23 is a Sunday.
  assert.equal(appDayIndex(new Date('2026-08-23T00:00:00')), 6, 'Sunday -> app index 6');
  assert.equal(appDayIndex(new Date('2026-08-24T00:00:00')), 0, 'Monday -> app index 0');
  assert.equal(appDayIndex(new Date('2026-08-29T00:00:00')), 5, 'Saturday -> app index 5');
});

test('appDayIndex covers all seven days exactly once', () => {
  const seen = new Set();
  for (let d = 23; d <= 29; d += 1) seen.add(appDayIndex(new Date(`2026-08-${d}T12:00:00`)));
  assert.equal(seen.size, 7, 'a rotation is a bijection; an off-by-one would collide');
});

test('an unset or malformed days value is ALL-FALSE, never a fabricated every-day default', () => {
  const allFalse = new Array(7).fill(false);
  assert.deepEqual(parseDays(undefined), allFalse);
  assert.deepEqual(parseDays(null), allFalse);
  assert.deepEqual(parseDays(''), allFalse);
  assert.deepEqual(parseDays('101'), allFalse, 'too short');
  assert.deepEqual(parseDays('11111111'), allFalse, 'too long');
  assert.deepEqual(parseDays(1111100), allFalse, 'a number is not a days string');
});

test('a real 7-char string parses in Mon..Sun order', () => {
  assert.deepEqual(parseDays('1111100'), [true, true, true, true, true, false, false]);
  assert.deepEqual(parseDays('0000001'), [false, false, false, false, false, false, true], 'Sunday only');
});

test('any character that is not "1" is false, so a typo cannot arm a day', () => {
  assert.deepEqual(parseDays('2222222'), new Array(7).fill(false));
});

test('formatDays round-trips through parseDays', () => {
  const days = [true, false, true, false, true, false, true];
  assert.deepEqual(parseDays(formatDays(days)), days);
});

test('toggleDay flips exactly the requested day', () => {
  assert.equal(toggleDay(undefined, 2), '0010000', 'from unset');
  assert.equal(toggleDay('1111100', 0), '0111100', 'back off');
  assert.equal(toggleDay('0000000', 6), '0000001', 'Sunday is the last index, not the first');
});

test('anyDaySet distinguishes a rule that can fire from one that never will', () => {
  assert.equal(anyDaySet('0000000'), false);
  assert.equal(anyDaySet(undefined), false);
  assert.equal(anyDaySet('0000001'), true);
});

test('hhmm zero-pads and reads LOCAL time', () => {
  assert.equal(hhmm(new Date('2026-08-24T07:05:00')), '07:05');
  assert.equal(hhmm(new Date('2026-08-24T23:59:00')), '23:59');
  assert.equal(hhmm(new Date('2026-08-24T00:00:00')), '00:00');
});

test('minutesOfDay returns null for a malformed time, so midnight stays distinguishable', () => {
  assert.equal(minutesOfDay('00:00'), 0, 'midnight is 0, not falsy-as-invalid');
  assert.equal(minutesOfDay('08:30'), 510);
  assert.equal(minutesOfDay('23:59'), 1439);
  assert.equal(minutesOfDay('8:30'), null, 'unpadded hour is not the stored format');
  assert.equal(minutesOfDay('24:00'), null);
  assert.equal(minutesOfDay('12:60'), null);
  assert.equal(minutesOfDay(''), null);
  assert.equal(minutesOfDay(undefined), null);
  assert.equal(minutesOfDay(830), null);
});
