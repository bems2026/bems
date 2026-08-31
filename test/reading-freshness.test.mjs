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
import { DEVICE_REGISTRY, DEVICE_CLASSES, PHASE_MAP, STALE_AFTER_MS_BY_CLASS, TIMING, staleAfterMsFor } from '../shared/registry.mjs';
import { POLL_INTERVAL_S } from '../node-red-bridge/outletPollPlan.mjs';

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

// ---------------------------------------------------------------------------
// Per-device staleness budgets.
//
// WHY: `TIMING.STALE_AFTER_MS` is 30s and was applied to every device class alike, while the
// classes report on cadences an order of magnitude apart. Measured on the Pi 2026-09-01, 119
// samples over 240s: the four live outlets and `mtr_lo_red` reached a maximum reading age of
// 59.9s, because `outletPollPlan` polls at 60s and an idle branch's arrival buffer only grows
// about once a minute. So every outlet was flagged "stale" for roughly half of every minute
// while Node-RED reported it connected throughout — and `isReadingStale` has 15 call sites, so
// the same sawtooth drove the Devices table, the alerts bell, the 3D scene and command
// reconciliation. The budget has to be a property of the device, not one constant.
// ---------------------------------------------------------------------------

test('every device class declares a staleness budget — a class with none would silently inherit a budget nobody chose', () => {
  for (const cls of DEVICE_CLASSES) {
    assert.equal(typeof STALE_AFTER_MS_BY_CLASS[cls], 'number', `no cadence declared for class ${cls}`);
    assert.ok(STALE_AFTER_MS_BY_CLASS[cls] > 0, `cadence for ${cls} must be positive`);
  }
});

test('the outlet budget is longer than the poll that feeds it — the exact bug this replaces', () => {
  // A budget shorter than the poller guarantees the sawtooth. Nothing else forbids
  // reintroducing it, so this is the guard that makes the fix non-regressible.
  const outletBudget = STALE_AFTER_MS_BY_CLASS.outlet_dual;
  assert.ok(
    outletBudget > POLL_INTERVAL_S * 1000,
    `outlet budget ${outletBudget}ms must exceed the ${POLL_INTERVAL_S}s poller that is its only source of fresh timestamps`,
  );
});

test('the meter budget clears the slowest measured meter arrival', () => {
  // `mtr_lo_red` is the near-idle 16W lighting branch: its arrival buffer grows about once a
  // minute, so it is the meter that sets this number, not the three that tick every 2s.
  assert.ok(STALE_AFTER_MS_BY_CLASS.meter > 60_000, 'must clear the 59.7s maximum measured on the Pi');
});

test('classes whose timestamp is synthesized keep the original budget', () => {
  // A switch has no `ctx`, so `buildLatest` stamps `ts = now` and no budget can ever fire for
  // it. Giving it a longer one would imply a freshness guarantee that does not exist.
  for (const cls of ['switch', 'acu_ir', 'sensor_temp_humidity']) {
    assert.equal(STALE_AFTER_MS_BY_CLASS[cls], TIMING.STALE_AFTER_MS, `${cls} should keep the default budget`);
  }
});

test('every device row carries its own budget, so the frontend never has to guess', () => {
  const rows = buildLatest(snap(), DEVICE_REGISTRY, PHASE_MAP, NOW, undefined, STALE_AFTER_MS_BY_CLASS);
  for (const d of DEVICE_REGISTRY) {
    const row = rows.find((r) => r.device_id === d.id);
    assert.equal(row.stale_after_ms, staleAfterMsFor(d), `${d.id} (${d.class}) carries the wrong budget`);
  }
});

test('the totals row carries no per-device budget', () => {
  // `_totals` is not a device and has no cadence of its own; it is stamped `ts = now` on every
  // build. A budget there would be a claim about a device that does not exist.
  const totals = buildLatest(snap(), DEVICE_REGISTRY, PHASE_MAP, NOW, undefined, STALE_AFTER_MS_BY_CLASS).find((r) => r.device_id === '_totals');
  assert.equal(totals.stale_after_ms, undefined);
});

test('a site may override one device without redefining the class', () => {
  // Track B: another building's outlets may poll at a different rate. The override belongs on
  // the device, beside the hardware it describes, not in the file every deployment shares.
  const overridden = { ...DEVICE_REGISTRY.find((d) => d.class === 'outlet_dual'), stale_after_ms: 7000 };
  assert.equal(staleAfterMsFor(overridden), 7000);
});

test('a bridge given no budget table omits the field entirely, so an older frontend is unchanged', () => {
  // Backward compatibility in both directions. `{}` is what a caller predating this parameter
  // effectively passes, and the field must then be absent rather than present-and-null — the
  // frontend distinguishes the two, falling back to its own 30s default only on absent.
  const rows = buildLatest(snap(), DEVICE_REGISTRY, PHASE_MAP, NOW);
  for (const r of rows) assert.equal(r.stale_after_ms, undefined);
});

test('a device that declares its own budget beats its class, on the wire and not just in the helper', () => {
  // The path a site actually takes: an entry in `shared/sites/<id>/devices.mjs` with its own
  // value, because that building's outlets are polled at a different rate. Asserted through
  // `buildLatest` rather than only through `staleAfterMsFor`, since the wire is what the
  // frontend reads and the two resolve the rule independently.
  const outlet = DEVICE_REGISTRY.find((d) => d.class === 'outlet_dual');
  const reg = DEVICE_REGISTRY.map((d) => (d.id === outlet.id ? { ...d, stale_after_ms: 7000 } : d));
  const rows = buildLatest(snap(), reg, PHASE_MAP, NOW, undefined, STALE_AFTER_MS_BY_CLASS);
  assert.equal(rows.find((r) => r.device_id === outlet.id).stale_after_ms, 7000);
  // Its siblings keep the class default, so the override is one device wide and not a silent
  // reassignment of the class.
  const sibling = DEVICE_REGISTRY.find((d) => d.class === 'outlet_dual' && d.id !== outlet.id);
  assert.equal(rows.find((r) => r.device_id === sibling.id).stale_after_ms, STALE_AFTER_MS_BY_CLASS.outlet_dual);
});
