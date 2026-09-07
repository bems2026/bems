/**
 * phase28: what a device reports beyond volts, amps and watts, on its way into `readings`.
 *
 * Four kinds of question could not be asked of the history at all, and all four were already on
 * the wire — the devices have always reported them and the daemon threw them away every minute:
 * which branch tripped its power warning, what a meter's lifetime total is, whether an outlet
 * reported a fault before it went dark, and whether a device was on the cloud or the local
 * segment when it stopped answering.
 *
 * MEASURED ON THE LIVE FLEET 2026-09-07, which is what these fixtures are built from:
 *   meters   net_state='cloud_net' on all four, total_energy{ch} on all four,
 *            power_type1='normal' on mtr_co_yellow, warn_power on none of them right now
 *   outlets  fault=0, and none of the other four
 *   switches none of the five — a light switch has no metering at all
 *
 * TWO THINGS THIS HAS TO GET RIGHT, and they are the reasons it is not a field copy.
 *
 * 1. THE CHANNEL. `total_energy1` and `total_energy2` are two different branch circuits on one
 *    physical meter. Resolving the code by hand would eventually attribute one circuit's
 *    lifetime total to its neighbour — the failure `capabilityForDevice`'s own header describes,
 *    and the reason CLAUDE.md says capability codes are keyed by PRODUCT, not by class.
 *
 * 2. THE CLOSED VOCABULARIES. `power_type` and `net_state` carry CHECK constraints. A value
 *    outside them does not fail one field — PostgREST rejects the whole batch, `writeOrBuffer`
 *    buffers it, and `flushBuffer` replays it at the head of every subsequent cycle for ever.
 *    That is the wedge `server/scrubTelemetry.mjs` was written to stop, so an unknown value is
 *    refused HERE, counted like any other rejection, and the row still lands.
 *
 *     node --test server/readingCapabilities.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  promoteCapabilities, PHASE28_COLUMNS,
  isMissingCapabilityColumnError, withoutCapabilityColumns,
} from './readingCapabilities.mjs';
import { DEVICE_REGISTRY } from '../shared/registry.mjs';

const device = (id) => DEVICE_REGISTRY.find((d) => d.id === id);
const promote = (id, caps) => {
  const rejections = [];
  const row = promoteCapabilities(device(id), caps, rejections);
  return { row, rejections };
};

// ---------------------------------------------------------------------------
// The channel. This is the one that would silently mis-attribute a circuit.
// ---------------------------------------------------------------------------

test('a channel-1 meter promotes its OWN total, not the other branch', () => {
  const { row } = promote('mtr_co_yellow', { total_energy1: 29508, total_energy2: 14568.196 });
  assert.equal(row.total_energy_kwh, 29508);
});

test('a channel-2 meter promotes its OWN total, from the same physical device', () => {
  // mtr_co_yellow and mtr_lo_yellow are two channels of one meter. Reading the wrong half here
  // would put one branch circuit's lifetime consumption on the other's history.
  const { row } = promote('mtr_lo_yellow', { total_energy1: 29508, total_energy2: 14568.196 });
  assert.equal(row.total_energy_kwh, 14568.196);
});

test('power_type and warn_power follow the channel too', () => {
  assert.equal(promote('mtr_co_yellow', { power_type1: 'warn', power_type2: 'normal' }).row.power_type, 'warn');
  assert.equal(promote('mtr_lo_yellow', { power_type1: 'warn', power_type2: 'normal' }).row.power_type, 'normal');
  assert.equal(promote('mtr_co_yellow', { warn_power1: 1500, warn_power2: 90 }).row.warn_power_w, 1500);
  assert.equal(promote('mtr_lo_yellow', { warn_power1: 1500, warn_power2: 90 }).row.warn_power_w, 90);
});

test('net_state has no channel and is taken as-is', () => {
  for (const id of ['mtr_co_yellow', 'mtr_lo_yellow', 'mtr_lo_red', 'mtr_arec_acu']) {
    assert.equal(promote(id, { net_state: 'cloud_net' }).row.net_state, 'cloud_net', id);
  }
});

// ---------------------------------------------------------------------------
// Absent is not zero — the same rule as everywhere else.
// ---------------------------------------------------------------------------

test("an outlet reports fault and nothing else, and the rest stay null", () => {
  const { row, rejections } = promote('co5', { fault: 0, add_ele: 0.022, child_lock: false });
  assert.equal(row.fault, 0, 'zero faults is a reading, not an absence');
  assert.equal(row.total_energy_kwh, null);
  assert.equal(row.warn_power_w, null);
  assert.equal(row.power_type, null);
  assert.equal(row.net_state, null);
  assert.deepEqual(rejections, [], 'not reporting something is not a rejection');
});

test('a light switch promotes nothing at all', () => {
  const { row, rejections } = promote('l7', { switch_1: true, relay_status: 'off', countdown_1: 0 });
  for (const col of ['total_energy_kwh', 'warn_power_w', 'power_type', 'net_state', 'fault']) {
    assert.equal(row[col], null, col);
  }
  assert.deepEqual(rejections, []);
});

test('a device with no capabilities at all yields every column null', () => {
  for (const caps of [null, undefined, {}]) {
    const { row } = promote('mtr_co_yellow', caps);
    for (const col of PHASE28_COLUMNS) assert.equal(row[col], null, `${col} for ${JSON.stringify(caps)}`);
  }
});

// ---------------------------------------------------------------------------
// The closed vocabularies. A bad value must not wedge ingestion.
// ---------------------------------------------------------------------------

test('a power_type outside the catalogue is refused, and the row still lands', () => {
  // The CHECK constraint would reject the whole BATCH, not the field — and the batch then sits
  // at the head of the outage buffer for ever. Refusing it here costs one column.
  const { row, rejections } = promote('mtr_co_yellow', { power_type1: 'ludicrous', total_energy1: 5 });
  assert.equal(row.power_type, null);
  assert.equal(row.total_energy_kwh, 5, 'the rest of the row is unaffected');
  assert.equal(rejections.length, 1);
  assert.match(String(rejections[0]), /power_type/);
});

test('a net_state outside the catalogue is refused the same way', () => {
  const { row, rejections } = promote('mtr_co_yellow', { net_state: 'carrier_pigeon' });
  assert.equal(row.net_state, null);
  assert.equal(rejections.length, 1);
});

test('every value the live fleet actually reports is accepted', () => {
  // Measured, not assumed. If the catalogue and the hardware ever drift, this is what says so.
  assert.equal(promote('mtr_co_yellow', { net_state: 'cloud_net' }).row.net_state, 'cloud_net');
  assert.equal(promote('mtr_co_yellow', { power_type1: 'normal' }).row.power_type, 'normal');
  assert.equal(promote('mtr_co_yellow', { power_type1: 'warn' }).row.power_type, 'warn');
  for (const v of ['cloud_net', 'local_net', 'no_net']) {
    assert.equal(promote('mtr_lo_red', { net_state: v }).row.net_state, v, v);
  }
});

test('a non-numeric total or fault is refused rather than coerced', () => {
  assert.equal(promote('mtr_co_yellow', { total_energy1: 'lots' }).row.total_energy_kwh, null);
  assert.equal(promote('co5', { fault: 'ov_cr' }).row.fault, null);
  assert.equal(promote('co5', { fault: 1.5 }).row.fault, null, 'the column is an integer bitmap');
});

// ---------------------------------------------------------------------------
// The long tail.
// ---------------------------------------------------------------------------

test('the jsonb carries every OTHER capability, not a second copy of the columns', () => {
  // The migration says so in as many words: "Every other decoded capability". Storing a value
  // twice invites the two to disagree.
  const caps = { total_energy1: 29508, net_state: 'cloud_net', power_type1: 'normal',
                 add_ele1: 0.01, device_state1: 'working', all_energy: 44076.458 };
  const { row } = promote('mtr_co_yellow', caps);
  assert.deepEqual(row.capabilities, { add_ele1: 0.01, device_state1: 'working', all_energy: 44076.458 });
});

test('a refused value still leaves the long tail intact', () => {
  const { row } = promote('mtr_co_yellow', { net_state: 'nonsense', add_ele1: 0.01 });
  assert.deepEqual(row.capabilities, { add_ele1: 0.01 });
});

test('an empty long tail is null, not an empty object', () => {
  // `{}` in a jsonb column reads as "reported nothing", which is a different claim from
  // "reported nothing beyond what was promoted". Null is the honest one.
  assert.equal(promote('co5', { fault: 0 }).row.capabilities, null);
  assert.equal(promote('mtr_co_yellow', {}).row.capabilities, null);
});

// ---------------------------------------------------------------------------
// The migration-order hazard — the one the roadmap says stops ingestion outright.
// ---------------------------------------------------------------------------

test('a PostgREST unknown-column failure names a phase28 column and is recognised', () => {
  for (const col of PHASE28_COLUMNS) {
    assert.equal(isMissingCapabilityColumnError(
      new Error(`readings -> 400 {"code":"PGRST204","message":"Could not find the '${col}' column of 'readings' in the schema cache"}`),
    ), true, col);
  }
});

test('a real outage is NOT mistaken for the missing migration', () => {
  // Downgrading on a genuine failure would silently stop recording capabilities for the life of
  // the process, having been told the migration was missing when it was not.
  for (const err of [
    new Error('fetch failed'),
    new Error('readings -> 503'),
    new Error("PGRST204 could not find the 'power_w' column"),
    null, undefined,
  ]) {
    assert.equal(isMissingCapabilityColumnError(err), false, String(err));
  }
});

test('stripping the columns leaves a row the pre-phase28 schema accepts', () => {
  const rows = [{
    device_id: 'co5', ts: 't', voltage: 231, current: 0, power_w: 0, energy_kwh_today: 1, online: true,
    total_energy_kwh: null, warn_power_w: null, power_type: null, net_state: null, fault: 0,
    capabilities: { add_ele: 0.02 },
  }];
  const stripped = withoutCapabilityColumns(rows);
  assert.deepEqual(Object.keys(stripped[0]).sort(),
    ['current', 'device_id', 'energy_kwh_today', 'online', 'power_w', 'ts', 'voltage']);
  assert.equal(stripped[0].power_w, 0, 'a real zero survives the strip');
});

test('stripping does not mutate the rows it was given', () => {
  // They are about to be retried, and on the next tick they are the live payload.
  const rows = [{ device_id: 'co5', ts: 't', fault: 0, capabilities: { a: 1 } }];
  withoutCapabilityColumns(rows);
  assert.equal(rows[0].fault, 0);
  assert.deepEqual(rows[0].capabilities, { a: 1 });
});
