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
import { appendToBuffer, readBuffer, writeBuffer, bufferCount } from './ingestBuffer.mjs';

test('splitLatestPayload separates per-device readings from the _totals row', () => {
  const latest = [
    { device_id: 'co3', ts: '2026-08-16T09:00:00+08:00', voltage: 221.4, current: 1.82, power_w: 402.1, energy_kwh_today: 3.11, online: true, state: 'on', socket_states: { 1: 'on', 2: 'off' } },
    { device_id: '_totals', ts: '2026-08-16T09:00:00+08:00', energy_kwh_today: 12.41, energy_kwh_week: 61.88, energy_kwh_month: 204.3, total_power_w: 2951, avg_voltage: 223.1, phase_current: { red: 6.1, yellow: 4.9, blue: null } },
  ];

  const { readings, totals } = splitLatestPayload(latest);

  assert.equal(readings.length, 1);
  assert.deepEqual(readings[0], {
    device_id: 'co3', ts: '2026-08-16T09:00:00+08:00',
    voltage: 221.4, current: 1.82, power_w: 402.1, energy_kwh_today: 3.11, online: true,
  });
  // state/socket_states must NOT appear — readings table has no such column (transient
  // device state per docs/bridge-contract.md, not a reading).
  assert.equal('state' in readings[0], false);
  assert.equal('socket_states' in readings[0], false);

  assert.deepEqual(totals, {
    ts: '2026-08-16T09:00:00+08:00',
    energy_kwh_today: 12.41, energy_kwh_week: 61.88, energy_kwh_month: 204.3,
    total_power_w: 2951, avg_voltage: 223.1,
    phase_current_red: 6.1, phase_current_yellow: 4.9, phase_current_blue: null,
  });
});

test('splitLatestPayload preserves phase_current.blue as null, never coerces to 0', () => {
  const { totals } = splitLatestPayload([
    { device_id: '_totals', ts: 't', phase_current: { red: 1, yellow: 2, blue: null } },
  ]);
  assert.equal(totals.phase_current_blue, null);
});

test('splitLatestPayload defaults missing metering fields to null, not 0 (unmetered devices)', () => {
  const { readings } = splitLatestPayload([
    { device_id: 'l3', ts: 't', online: true, state: 'on' }, // switch — no voltage/current/power/energy
  ]);
  assert.deepEqual(readings[0], {
    device_id: 'l3', ts: 't', voltage: null, current: null, power_w: null, energy_kwh_today: null, online: true,
  });
});

test('splitLatestPayload returns totals: null when no _totals entry is present', () => {
  const { totals } = splitLatestPayload([{ device_id: 'l1', ts: 't', online: true }]);
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
      ts: '2026-08-16T09:00:00+08:00',
      value: 350.5,
      detection: {
        isAnomaly: true, method: 'zscore', zScore: 4.1,
        baselineMean: 120, baselineStddev: 40,
        iqrLower: 20, iqrUpper: 220, sampleCount: 20,
      },
    },
  ]);
  assert.deepEqual(rows[0], {
    device_id: 'mtr_arec_acu', ts: '2026-08-16T09:00:00+08:00', metric: 'power_w', value: 350.5,
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
