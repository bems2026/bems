/**
 * Guards the meter arrival signal — `buildLatest`'s only evidence of when an energy meter last
 * actually reported, and the input to the `STALE_READING_MS` backstop.
 *
 * Executed rather than pattern-matched: what ships is a source string injected into a Node-RED
 * function node, so running it is the only honest way to know what it does. Same reasoning as
 * the outlet poller's tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runArrivalTracker, TRACK_ARRIVALS_SRC } from '../node-red-bridge/arrivalTracker.mjs';

/** A meter as the energy collector emits it. `n` is the sample-buffer depth. */
const meter = (over = {}) => ({ n: 3, v: '228.3', c: '0.080', p: '18.8', e: '0.1434', h: true, ...over });
const snap = (meters) => ({ energy: { meters } });

test('a meter that reports gets a fresh arrival', () => {
  const store = {};
  const first = runArrivalTracker(store, snap({ co_yel: meter({ n: 1 }) }));
  const second = runArrivalTracker(store, snap({ co_yel: meter({ n: 2 }) }));
  assert.ok(second.co_yel >= first.co_yel);
  assert.notEqual(store.meter_arrivals.co_yel.sig, undefined);
});

test('an unseen meter is stamped now rather than treated as long dead', () => {
  // After a restart nothing has any history, and the safe reading of "no evidence yet" is not
  // "offline" — that would blank the building totals every time Node-RED came back.
  const before = Date.now();
  const arrivals = runArrivalTracker({}, snap({ co_yel: meter() }));
  assert.ok(arrivals.co_yel >= before);
});

test('an idle meter whose values never move still counts as reporting, via the buffer depth', () => {
  // The measured false-positive this whole mechanism exists for: two channels of one physical
  // meter, one byte-identical at 0 W for ten minutes while the other swung 215–229 V. The device
  // was reporting throughout. Keying on "the numbers stopped moving" would mark a healthy idle
  // circuit offline and subtract it from the building totals.
  const store = {};
  const idle = { n: 1, v: '228.0', c: '0.000', p: '0', e: '0.000013', h: true };
  const t1 = runArrivalTracker(store, snap({ lo_red: idle }))['lo_red'];
  const t2 = runArrivalTracker(store, snap({ lo_red: { ...idle, n: 2 } }))['lo_red'];
  assert.ok(t2 >= t1);
  assert.notEqual(store.meter_arrivals.lo_red.sig, [1, '228.0', '0.000', '0', true].join('|'));
});

/**
 * The correction of 2026-09-01, and the reason it matters more than it looks.
 *
 * `e` was in the signature. Measured on the Pi: over fourteen seconds in which `co_yel_arr_v`
 * stayed at length 1 — no message at all — `co_yel_energy` moved 0.14347 → 0.14351 → 0.14355,
 * because the accumulator integrates from each meter's last known power on a timer.
 *
 * So a meter drawing power appeared to report every two seconds while really reporting about
 * once a minute — and, worse, a meter that DIED while drawing power would keep producing
 * "arrivals" from its own frozen wattage. `STALE_READING_MS` is the backstop for when a health
 * flag lies, which is exactly the failure three metered channels were in until that same day.
 * A backstop must not depend on the signal it is backing up.
 */
test('energy alone is NOT an arrival — a timer-integrated field must not fake one', () => {
  const store = {};
  const t1 = runArrivalTracker(store, snap({ co_yel: meter({ e: '0.14347' }) }))['co_yel'];
  const seenAt = store.meter_arrivals.co_yel.at;
  const t2 = runArrivalTracker(store, snap({ co_yel: meter({ e: '0.14355' }) }))['co_yel'];
  assert.equal(t2, seenAt, 'energy moving on its own must leave the arrival time untouched');
  assert.equal(t1, t2);
});

test('the signature line itself does not read the energy field', () => {
  // Belt and braces against a future edit re-adding it: the property above would still pass if
  // `e` were included but happened not to change in the fixture.
  //
  // Scoped to the `sig` assignment rather than the whole source, because the source explains in
  // a comment WHY `m.e` is excluded — and a guard that its own explanation trips is a guard that
  // gets deleted rather than understood. It failed exactly that way when first written.
  const sigLine = TRACK_ARRIVALS_SRC.split('\n').find((l) => l.includes('const sig ='));
  assert.ok(sigLine, 'the signature line should still exist');
  assert.doesNotMatch(sigLine, /m\.e\b/);
  assert.match(sigLine, /m\.n\b/, 'buffer depth is the arrival signal and must stay');
});

test('a real report still registers even while energy is also moving', () => {
  // The fix must not make the tracker blind — a loaded meter reporting normally is the common
  // case, and dropping `e` must not drop the arrival with it.
  const store = {};
  const t1 = runArrivalTracker(store, snap({ co_yel: meter({ n: 1, e: '0.1' }) }))['co_yel'];
  const t2 = runArrivalTracker(store, snap({ co_yel: meter({ n: 2, e: '0.2', p: '19.4' }) }))['co_yel'];
  assert.ok(t2 >= t1);
  assert.notEqual(store.meter_arrivals.co_yel.at, undefined);
});

test('a health flag flipping counts as an arrival, because only a message can flip it', () => {
  const store = {};
  runArrivalTracker(store, snap({ co_yel: meter({ h: true }) }));
  const before = store.meter_arrivals.co_yel.sig;
  runArrivalTracker(store, snap({ co_yel: meter({ h: false }) }));
  assert.notEqual(store.meter_arrivals.co_yel.sig, before);
});

test('each meter is tracked independently', () => {
  const store = {};
  runArrivalTracker(store, snap({ co_yel: meter({ n: 1 }), lo_red: meter({ n: 1 }) }));
  const loRedAt = store.meter_arrivals.lo_red.at;
  runArrivalTracker(store, snap({ co_yel: meter({ n: 2 }), lo_red: meter({ n: 1 }) }));
  assert.equal(store.meter_arrivals.lo_red.at, loRedAt, 'one meter reporting must not refresh another');
});

test('an empty snapshot is survivable rather than throwing inside the flow', () => {
  // A function node that throws stops the whole collector chain, so the readings endpoint would
  // serve nothing at all — a much worse outcome than a missing arrival.
  assert.deepEqual(runArrivalTracker({}, {}), {});
  assert.deepEqual(runArrivalTracker({}, { energy: {} }), {});
});
