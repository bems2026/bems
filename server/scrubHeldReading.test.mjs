/**
 * The plan for correcting rows that stored a HELD reading — a value the bridge kept because the device
 * never pushed its change and nothing re-read it (RM-134).
 *
 * The fixture is the live case of 2026-09-22, shortened: L.O Yellow's last genuine report at 07:43:49
 * (39.8 W / 0.446 A, register 25523.556), then rows that repeat it while the lights were off, then the
 * first polled reading at 14:21:47 (0 W / 0 A, `monitor`, register 25523.558). C.O Yellow, channel 1 of
 * the same device, measured the line voltage at the same instants.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planHeldScrub, HELD_COLUMNS, MAX_BOUND_W } from './scrubHeldReading.mjs';

const CODES = { power: 'cur_power2', current: 'cur_current2', voltage: 'cur_voltage2', state: 'device_state2', register: 'today_acc_energy2' };

const row = (ts, { p = 39.8, c = 0.446, v = 226.7, reg = 25523.556, state = 'working', frozen = false, online = true } = {}) => ({
  device_id: 'mtr_lo_yellow',
  ts,
  voltage: v,
  current: c,
  power_w: p,
  energy_kwh_today: 0.290651,
  online,
  capabilities: {
    cur_power2: p, cur_current2: c, cur_voltage2: v, device_state2: state, today_acc_energy2: reg, all_energy: 144985.4,
    ...(frozen ? { measurement_frozen: true, frozen_since: '2026-09-22T11:27:16+08:00' } : {}),
  },
});
const sib = (ts, v) => ({ device_id: 'mtr_co_yellow', ts, voltage: v, online: true });

const genuine = row('2026-09-21T23:43:49+00:00', { v: 227.9 });
const held = [
  row('2026-09-21T23:45:56+00:00', { v: 227.9 }),
  row('2026-09-22T02:00:00+00:00', { v: 213.3 }),
  row('2026-09-22T04:01:11+00:00', { v: 214.2, frozen: true }),
];
const fresh = row('2026-09-22T06:21:47+00:00', { p: 0, c: 0, v: 214.2, reg: 25523.558, state: 'monitor' });
const siblings = [sib('2026-09-21T23:45:56+00:00', 227.9), sib('2026-09-22T02:00:00+00:00', 213.3), sib('2026-09-22T04:01:11+00:00', 225.0)];

const plan = (over = {}) => planHeldScrub({
  start: genuine, rows: held, fresh, siblings, codes: CODES, siblingId: 'mtr_co_yellow', at: '2026-09-22T06:40:00Z', ...over,
});

test('every held row becomes 0 W / 0 A with the sibling channel\'s voltage, and says why', () => {
  const p = plan();
  assert.equal(p.refused, null);
  assert.equal(p.updates.length, 3);
  const u = p.updates[2];
  assert.equal(u.power_w, 0);
  assert.equal(u.current, 0);
  assert.equal(u.voltage, 225.0, 'one voltage measurement serves both clamps; channel 1 read it at this instant');
  assert.equal(u.online, true, 'online is the row\'s own fact, carried for the upsert (23502)');
  assert.equal(u.capabilities.cur_power2, 0);
  assert.equal(u.capabilities.cur_current2, 0);
  assert.equal(u.capabilities.cur_voltage2, 225.0);
  assert.equal(u.capabilities.device_state2, 'monitor', 'the state the device reported when first re-read');
  assert.equal(u.capabilities.measurement_frozen, undefined, 'a corrected row is not a frozen one');
  assert.equal(u.capabilities.frozen_since, undefined);
  assert.equal(u.capabilities.all_energy, 144985.4, 'device-wide dps are left alone');
  const s = u.capabilities.scrub;
  assert.equal(s.rule, 'held_reading');
  assert.equal(s.ticket, 'RM-134');
  assert.deepEqual(s.held, { power_w: 39.8, current: 0.446 });
  assert.equal(s.evidence.register_code, 'today_acc_energy2');
  assert.equal(s.evidence.from.value, 25523.556);
  assert.equal(s.evidence.to.value, 25523.558);
  assert.ok(Math.abs(s.evidence.delta_kwh - 0.002) < 1e-9);
  assert.ok(s.evidence.bound_w > 0 && s.evidence.bound_w < 0.5, `bound ${s.evidence.bound_w}`);
  assert.equal(s.voltage_from, 'mtr_co_yellow');
});

test('the energy column is not in the write — the register-derived day total was right', () => {
  const p = plan();
  for (const u of p.updates) assert.equal('energy_kwh_today' in u, false);
  assert.deepEqual(HELD_COLUMNS, ['device_id', 'ts', 'voltage', 'current', 'power_w', 'online', 'capabilities']);
  for (const u of p.updates) assert.deepEqual(Object.keys(u).sort(), [...HELD_COLUMNS].sort(), 'a bulk upsert needs the same keys on every row');
});

test('refuses when the register moved more than a held-at-zero window allows', () => {
  // 0.05 kWh over 6.6 h is ~7.6 W on average: the circuit was drawing something, so zero would be a lie.
  const p = plan({ fresh: { ...fresh, capabilities: { ...fresh.capabilities, today_acc_energy2: 25523.606 } } });
  assert.match(p.refused, /register/);
  assert.equal(p.updates.length, 0);
  assert.ok(MAX_BOUND_W <= 1);
});

test('refuses when the fresh reading is not 0 W / 0 A — nothing then says the window was at zero', () => {
  const p = plan({ fresh: row('2026-09-22T06:21:47+00:00', { p: 41, c: 0.45, reg: 25523.558 }) });
  assert.match(p.refused, /fresh reading/);
});

test('refuses when a row in the window is not the held pair — it is not one hold', () => {
  const p = plan({ rows: [...held, row('2026-09-22T05:00:00+00:00', { p: 12.5, c: 0.1 })] });
  assert.match(p.refused, /not the held reading/);
});

test('refuses when a row in the window carries a different register — the hold is not what the rows say', () => {
  const p = plan({ rows: [...held, row('2026-09-22T05:00:00+00:00', { reg: 25523.557 })] });
  assert.match(p.refused, /register/);
});

test('a held row with no sibling reading at its instant gets no voltage, and says so', () => {
  const p = plan({ siblings: siblings.slice(1) });
  const u = p.updates[0];
  assert.equal(u.voltage, null);
  assert.equal(u.capabilities.cur_voltage2, null);
  assert.equal(u.capabilities.scrub.voltage_from, null);
});

test('refuses an empty window rather than reporting success', () => {
  assert.match(plan({ rows: [] }).refused, /no rows/);
});
