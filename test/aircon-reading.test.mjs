/**
 * What `/api/readings/latest` says about the aircon and the outside sensor once the IR hub reports.
 *
 * Both devices read the Aircon tab's one `ac_dash_state` object. Until 2026-09-17 that was
 * harmless because nothing wrote it: the IR blaster was not in the cloud project and the outside
 * sensor has never been installed. Then the blaster was re-paired — a Lasco "Smart IR" hub whose
 * own temperature and humidity dps (101, 102) feed `roomTemp` and `humidity` — and two faults that
 * had been invisible became live:
 *
 *   - `sens_outside_temp` derived `online` from the SAME fields as the aircon, so an uninstalled
 *     sensor would have read ONLINE the moment the hub reported;
 *   - it also took `humidity_pct` from `ac.humidity`, so the Overview's "Outside" tile would have
 *     shown the office's indoor humidity as the weather.
 *
 * And the aircon counted `setTemp` — a value this system COMMANDED, never measured — as evidence
 * of reporting, with a timestamp that was always "now".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEVICE_REGISTRY, PHASE_MAP } from '../shared/registry.mjs';
import { buildLatest, STALE_READING_MS } from '../shared/buildLatest.mjs';

const NOW = 1789630000000; // 2026-09-17, around when the hub was first read

const snap = (aircon) => ({
  energy: { meters: {}, totals: {} },
  outlet: { meters: {}, state: { status: {} } },
  switch: { state: {}, health: {} },
  aircon: { state: aircon },
});

const build = (aircon) => buildLatest(snap(aircon), DEVICE_REGISTRY, PHASE_MAP, NOW);
const find = (rows, id) => rows.find((r) => r.device_id === id);

/** The placeholder the live flow seeds, plus what the hub parser now writes on top of it. */
const hubReporting = (extra = {}) => ({
  power: 'OFFLINE', setTemp: '--', roomTemp: 28.7, humidity: 58, outTemp: '--',
  hubHealth: true, sensedAt: NOW - 20_000,
  ...extra,
});

test('the hub reporting brings the aircon online with room temperature and humidity', () => {
  const acu = find(build(hubReporting()), 'acu_main');
  assert.equal(acu.online, true);
  assert.equal(acu.room_temp_c, 28.7);
  assert.equal(acu.humidity_pct, 58);
});

test('the uninstalled outside sensor stays OFFLINE while the hub reports', () => {
  const outside = find(build(hubReporting()), 'sens_outside_temp');
  assert.equal(outside.online, false);
  assert.equal('temp_c' in outside, false);
});

test('the outside sensor never shows the indoor humidity, even once it reports a temperature', () => {
  const outside = find(build(hubReporting({ outTemp: 31.8 })), 'sens_outside_temp');
  assert.equal(outside.online, true);
  assert.equal(outside.temp_c, 31.8);
  assert.equal('humidity_pct' in outside, false, 'humidity_pct on the outside sensor came from the indoor hub');
});

test('a commanded setpoint alone is not evidence the aircon is reporting', () => {
  const acu = find(build({ power: true, setTemp: 24, roomTemp: '--', humidity: '--', outTemp: '--' }), 'acu_main');
  assert.equal(acu.online, false);
});

test('a hub whose session says disconnected is offline, whatever values it last left', () => {
  const acu = find(build(hubReporting({ hubHealth: false })), 'acu_main');
  assert.equal(acu.online, false);
  // The last value is still shown as last-known, the same rule every metered device follows.
  assert.equal(acu.room_temp_c, 28.7);
});

test('the reading carries the time the hub actually sensed it, not the time it was served', () => {
  const acu = find(build(hubReporting()), 'acu_main');
  assert.equal(acu.ts, '2026-09-17T15:26:20+08:00');
});

test('a hub that stopped sensing past the expiry budget reads offline', () => {
  const acu = find(build(hubReporting({ sensedAt: NOW - STALE_READING_MS - 1 })), 'acu_main');
  assert.equal(acu.online, false);
});

test('the last COMMANDED mode, fan, swing and when they were sent are served', () => {
  const acu = find(
    build(hubReporting({ power: true, setTemp: 24, mode: 'dry', fan: 'high', swing: true, commandedAt: NOW - 60_000, commandVia: 'cloud' })),
    'acu_main',
  );
  assert.equal(acu.state, 'on');
  assert.equal(acu.setpoint_c, 24);
  assert.equal(acu.ac_mode, 'dry');
  assert.equal(acu.ac_fan, 'high');
  assert.equal(acu.ac_swing, true);
  assert.equal(acu.commanded_at, '2026-09-17T15:25:40+08:00');
  assert.equal(acu.command_via, 'cloud');
});

test('a garbled commanded field is omitted rather than served', () => {
  const acu = find(build(hubReporting({ mode: 'turbo', fan: 3, swing: 'yes', commandVia: 'carrier-pigeon' })), 'acu_main');
  for (const k of ['ac_mode', 'ac_fan', 'ac_swing', 'command_via', 'commanded_at']) {
    assert.equal(k in acu, false, `${k} should be absent`);
  }
});

test('the vocabulary inlined into buildLatest is the one shared/acState.mjs declares', async () => {
  // buildLatest is inlined into a Node-RED node and cannot import, so it spells the two lists out.
  // Read its source rather than trusting the comment that says they agree.
  const { readFileSync } = await import('node:fs');
  const { AC_MODES, AC_FANS } = await import('../shared/acState.mjs');
  const src = readFileSync(new URL('../shared/buildLatest.mjs', import.meta.url), 'utf8');
  const lists = [...src.matchAll(/\[((?:'[a-z]+', )+'[a-z]+')\]\.indexOf\(ac\.(mode|fan)\)/g)];
  const byField = Object.fromEntries(lists.map((m) => [m[2], m[1].split(', ').map((s) => s.slice(1, -1))]));
  assert.deepEqual(byField.mode, [...AC_MODES]);
  assert.deepEqual(byField.fan, [...AC_FANS]);
});
