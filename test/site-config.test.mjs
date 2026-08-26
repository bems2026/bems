/**
 * Guards the site module — the thing that makes a second deployment possible at all.
 *
 * Until RM-027 nothing in this system knew which building it was running in. These assertions
 * are deliberately about SHAPE rather than values: a second site will have different values for
 * every field, and a test that pinned this building's numbers would have to be rewritten in
 * order to add one, which is the opposite of the point.
 *
 * The one exception is the timezone/offset agreement test, which exists precisely because the
 * same fact is deliberately recorded twice — see `shared/sites/<id>/site.mjs` for why.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SITE } from '../shared/siteConfig.mjs';
import { SITE as VIA_REGISTRY, DEVICE_REGISTRY, PHASE_MAP, TIMING } from '../shared/registry.mjs';

test('the active site declares every field a deployment needs', () => {
  assert.equal(typeof SITE.id, 'string');
  assert.ok(SITE.id.length > 0, 'a site must have an id');
  assert.equal(typeof SITE.display_name, 'string');
  assert.equal(typeof SITE.timezone, 'string');
  assert.equal(typeof SITE.utc_offset_minutes, 'number');
  assert.ok(Number.isInteger(SITE.utc_offset_minutes), 'offset is whole minutes');
});

test('the id is a slug, because it becomes a database key and a directory name', () => {
  assert.match(SITE.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
});

/**
 * The offset a timezone was actually at, at a given instant. Written out rather than using the
 * `new Date(d.toLocaleString(...))` shortcut, which round-trips through a locale-formatted
 * string and is only accidentally correct.
 */
function measuredOffsetMinutes(timeZone, at) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((wall - at.getTime()) / 60000);
}

test('the declared offset agrees with the declared timezone', () => {
  // Catches exactly the failure this task exists to prevent: one fact recorded in two places,
  // disagreeing. Checked at two instants six months apart so that a site in a DST-observing
  // zone fails here rather than silently mis-stamping half the year.
  for (const iso of ['2026-01-15T00:00:00Z', '2026-07-15T00:00:00Z']) {
    assert.equal(
      measuredOffsetMinutes(SITE.timezone, new Date(iso)),
      SITE.utc_offset_minutes,
      `${SITE.timezone} is not ${SITE.utc_offset_minutes} minutes from UTC at ${iso}`,
    );
  }
});

test('the site is frozen, so nothing can mutate a deployment-wide fact at runtime', () => {
  assert.ok(Object.isFrozen(SITE));
  assert.ok(Object.isFrozen(SITE.policy));
});

test('the registry re-exports the same site object, not a copy', () => {
  assert.equal(VIA_REGISTRY, SITE);
});

test('every existing registry export still works — this task changes nothing else', () => {
  assert.ok(Array.isArray(DEVICE_REGISTRY));
  assert.ok(DEVICE_REGISTRY.length >= 20, 'the built-in fleet is still there');
  assert.deepEqual(Object.keys(PHASE_MAP).sort(), ['blue', 'red', 'yellow']);
  assert.equal(typeof TIMING.WS_PUSH_MS, 'number');
});
