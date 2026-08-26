/**
 * Guards the rule that a device the bridge has heard nothing from is not reported as online,
 * and the rule that stops that guard from firing on a healthy but idle meter.
 *
 * WHY: on 2026-08-26 the Pi's address changed out from under every established tuya session
 * (it had fallen back to a different SSID). No FIN was ever sent, so the nodes' connection
 * flags stayed true and three meters reported `online: true` with byte-identical readings for
 * over half an hour while nothing at all was reachable. `buildLatest` also stamps `ts = now`
 * when the device reports no time of its own, so the frontend's staleness watchdog could never
 * fire on them either — an always-fresh timestamp cannot look old.
 *
 * The second rule is the one that took measurement rather than reasoning. `mtr_lo_yellow` and
 * `mtr_co_yellow` are two channels of ONE physical meter: over ten minutes the first sat
 * byte-identical at 0 W while the second swung between 215 V and 229 V. The device was
 * reporting throughout. So the test is ARRIVAL, not value change — keying on "the numbers
 * stopped moving" would mark an idle circuit dead and silently subtract it from the building
 * totals.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLatest, STALE_READING_MS } from '../shared/buildLatest.mjs';
import { DEVICE_REGISTRY, PHASE_MAP } from '../shared/registry.mjs';

const NOW = 1786000000000;
const meter = (over = {}) => ({ v: '220.0', c: '1.000', p: '220.0', e: '1.0000', h: true, ...over });

/** Only the fields the rules under test read; everything else stays at a healthy default. */
const snap = ({ arrivals, energyOver = {}, outletOver = {} } = {}) => ({
  energy: {
    meters: {
      co_yel: meter(energyOver), lo_red: meter(), arec: meter(), lo_yel2: meter(),
    },
    totals: { today: '1', week: '2', month: '3' },
  },
  outlet: { meters: { co1: meter(outletOver) }, state: { status: {} } },
  switch: { state: {}, health: {} },
  aircon: { state: {} },
  ...(arrivals ? { arrivals } : {}),
});

const rowOf = (s, id) => buildLatest(s, DEVICE_REGISTRY, PHASE_MAP, NOW).find((r) => r.device_id === id);

test('a meter with no recent arrival is not online, however healthy its socket claims to be', () => {
  const r = rowOf(snap({ arrivals: { co_yel: NOW - STALE_READING_MS - 1 } }), 'mtr_co_yellow');
  assert.equal(r.online, false, 'a connection flag alone must not be enough');
});

test('an idle meter that is still reporting stays online', () => {
  // The measured false-positive: identical readings, live device. Arrival is recent, so it
  // must survive — being wrong here removes a real circuit from the building totals.
  const r = rowOf(snap({ arrivals: { co_yel: NOW - 20_000 }, energyOver: { p: '0', c: '0' } }), 'mtr_co_yellow');
  assert.equal(r.online, true);
});

test('the timestamp reports when the reading happened, not when it was served', () => {
  // `ts = now` is what let the staleness watchdog sleep through the outage.
  const at = NOW - 45_000;
  const r = rowOf(snap({ arrivals: { co_yel: at } }), 'mtr_co_yellow');
  assert.equal(Date.parse(r.ts), at);
});

test("an outlet's own arrival stamp is preferred over the bridge's observation", () => {
  // The source tab knows better than we do. Both present, they must not disagree silently.
  const own = NOW - 10_000;
  const r = rowOf(snap({ arrivals: { co1: NOW - 400_000 }, outletOver: { t: own } }), 'co1');
  assert.equal(Date.parse(r.ts), own);
  assert.equal(r.online, true);
});

test('an outlet whose own stamp has gone stale is marked offline', () => {
  const r = rowOf(snap({ outletOver: { t: NOW - STALE_READING_MS - 1 } }), 'co1');
  assert.equal(r.online, false);
});

test('with no arrival information at all, behaviour is unchanged', () => {
  // A mock bridge, or a flow predating the tracking step, must not have every meter blink out.
  // Falling back to the old behaviour is the safe direction; inventing offline is not.
  const r = rowOf(snap(), 'mtr_co_yellow');
  assert.equal(r.online, true);
  assert.equal(Date.parse(r.ts), NOW);
});

test('a stale meter is removed from the building totals, not counted from memory', () => {
  const rows = buildLatest(
    snap({ arrivals: { co_yel: NOW - STALE_READING_MS - 1, lo_red: NOW, arec: NOW, lo_yel2: NOW } }),
    DEVICE_REGISTRY, PHASE_MAP, NOW,
  );
  const totals = rows.find((r) => r.device_id === '_totals');
  const live = rows.filter((r) => r.device_id.startsWith('mtr_') && r.online);
  const expected = live.reduce((a, r) => a + (r.power_w ?? 0), 0);
  assert.equal(totals.total_power_w, Math.round(expected * 10) / 10);
  assert.ok(live.length < 4, 'the stale meter should have dropped out');
});

test('the threshold clears the slowest legitimate report by a wide margin', () => {
  // Measured on site: an online outlet's arrival stamp lagged up to 59s, and the energy tab
  // drains its sample buffers on a 5-minute cycle. Erring short under-reports the building.
  assert.ok(STALE_READING_MS >= 300_000, 'must exceed the 5-minute buffer drain cycle');
});
