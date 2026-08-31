/**
 * `npm run site:check` — does THIS deployment's site directory hold together? RM-033.
 *
 * WHY THIS EXISTS. Measured on 2026-08-31, a freshly scaffolded site fails 68 of the bridge
 * tests and 30 of the server tests, because those suites are the CARE office's REGRESSION suite:
 * they assert that this building's seven outlets round-trip a command and that this panel derives
 * to these four meters. Pointed at another building they fail on fixtures naming hardware it does
 * not have. So a new institution has a wall of red that means nothing, and — the part that
 * actually matters — nothing at all that tells them their OWN site is correct.
 *
 * This is that. It knows nothing about any building and everything about what a coherent site
 * looks like, so it is useful on day one and stays useful.
 *
 * ERRORS VERSUS WARNINGS IS THE DESIGN DECISION HERE. A scaffolded site has no devices and no
 * circuits, and that is a legitimate state — it is what `site:new` deliberately writes. If an
 * empty site failed this check, the command would be broken at exactly the moment it is most
 * needed, and the first thing anyone would learn is to ignore it. Empty is a warning. Wrong is
 * an error.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSite } from '../scripts/site-check.mjs';
import { SITE, CIRCUITS, BUILT_IN_DEVICES } from '../shared/siteConfig.mjs';
import { DEVICE_CLASSES } from '../shared/registry.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const site = (over = {}) =>
  Object.freeze({
    id: 'test-lab',
    display_name: 'Test Lab',
    timezone: 'UTC',
    utc_offset_minutes: 0,
    scene_pack: null,
    policy: Object.freeze({ acu_min_setpoint_c: null }),
    ...over,
  });

const run = (over = {}) =>
  checkSite({ slug: 'test-lab', site: site(), devices: [], circuits: [], ...over });

const codes = (r) => ({ errors: r.errors.map((e) => e.code), warnings: r.warnings.map((w) => w.code) });

// ---------------------------------------------------------------------------
// The state a new deployment is actually in
// ---------------------------------------------------------------------------

test('a freshly scaffolded site passes, with warnings about what it has not described yet', () => {
  const r = run();
  assert.deepEqual(r.errors, [], 'an empty site is incomplete, not wrong');
  assert.equal(r.ok, true);
  const { warnings } = codes(r);
  assert.ok(warnings.includes('no_devices'));
  assert.ok(warnings.includes('no_circuits'));
});

test('it notices the building has not been named yet', () => {
  // `site:new` seeds display_name with the slug. Left that way, the dashboard header reads
  // "test-lab" at every screen a visitor sees.
  const r = run({ site: site({ display_name: 'test-lab' }) });
  assert.ok(codes(r).warnings.includes('display_name_is_slug'));
  assert.deepEqual(r.errors, [], 'still not an error — it is a placeholder, not a lie');
});

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

test('the id must match the directory the deployment points at', () => {
  // The two disagreeing is silently wrong: the database row is keyed by one and the module path
  // by the other, so every site-scoped write lands under an id nothing else uses.
  const r = run({ slug: 'some-other-dir' });
  assert.ok(codes(r).errors.includes('id_directory_mismatch'));
});

test('the id must be a slug, because it is a path and a primary key', () => {
  assert.ok(codes(run({ site: site({ id: 'Not A Slug' }), slug: 'Not A Slug' })).errors.includes('id_not_slug'));
});

test('the site object must be frozen', () => {
  const thawed = { ...site() };
  assert.ok(codes(run({ site: thawed })).errors.includes('site_not_frozen'));
});

test('the timezone and the offset must agree, and a DST zone cannot satisfy both', () => {
  // They are the same fact carried twice on purpose — the Node-RED function node needs a plain
  // number. A zone that changes offset in the year cannot be described by one number, and this
  // is where a deployment finds that out rather than discovering it in a report six months on.
  assert.ok(codes(run({ site: site({ timezone: 'Asia/Manila', utc_offset_minutes: 0 }) })).errors.includes('offset_disagrees_with_timezone'));
  assert.ok(codes(run({ site: site({ timezone: 'Europe/London', utc_offset_minutes: 0 }) })).errors.includes('timezone_observes_dst'));
  assert.deepEqual(run({ site: site({ timezone: 'Asia/Manila', utc_offset_minutes: 480 }) }).errors, []);
});

test('a timezone the runtime does not recognise is an error, not a crash', () => {
  assert.ok(codes(run({ site: site({ timezone: 'Mars/Olympus' }) })).errors.includes('timezone_unknown'));
});

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

const dev = (over = {}) => ({ id: 'd1', display_name: 'D1', class: 'switch', room: null, dps_map: null, ctx: null, state_key: 'S1', status: 'active', ...over });

test('two devices may not share an id', () => {
  const r = run({ devices: [dev({ id: 'x' }), dev({ id: 'x', state_key: 'S2' })] });
  assert.ok(codes(r).errors.includes('duplicate_device_id'));
});

test('two devices may not share a context prefix or a state key', () => {
  // Both are addresses into the live flow's context store. Two devices sharing one means each
  // overwrites the other's reading, and the dashboard shows one of them twice without saying so.
  assert.ok(codes(run({ devices: [dev({ id: 'a', ctx: 'c' }), dev({ id: 'b', ctx: 'c', state_key: 'S2' })] })).errors.includes('duplicate_ctx'));
  assert.ok(codes(run({ devices: [dev({ id: 'a' }), dev({ id: 'b' })] })).errors.includes('duplicate_state_key'));
});

test('a device class this build cannot handle is an error', () => {
  assert.ok(codes(run({ devices: [dev({ class: 'solar_inverter' })] })).errors.includes('unknown_device_class'));
});

test('a dps_map naming a family that does not exist is an error', () => {
  assert.ok(codes(run({ devices: [dev({ class: 'meter', dps_map: 'type_z', ctx: 'm', state_key: null })] })).errors.includes('unknown_dps_map'));
});

test('an outlet without two socket keys, or a switch without a state key, cannot be addressed', () => {
  assert.ok(codes(run({ devices: [dev({ class: 'outlet_dual', ctx: 'o', sockets: ['ONE'], state_key: null })] })).errors.includes('outlet_missing_sockets'));
  assert.ok(codes(run({ devices: [dev({ class: 'switch', state_key: null })] })).errors.includes('switch_missing_state_key'));
});

test('a room typed onto a device is a warning — the space tree owns location now', () => {
  const r = run({ devices: [dev({ room: 'Lab 2' })] });
  assert.ok(codes(r).warnings.includes('device_carries_room'));
  assert.deepEqual(r.errors, []);
});

// ---------------------------------------------------------------------------
// Circuits
// ---------------------------------------------------------------------------

const cir = (over = {}) => ({ id: 'c1', parent_id: null, kind: 'branch', name: 'C1', phase: null, meter_device_id: null, ...over });

test('a circuit whose parent does not exist is an error', () => {
  assert.ok(codes(run({ circuits: [cir({ parent_id: 'ghost' })] })).errors.includes('circuit_parent_missing'));
});

test('a cycle in the circuit tree is an error rather than a hang', () => {
  const r = run({ circuits: [cir({ id: 'a', parent_id: 'b' }), cir({ id: 'b', parent_id: 'a' })] });
  assert.ok(codes(r).errors.includes('circuit_cycle'));
});

test('a circuit naming a meter that is not in the device list is an error', () => {
  // The quiet one: `PHASE_MAP` is derived from this, so a typo here does not fail. It produces a
  // phase total that silently omits a meter, and nothing on screen looks wrong.
  assert.ok(codes(run({ circuits: [cir({ meter_device_id: 'mtr_ghost', phase: 'red' })] })).errors.includes('circuit_meter_unknown'));
});

test('a circuit naming a device that is not a meter is an error', () => {
  const r = run({ devices: [dev({ id: 'sw' })], circuits: [cir({ meter_device_id: 'sw', phase: 'red' })] });
  assert.ok(codes(r).errors.includes('circuit_meter_not_a_meter'));
});

test('an invalid phase is an error', () => {
  assert.ok(codes(run({ circuits: [cir({ phase: 'green' })] })).errors.includes('circuit_phase_invalid'));
});

test('a meter no circuit claims is a warning — its readings reach no phase total', () => {
  const r = run({ devices: [dev({ id: 'm', class: 'meter', ctx: 'm', state_key: null })] });
  assert.ok(codes(r).warnings.includes('meter_unclaimed'));
  assert.deepEqual(r.errors, []);
});

test('a meter two circuits claim is an error — it would be counted twice', () => {
  const r = run({
    devices: [dev({ id: 'm', class: 'meter', ctx: 'm', state_key: null })],
    circuits: [cir({ id: 'a', meter_device_id: 'm', phase: 'red' }), cir({ id: 'b', meter_device_id: 'm', phase: 'yellow' })],
  });
  assert.ok(codes(r).errors.includes('meter_claimed_twice'));
});

// ---------------------------------------------------------------------------
// The site this repository actually ships
// ---------------------------------------------------------------------------

test('the live site passes its own check with no errors', () => {
  // If the checker cannot approve the one deployment known to work, it is measuring the wrong
  // thing — and every new site would be sent chasing a fault this building also has.
  const r = checkSite({ slug: SITE.id, site: SITE, devices: BUILT_IN_DEVICES, circuits: CIRCUITS });
  assert.deepEqual(r.errors, [], JSON.stringify(r.errors, null, 1));
  assert.equal(r.ok, true);
});

/**
 * The frontend carries its own copy of the class list as a TypeScript union, because a `.ts`
 * file cannot import a value from a `.mjs` module as a type. Two lists of the same five strings
 * is a drift waiting to happen — and the drift would be silent in the direction that matters: a
 * class added to the registry and not to the union renders as a device the UI cannot type.
 */
test('the frontend type union and the runtime class list are the same five things', () => {
  const src = readFileSync(join(ROOT, 'src', 'lib', 'types.ts'), 'utf8');
  const line = src.match(/^export type DeviceClass = (.+);$/m);
  assert.ok(line, 'could not find the DeviceClass union in src/lib/types.ts');
  const fromTs = [...line[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(
    fromTs,
    [...DEVICE_CLASSES],
    'src/lib/types.ts and shared/registry.mjs disagree about what a device class is',
  );
});
