/**
 * Pure-logic tests for the ingestion daemon — no network, no live bridge, no live
 * Supabase project. Covers `shapeRows.mjs` (bridge payload -> table rows) and
 * `ingestBuffer.mjs` (the local outage queue).
 *
 * The cycle orchestration (fetch, buffer-then-write ordering, which failures reach
 * `ingestion_health`) moved to `server/ingestCycle.mjs` in Phase 9 and is covered directly
 * by `server/ingestCycle.test.mjs`. It was assumed here to need a live Supabase project;
 * it only needed its I/O passed in — and the untested gap was hiding a real bug, where a
 * bridge outage never reached the health row at all.
 *
 *     node --test server/ingest.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { splitLatestPayload, shapeDeviceRows, shapeAnomalyRows } from './shapeRows.mjs';
import { SITE } from '../shared/registry.mjs';
import { appendToBuffer, readBuffer, writeBuffer, bufferCount } from './ingestBuffer.mjs';

/**
 * The instant these fixtures were taken, and one second later.
 *
 * Pinned because `splitLatestPayload` now checks that a row's timestamp could plausibly have
 * been minted by the bridge it came from. Reading the wall clock inside the function would
 * have made every test here start failing a week after it was written — which is the same
 * fault as a bound sized against nothing, one layer up.
 */
const AT = '2026-08-16T09:00:00+08:00';
const AT_MS = Date.parse(AT) + 1000;

test('splitLatestPayload separates per-device readings from the _totals row', () => {
  const latest = [
    { device_id: 'co3', ts: AT, voltage: 221.4, current: 1.82, power_w: 402.1, energy_kwh_today: 3.11, online: true, state: 'on', socket_states: { 1: 'on', 2: 'off' } },
    { device_id: '_totals', ts: AT, energy_kwh_today: 12.41, energy_kwh_week: 61.88, energy_kwh_month: 204.3, total_power_w: 2951, avg_voltage: 223.1, phase_current: { red: 6.1, yellow: 4.9, blue: null } },
  ];

  const { readings, totals } = splitLatestPayload(latest, AT_MS);

  assert.equal(readings.length, 1);
  assert.deepEqual(readings[0], {
    device_id: 'co3', ts: AT,
    voltage: 221.4, current: 1.82, power_w: 402.1, energy_kwh_today: 3.11, online: true,
    // phase28. This entry carries no `capabilities`, so all six are the honest null rather than
    // absent — a column that is never written is indistinguishable from one that does not exist.
    total_energy_kwh: null, warn_power_w: null, power_type: null, net_state: null,
    fault: null, capabilities: null,
  });
  // state/socket_states must NOT appear — readings table has no such column (transient
  // device state per docs/bridge-contract.md, not a reading).
  assert.equal('state' in readings[0], false);
  assert.equal('socket_states' in readings[0], false);

  assert.deepEqual(totals, {
    ts: AT,
    // RM-027: the row names its own site rather than leaning on phase20's column default. The
    // default is transitional and RM-030 drops it; this is what makes that drop a no-op.
    site_id: SITE.id,
    energy_kwh_today: 12.41, energy_kwh_week: 61.88, energy_kwh_month: 204.3,
    // RM-057 — the independent cross-check is stored beside the headline figures. This fixture's
    // payload carries none, and absent must reach the database as null rather than as a zero
    // that would read as "the building's own integration measured nothing".
    energy_kwh_today_integrated: null, energy_kwh_week_integrated: null, energy_kwh_month_integrated: null,
    total_power_w: 2951, avg_voltage: 223.1,
    phase_current_red: 6.1, phase_current_yellow: 4.9, phase_current_blue: null,
  });
});

test('splitLatestPayload stores the RM-057 cross-check when the bridge sends it', () => {
  const { totals } = splitLatestPayload([
    {
      device_id: '_totals', ts: AT,
      energy_kwh_today: 6.014, energy_kwh_week: 21.6, energy_kwh_month: 63.23,
      energy_kwh_today_integrated: 5.997, energy_kwh_week_integrated: 21.53, energy_kwh_month_integrated: 62.93,
      phase_current: { red: 1, yellow: 2, blue: null },
    },
  ], AT_MS);
  // The live figures from 2026-09-08: the branch sum leads the integration by ~0.3%, which is
  // the healthy relationship. Both are kept, because only one of them is independent.
  assert.equal(totals.energy_kwh_today, 6.014);
  assert.equal(totals.energy_kwh_today_integrated, 5.997);
  assert.equal(totals.energy_kwh_week_integrated, 21.53);
  assert.equal(totals.energy_kwh_month_integrated, 62.93);
});

test('splitLatestPayload preserves phase_current.blue as null, never coerces to 0', () => {
  const { totals } = splitLatestPayload([
    { device_id: '_totals', ts: AT, phase_current: { red: 1, yellow: 2, blue: null } },
  ], AT_MS);
  assert.equal(totals.phase_current_blue, null);
});

test('splitLatestPayload defaults missing metering fields to null, not 0 (unmetered devices)', () => {
  const { readings } = splitLatestPayload([
    { device_id: 'l3', ts: AT, online: true, state: 'on' }, // switch — no voltage/current/power/energy
  ], AT_MS);
  assert.deepEqual(readings[0], {
    device_id: 'l3', ts: AT, voltage: null, current: null, power_w: null, energy_kwh_today: null, online: true,
    total_energy_kwh: null, warn_power_w: null, power_type: null, net_state: null,
    fault: null, capabilities: null,
  });
});

test('splitLatestPayload returns totals: null when no _totals entry is present', () => {
  const { totals } = splitLatestPayload([{ device_id: 'l1', ts: AT, online: true }], AT_MS);
  assert.equal(totals, null);
});

test('shapeDeviceRows maps registry fields, defaulting absent optionals to null', () => {
  const rows = shapeDeviceRows([
    { id: 'co3', display_name: 'Outlet 3', class: 'outlet_dual', room: null, dps_map: 'type_b', sockets: ['CO3_1', 'CO3_2'], branch_circuit: 'C.O Yellow', status: 'active' },
  ]);
  assert.deepEqual(rows[0], {
    id: 'co3', display_name: 'Outlet 3', class: 'outlet_dual', room: null,
    dps_map: 'type_b', sockets: ['CO3_1', 'CO3_2'], branch_circuit: 'C.O Yellow', status: 'active',
  });
});

test('shapeAnomalyRows maps a flagged detection into an anomalies table row', () => {
  const rows = shapeAnomalyRows([
    {
      deviceId: 'mtr_arec_acu',
      ts: AT,
      value: 350.5,
      detection: {
        isAnomaly: true, method: 'zscore', zScore: 4.1,
        baselineMean: 120, baselineStddev: 40,
        iqrLower: 20, iqrUpper: 220, sampleCount: 20,
      },
    },
  ]);
  assert.deepEqual(rows[0], {
    device_id: 'mtr_arec_acu', ts: AT, metric: 'power_w', value: 350.5,
    baseline_mean: 120, baseline_stddev: 40, z_score: 4.1,
    iqr_lower: 20, iqr_upper: 220, method: 'zscore', sample_count: 20,
  });
});

test('shapeAnomalyRows returns an empty array for no entries', () => {
  assert.deepEqual(shapeAnomalyRows([]), []);
});

test('ingestBuffer: append then read round-trips entries in order', () => {
  const bufferPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-buf-')), 'buffer.ndjson');
  appendToBuffer(bufferPath, { table: 'readings', rows: [{ device_id: 'co1' }] });
  appendToBuffer(bufferPath, { table: 'building_totals', rows: [{ ts: 't2' }] });

  const entries = readBuffer(bufferPath);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].table, 'readings');
  assert.equal(entries[1].table, 'building_totals');
  assert.equal(bufferCount(bufferPath), 2);
});

test('ingestBuffer: readBuffer on a missing file returns an empty array, not an error', () => {
  const bufferPath = path.join(os.tmpdir(), `ingest-buf-missing-${Date.now()}.ndjson`);
  assert.deepEqual(readBuffer(bufferPath), []);
  assert.equal(bufferCount(bufferPath), 0);
});

test('ingestBuffer: writeBuffer with an empty array deletes the file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-buf-'));
  const bufferPath = path.join(dir, 'buffer.ndjson');
  appendToBuffer(bufferPath, { table: 'readings', rows: [] });
  assert.equal(fs.existsSync(bufferPath), true);

  writeBuffer(bufferPath, []);
  assert.equal(fs.existsSync(bufferPath), false);
  assert.deepEqual(readBuffer(bufferPath), []);
});

test('ingestBuffer: writeBuffer replaces contents wholesale (models draining a partial backlog)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-buf-'));
  const bufferPath = path.join(dir, 'buffer.ndjson');
  appendToBuffer(bufferPath, { table: 'readings', rows: [{ id: 1 }] });
  appendToBuffer(bufferPath, { table: 'readings', rows: [{ id: 2 }] });
  appendToBuffer(bufferPath, { table: 'readings', rows: [{ id: 3 }] });

  // Simulate flushBuffer() draining entry 0 successfully, then failing on entry 1 —
  // it persists entries[1:] (the still-pending ones), not entries[2:].
  const entries = readBuffer(bufferPath);
  writeBuffer(bufferPath, entries.slice(1));

  const remaining = readBuffer(bufferPath);
  assert.equal(remaining.length, 2);
  assert.deepEqual(remaining.map((e) => e.rows[0].id), [2, 3]);
});

// ---------------------------------------------------------------------------
// phase28, through the real transform rather than the promoter alone.
// ---------------------------------------------------------------------------

test('meter capabilities are promoted into columns, each on its own channel', () => {
  // Values read off the live fleet 2026-09-07. mtr_lo_yellow is channel 2 of the SAME physical
  // meter as mtr_co_yellow, so both codes arrive on both entries and each must take its own.
  const caps = { total_energy1: 29508, total_energy2: 14568.196, net_state: 'cloud_net',
                 power_type1: 'normal', add_ele1: 0.01, device_state1: 'working' };
  const { readings } = splitLatestPayload([
    { device_id: 'mtr_co_yellow', ts: AT, power_w: 48.8, online: true, capabilities: caps },
    { device_id: 'mtr_lo_yellow', ts: AT, power_w: 42.4, online: true, capabilities: caps },
  ], AT_MS);

  const co = readings.find((r) => r.device_id === 'mtr_co_yellow');
  const lo = readings.find((r) => r.device_id === 'mtr_lo_yellow');
  assert.equal(co.total_energy_kwh, 29508);
  assert.equal(lo.total_energy_kwh, 14568.196, 'channel 2 takes its own branch, not channel 1s');
  assert.equal(co.net_state, 'cloud_net');
  assert.equal(co.power_type, 'normal');
  // The long tail keeps what was not promoted, and does not repeat what was.
  assert.deepEqual(co.capabilities, { total_energy2: 14568.196, add_ele1: 0.01, device_state1: 'working' });
});

test('an outlet promotes its fault and nothing else', () => {
  const { readings, rejections } = splitLatestPayload([
    { device_id: 'co5', ts: AT, power_w: 0, online: true,
      capabilities: { fault: 0, add_ele: 0.022, child_lock: false } },
  ], AT_MS);
  assert.equal(readings[0].fault, 0);
  assert.equal(readings[0].total_energy_kwh, null);
  assert.deepEqual(readings[0].capabilities, { add_ele: 0.022, child_lock: false });
  assert.deepEqual(rejections, []);
});

test('a capability the catalogue refuses is counted, and the row still lands', () => {
  // The CHECK constraint on net_state would reject the whole BATCH, which then sits at the head
  // of the outage buffer for ever. Refusing it here costs one column.
  const { readings, rejections } = splitLatestPayload([
    { device_id: 'mtr_co_yellow', ts: AT, power_w: 48.8, online: true,
      capabilities: { net_state: 'carrier_pigeon', total_energy1: 29508 } },
  ], AT_MS);
  assert.equal(readings.length, 1, 'the reading is still written');
  assert.equal(readings[0].net_state, null);
  assert.equal(readings[0].total_energy_kwh, 29508);
  assert.equal(rejections.length, 1);
  assert.match(String(rejections[0]), /net_state/);
});

test('a device the registry does not know gets no capability columns at all', () => {
  // Its channel cannot be resolved, and a channel guessed wrong puts one branch circuit's
  // lifetime total on another's history.
  const { readings } = splitLatestPayload([
    { device_id: 'not_a_device', ts: AT, power_w: 5, online: true,
      capabilities: { total_energy1: 999, net_state: 'cloud_net' } },
  ], AT_MS);
  assert.equal('total_energy_kwh' in readings[0], false);
  assert.equal('capabilities' in readings[0], false);
});
