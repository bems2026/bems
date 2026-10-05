/**
 * A level the device has held this week is not an anomaly, and one run is one row — RM-160.
 *
 * THE FLOOD, measured on the edge archive over the seven days to 2026-10-05 (read-only):
 *
 *     1,524 anomalies recorded, every one `both`     about 220 on a full day
 *     co6 502 · C.O Yellow 538 · co5 240 · the other eight 244
 *     co6: on ~5 min, off ~19 min, ~53 cycles a day; 496 of its 502 sit in the 1st or 2nd minute of "on"
 *
 * WHY, by arithmetic rather than by tuning. A level `a` held for k of the 20 window samples, the rest at
 * zero, gives z = sqrt((20 - k) / k): it clears 3.5 only for k <= 1, and the fence stays at +-3 W for
 * k <= 4. So agreement (RM-004) holds for the first and second minute of ANY new level and the third is
 * absorbed — a cycling load raises two alarms per cycle. A replay of `detectAnomaly` over the same
 * readings gives 1,551, so the replay is the live detector.
 *
 * THE GATE, chosen with the operator from replayed alternatives (ADR-0009, amended):
 *   - both tests still agree;
 *   - the level is unfamiliar: fewer than five of the device's own online minutes in the previous seven
 *     days sit within +-15 % (at least +-5 W) of it;
 *   - it starts a run: the device's previous sample was not itself unusual.
 * Replayed on the same week: 1,551 -> 35 rows -> 25 runs.
 *
 *     node --test server/anomalyKnownLevel.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  knownLevelBand, createAnomalyState, detectTick, describeTickAnomalies, levelLookup,
  KNOWN_LEVEL_HORIZON_MS, KNOWN_LEVEL_MIN_SAMPLES, ANOMALY_WINDOW_SIZE,
} from './anomalyStats.mjs';
import { openArchive, ORIGIN } from './archiveDb.mjs';

const T0 = Date.parse('2026-10-05T08:00:00+08:00');
const MIN = 60_000;
const at = (minute) => new Date(T0 + minute * MIN).toISOString();
const reading = (deviceId, minute, watts) => ({ device_id: deviceId, ts: at(minute), power_w: watts, online: true });

/** A full window of a socket at rest, then `levels`, one a minute. */
const idleThen = (deviceId, levels) => [
  ...Array.from({ length: ANOMALY_WINDOW_SIZE }, (_, i) => reading(deviceId, i, 0)),
  ...levels.map((w, i) => reading(deviceId, ANOMALY_WINDOW_SIZE + i, w)),
];

/** Lookups. `history` is { deviceId: [[tsMs, watts], ...] } — what the archive would hold. */
const never = () => 0;
const cannotSay = () => null;
const fromHistory = (history) => (deviceId, tsMs, { lo, hi }) =>
  (history[deviceId] ?? []).filter(([t, w]) => t >= tsMs - KNOWN_LEVEL_HORIZON_MS && t < tsMs && w >= lo && w <= hi).length;

/** co6 as measured: 80 W for five minutes in every twenty-four, for the week before T0. */
function co6Week() {
  const out = [];
  for (let m = -7 * 1440; m < 0; m++) out.push([T0 + m * MIN, ((m % 24) + 24) % 24 < 5 ? 80 : 0]);
  return out;
}

/** Feeds samples through detectTick a tick at a time; returns what was recorded and what was passed over. */
function run(samples, lookup, state = createAnomalyState()) {
  const recorded = [];
  const passed = { knownLevel: 0, sameRun: 0 };
  for (const r of samples) {
    const { entries, passedOver } = detectTick([r], state, lookup);
    recorded.push(...entries);
    passed.knownLevel += passedOver.knownLevel;
    passed.sameRun += passedOver.sameRun;
  }
  return { recorded, passed };
}

// ---------------------------------------------------------------------------
// One run, one row.
// ---------------------------------------------------------------------------

test('a new level is one event, not two: the second minute is the same run', () => {
  // The second minute (k = 1, z = 4.36) is an artefact of the window, not a second thing happening.
  const { recorded, passed } = run(idleThen('co5', [520, 520, 520]), never);
  assert.deepEqual(recorded.map((e) => [e.ts, e.value]), [[at(20), 520]]);
  assert.equal(recorded[0].detection.method, 'both', 'the row still says which tests agreed');
  assert.deepEqual(passed, { knownLevel: 0, sameRun: 1 });
});

test('after a run ends, the next one is recorded again', () => {
  const samples = [
    ...idleThen('co5', [520, 520]),
    ...Array.from({ length: ANOMALY_WINDOW_SIZE }, (_, i) => reading('co5', 22 + i, 0)),
    reading('co5', 42, 520),
  ];
  const { recorded } = run(samples, never);
  assert.deepEqual(recorded.map((e) => e.ts), [at(20), at(42)]);
});

// ---------------------------------------------------------------------------
// A familiar level is not an anomaly.
// ---------------------------------------------------------------------------

test('co6 switching on at the level it holds every cycle is passed over', () => {
  const { recorded, passed } = run(idleThen('co6', [80, 80]), fromHistory({ co6: co6Week() }));
  assert.equal(recorded.length, 0);
  assert.deepEqual(passed, { knownLevel: 2, sameRun: 0 });
});

test('a familiar socket at an unfamiliar level is still recorded: 2 kW on co6', () => {
  // What the noise floor and agreement were kept for — a stuck relay, a heater on the wrong socket.
  const { recorded } = run(idleThen('co6', [2000, 2000]), fromHistory({ co6: co6Week() }));
  assert.deepEqual(recorded.map((e) => e.value), [2000]);
});

test('a level that climbs mid-run from familiar to unfamiliar is recorded at the climb', () => {
  const { recorded, passed } = run(idleThen('co6', [80, 2000]), fromHistory({ co6: co6Week() }));
  assert.deepEqual(recorded.map((e) => [e.ts, e.value]), [[at(21), 2000]]);
  assert.equal(passed.knownLevel, 1);
});

test(`fewer than ${KNOWN_LEVEL_MIN_SAMPLES} familiar minutes is not yet familiar; ${KNOWN_LEVEL_MIN_SAMPLES} is`, () => {
  const minutesAt80 = (n) => ({ co6: Array.from({ length: n }, (_, i) => [T0 - (i + 1) * 60 * MIN, 80]) });
  assert.equal(run(idleThen('co6', [80]), fromHistory(minutesAt80(KNOWN_LEVEL_MIN_SAMPLES - 1))).recorded.length, 1);
  assert.equal(run(idleThen('co6', [80]), fromHistory(minutesAt80(KNOWN_LEVEL_MIN_SAMPLES))).recorded.length, 0);
});

test('a level last held more than seven days ago is unfamiliar again', () => {
  const eightDaysAgo = { co6: Array.from({ length: 10 }, (_, i) => [T0 - 8 * 1440 * MIN + i * MIN, 80]) };
  assert.equal(run(idleThen('co6', [80]), fromHistory(eightDaysAgo)).recorded.length, 1);
});

test('what the gate gives up, stated: a busy circuit falling to zero is passed over when it rests at zero overnight', () => {
  // THE TRADE-OFF, as RM-004 stated its own. A tripped breaker at midday is a familiar level at an unusual hour:
  // every metered device here sits at 0 W for hours most nights, so 0 W is always familiar. In the week to
  // 2026-10-05, 185 falls to zero were flagged and all would be passed over — 37 in office hours, each reading
  // like a load switched off. Recording them would bring back about a hundred runs a week (E-247).
  const nights = { lo_red: Array.from({ length: 600 }, (_, i) => [T0 - 12 * 60 * MIN + i * MIN, 0]) };
  const busy = Array.from({ length: ANOMALY_WINDOW_SIZE }, (_, i) => reading('lo_red', i, 740 + (i % 5) * 4));
  const { recorded, passed } = run([...busy, reading('lo_red', ANOMALY_WINDOW_SIZE, 0)], fromHistory(nights));
  assert.equal(recorded.length, 0);
  assert.equal(passed.knownLevel, 1, 'both tests still flag it; the gate is what passes it over');
});

// ---------------------------------------------------------------------------
// Failing toward visibility, and asking only when it matters.
// ---------------------------------------------------------------------------

test('a lookup that cannot say records the anomaly, exactly as before RM-160', () => {
  // A broken or absent archive must cost noise, never silence.
  const { recorded, passed } = run(idleThen('co6', [80, 80]), cannotSay);
  assert.equal(recorded.length, 1);
  assert.deepEqual(passed, { knownLevel: 0, sameRun: 1 });
});

test('the lookup is asked only when both tests agree', () => {
  // The archive is read on a flagged sample — a few hundred a day — never once per reading.
  let asked = 0;
  const counting = () => { asked += 1; return 0; };
  run(idleThen('co6', [0, 0, 0]), counting);
  assert.equal(asked, 0);
  run(idleThen('co6', [520]), counting);
  assert.equal(asked, 1);
});

test('devices are judged independently within one tick', () => {
  const state = createAnomalyState();
  for (let i = 0; i < ANOMALY_WINDOW_SIZE; i++) detectTick([reading('co5', i, 0), reading('co6', i, 0)], state, never);
  const first = detectTick([reading('co5', 20, 520), reading('co6', 20, 80)], state, never);
  assert.deepEqual(first.entries.map((e) => e.deviceId), ['co5', 'co6']);
  const second = detectTick([reading('co5', 21, 520), reading('co6', 21, 80)], state, never);
  assert.equal(second.entries.length, 0);
  assert.deepEqual(second.passedOver, { knownLevel: 0, sameRun: 2 });
});

// ---------------------------------------------------------------------------
// The band and the journal note.
// ---------------------------------------------------------------------------

test('the band is +-15 % of the value, never narrower than +-5 W', () => {
  assert.deepEqual(knownLevelBand(80), { lo: 68, hi: 92 });
  assert.deepEqual(knownLevelBand(1000), { lo: 850, hi: 1150 });
  assert.deepEqual(knownLevelBand(10), { lo: 5, hi: 15 });
  assert.deepEqual(knownLevelBand(0), { lo: -5, hi: 5 });
});

test('the journal note says what was recorded and what was passed over, and nothing when neither', () => {
  assert.equal(describeTickAnomalies(0, { knownLevel: 0, sameRun: 0 }), '');
  assert.equal(describeTickAnomalies(1, { knownLevel: 0, sameRun: 0 }), ' + 1 anomaly');
  assert.equal(describeTickAnomalies(2, { knownLevel: 0, sameRun: 0 }), ' + 2 anomalies');
  assert.equal(describeTickAnomalies(1, { knownLevel: 0, sameRun: 1 }), ' + 1 anomaly (passed over: 1 in a run already recorded)');
  assert.equal(describeTickAnomalies(0, { knownLevel: 2, sameRun: 0 }), ' (passed over: 2 at a familiar level)');
  assert.equal(describeTickAnomalies(0, { knownLevel: 1, sameRun: 1 }), ' (passed over: 1 at a familiar level, 1 in a run already recorded)');
});

// ---------------------------------------------------------------------------
// The archive answers — a REAL SQLite file in a temp directory, never server/data/.
// ---------------------------------------------------------------------------

function tempArchive(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ibems-known-level-test-'));
  const archive = openArchive(path.join(dir, 'archive.sqlite'));
  // Hooks run in the order they are registered, and Windows will not remove a directory holding an open file.
  t.after(() => archive.close());
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return archive;
}

/** A reading row as the archive stores it, from [tsMs, watts]. */
const archived = (deviceId) => ([tsMs, watts]) => ({
  device_id: deviceId, ts: new Date(tsMs).toISOString(), voltage: null, current: null, power_w: watts,
  energy_kwh_today: null, online: true, total_energy_kwh: null, warn_power_w: null, power_type: null,
  net_state: null, fault: null, capabilities: null,
});

test('levelLookup asks the archive about the week before the sample, and stops at the threshold', (t) => {
  const archive = tempArchive(t);
  const rows = [
    ...Array.from({ length: 6 }, (_, i) => [T0 - (i + 1) * 60 * MIN, 80]), // six minutes at 80 W this week
    [T0 - 8 * 1440 * MIN, 500], // 500 W, but eight days ago
    [T0, 80], // the sample's own minute is not history
  ];
  archive.insertRows('readings', rows.map(archived('co6')), { origin: ORIGIN.ingest });
  const lookup = levelLookup(archive);
  assert.equal(lookup('co6', T0, knownLevelBand(80)), KNOWN_LEVEL_MIN_SAMPLES);
  assert.equal(lookup('co6', T0, knownLevelBand(500)), 0);
  assert.equal(lookup('co5', T0, knownLevelBand(80)), 0);
});

test('levelLookup cannot say without an archive, when the archive throws, or for a sample with no time', () => {
  assert.equal(levelLookup(null)('co6', T0, knownLevelBand(80)), null);
  const broken = { readingsAtLevel: () => { throw new Error('disk I/O error'); } };
  assert.equal(levelLookup(broken)('co6', T0, knownLevelBand(80)), null);
  const answers = { readingsAtLevel: () => KNOWN_LEVEL_MIN_SAMPLES };
  assert.equal(levelLookup(answers)('co6', Number.NaN, knownLevelBand(80)), null);
});

test('end to end on a real archive: co6\'s week makes 80 W familiar, and 2 kW is still recorded', (t) => {
  const archive = tempArchive(t);
  archive.insertRows('readings', co6Week().map(archived('co6')), { origin: ORIGIN.ingest });
  const lookup = levelLookup(archive);
  assert.equal(run(idleThen('co6', [80, 80]), lookup).recorded.length, 0);
  assert.deepEqual(run(idleThen('co6', [2000, 2000]), lookup).recorded.map((e) => e.value), [2000]);
});

// ---------------------------------------------------------------------------
// The daemon's wiring. Read from source, as server/requestBudget.test.mjs does: ingest.mjs exits on
// missing configuration and cannot be imported by a test. The decisions are tested above.
// ---------------------------------------------------------------------------

test('ingest asks its archive about familiar levels, and says in its journal what it passed over', () => {
  const ingest = fs.readFileSync(new URL('./ingest.mjs', import.meta.url), 'utf8');
  assert.match(ingest, /const anomalyState = createAnomalyState\(\);/);
  assert.match(ingest, /detectTick\(candidates, anomalyState, levelLookup\(archive\)\)/, 'a null archive answers "cannot say", which records');
  assert.doesNotMatch(ingest, /detectAnomaly\(/, 'the per-sample loop lives in anomalyStats.mjs, where it is tested');
  const tick = ingest.slice(ingest.indexOf('async function tick('), ingest.indexOf('\n}\n', ingest.indexOf('async function tick(')));
  assert.match(tick, /anomaliesPassedOver = \{ knownLevel: 0, sameRun: 0 \};/, 'a tick that fails early reports nothing stale');
  assert.equal((ingest.match(/describeTickAnomalies\(result\.anomalyCount, anomaliesPassedOver\)/g) ?? []).length, 3,
    'every journal line of a healthy tick says what was recorded and what was passed over');
});
