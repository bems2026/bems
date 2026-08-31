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
import { iso8, buildLatest } from '../shared/buildLatest.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

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

// ---------------------------------------------------------------------------
// RM-027 Task 2 — the bridge stops hardcoding this building's timezone.
// ---------------------------------------------------------------------------

test('iso8 defaults to +08:00, so every caller predating RM-027 is unaffected', () => {
  assert.equal(iso8(0), '1970-01-01T08:00:00+08:00');
});

test('iso8 renders the offset it is given, sign and padding included', () => {
  assert.equal(iso8(0, 0), '1970-01-01T00:00:00+00:00');
  assert.equal(iso8(0, 330), '1970-01-01T05:30:00+05:30'); // a half-hour zone
  assert.equal(iso8(0, -300), '1969-12-31T19:00:00-05:00'); // west of UTC
});

test('buildLatest stamps rows with the offset it is given', () => {
  const reg = [{ id: 'x', class: 'switch', state_key: 'L1' }];
  const rows = buildLatest({}, reg, { red: [], yellow: [], blue: [] }, 0, 0);
  assert.ok(rows[0].ts.endsWith('+00:00'), `device row: got ${rows[0].ts}`);
  assert.ok(rows.at(-1).ts.endsWith('+00:00'), `_totals row: got ${rows.at(-1).ts}`);
});

test('buildLatest imports nothing — it is inlined into a Node-RED function node', () => {
  const src = readFileSync(join(ROOT, 'shared', 'buildLatest.mjs'), 'utf8');
  assert.equal(/^\s*import\s/m.test(src), false, 'an import here breaks the live bridge');
});

test('the generated flow carries the site offset, not a hardcoded eight hours', () => {
  const flow = readFileSync(join(ROOT, 'node-red-bridge', 'bridge-flow.json'), 'utf8');
  assert.equal(
    /8\s*\*\s*3600\s*\*\s*1000/.test(flow),
    false,
    'a literal 8-hour offset survived generation — regenerate with npm run build:flow',
  );
  assert.ok(flow.includes(String(SITE.utc_offset_minutes)), 'the site offset must reach the flow');
});

/**
 * RM-033. `shared/siteConfig.mjs` says, in its own header, that standing up another building is
 * "add a sibling directory under `shared/sites/`, then change the path below." That has to be
 * literally true, or a second deployment is a hunt rather than an edit — and a missed one is a
 * site quietly wired to another building's circuits.
 *
 * The allowed names are derived from `shared/sites/` rather than hardcoded, so a site added
 * tomorrow is covered without touching this file.
 */
test('exactly one module names the site directory, which is what makes it one line', () => {
  const root = ROOT;
  const siteDirs = readdirSync(join(root, 'shared', 'sites'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  assert.ok(siteDirs.length > 0, 'expected at least one site directory');

  /** Where a site name legitimately appears: the one pointer, and the site's own files. */
  const allowed = (rel) => rel === 'shared/siteConfig.mjs' || rel.startsWith('shared/sites/');

  const walk = (dir, out = []) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      // Production modules only. Tests, fixtures and migrations name sites as DATA, which is a
      // different thing from a module wiring itself to one.
      else if (/\.(mjs|ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full);
    }
    return out;
  };

  const offenders = [];
  for (const dir of ['shared', 'src', 'server', 'node-red-bridge', 'scripts']) {
    let files;
    try { files = walk(join(root, dir)); } catch { continue; }
    for (const file of files) {
      const rel = relative(root, file).split(sep).join('/');
      if (allowed(rel)) continue;
      const text = readFileSync(file, 'utf8');
      for (const name of siteDirs) {
        if (text.includes(name)) offenders.push(`${rel} names ${name}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'Only shared/siteConfig.mjs may name a site directory. Re-export what you need through it, ' +
      'so a second deployment stays one edit.',
  );
});

/**
 * RM-033 / FI-017. The device list is the most site-specific thing in this codebase - 21 pieces
 * of hardware screwed to one building's walls - and it lived inline in `shared/registry.mjs`,
 * the file every deployment shares. A second site would have edited it.
 *
 * Asserted twice, because the two failures look different. The behavioural half proves the
 * composition still works; the source half proves nothing was left behind in the shared file,
 * which is the part that would rot quietly.
 */
test('the site owns its own device list, and the registry composes it', async () => {
  const site = await import('../shared/siteConfig.mjs');
  assert.ok(Array.isArray(site.BUILT_IN_DEVICES), 'siteConfig must re-export the site device list');
  assert.ok(site.BUILT_IN_DEVICES.length > 0, 'a site with no devices is not a site');
  // Built-ins first and in order: several places key off position implicitly (the generated
  // flow's node order, the analytics colour cycle), so this is not merely a set comparison.
  assert.deepEqual(
    DEVICE_REGISTRY.slice(0, site.BUILT_IN_DEVICES.length),
    site.BUILT_IN_DEVICES,
    'DEVICE_REGISTRY must start with exactly the site own devices, in order',
  );
});

test('the shared registry names none of this building hardware', async () => {
  // Including in prose. The CT circuit map and the two-logical-meters-on-one-box note are
  // documentation OF THIS BUILDING; leaving them in the shared file is how the next site
  // inherits another building wiring as fact.
  //
  // Device ids are slugs, so a plain word-boundary match needs no escaping - and if one ever
  // stops being a slug, `the id is a slug` above fails first and says so.
  const site = await import('../shared/siteConfig.mjs');
  const source = readFileSync(join(ROOT, 'shared', 'registry.mjs'), 'utf8');
  const names = (text) => site.BUILT_IN_DEVICES.map((d) => d.id).filter((id) => new RegExp(`\\b${id}\\b`).test(text));

  // THE GUARD PROVES IT CAN FIRE BEFORE IT IS BELIEVED, and this is not decoration. The matcher
  // above was written through a shell heredoc that turned `\b` into a literal BACKSPACE (0x08),
  // so the regex could never match anything and this test passed while asserting nothing. A
  // guard that cannot fail is worse than no guard, because it is counted as coverage.
  const firstId = site.BUILT_IN_DEVICES[0].id;
  assert.deepEqual(names(`a line mentioning ${firstId} here`), [firstId], 'the matcher itself is broken');
  assert.deepEqual(names(`a line mentioning ${firstId}x here`), [], 'the matcher must respect word boundaries');

  assert.deepEqual(names(source), [], 'shared/registry.mjs still names these devices - move them to the site directory');
});
