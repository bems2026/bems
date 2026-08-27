/**
 * `npm run site:new <slug>` — RM-033, the scaffolder.
 *
 * WHAT IT IS FOR. Milestone 6 is "a practical step-by-step framework that enables other SUCs to
 * replicate and implement the iBEMS". Standing up a second building now means: create a site
 * directory, then change one line. This makes the first half a command instead of a copy-paste,
 * and the guard tests here are what stop that command from producing something subtly wrong.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: activate the site. Repointing `shared/siteConfig.mjs` is how
 * a deployment changes which building it is, and a scaffolder that did it silently would take a
 * running building offline — every device id would stop resolving. It prints the line; a person
 * makes the change.
 *
 * THE TEMPLATE CONTAINS NO INVENTED FACTS. A new site has no devices and no metered circuits
 * until somebody enrols them, so both lists start empty and the timezone starts at UTC — which
 * is a placeholder that is also true, rather than another building's timezone copied across.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { scaffoldSite, isSiteSlug } from '../scripts/site-new.mjs';

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'ibems-site-new-'));
  mkdirSync(join(root, 'shared', 'sites'), { recursive: true });
  return root;
}

test('a slug is what a directory name and a database key can both be', () => {
  for (const good of ['mmsu-nberic-care', 'lab-2', 'x']) assert.equal(isSiteSlug(good), true, good);
  // Each of these breaks something specific: a space breaks the import path, an uppercase letter
  // breaks the case-insensitive uniqueness the sites table relies on, and the traversal is the
  // one that matters — the slug becomes a path.
  for (const bad of ['MMSU', 'has space', 'has_underscore', '../escape', 'trailing-', '-leading', '', 'a'.repeat(65)]) {
    assert.equal(isSiteSlug(bad), false, bad);
  }
});

test('it writes a site directory a deployment could actually use', async () => {
  const root = sandbox();
  try {
    const result = scaffoldSite({ root, slug: 'test-lab' });
    const dir = join(root, 'shared', 'sites', 'test-lab');
    for (const f of ['site.mjs', 'devices.mjs', 'circuits.mjs']) {
      assert.ok(existsSync(join(dir, f)), `expected ${f}`);
    }
    assert.equal(result.slug, 'test-lab');

    const site = await import(pathToFileURL(join(dir, 'site.mjs')).href);
    assert.equal(site.SITE.id, 'test-lab', 'the id must match the directory, or the two disagree');
    assert.equal(Object.isFrozen(site.SITE), true, 'a deployment-wide fact must not be mutable at runtime');
    // The same rule `site-config.test.mjs` holds the live site to: the offset and the zone are
    // the same fact carried twice, and a template that shipped them disagreeing would seed every
    // future site with a bug.
    const measured = new Date('2026-01-15T00:00:00Z');
    const offsetOf = (d) => {
      const local = new Date(d.toLocaleString('en-US', { timeZone: site.SITE.timezone }));
      const utc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
      return Math.round((local - utc) / 60000);
    };
    assert.equal(offsetOf(measured), site.SITE.utc_offset_minutes, 'timezone and offset must agree');

    const devices = await import(pathToFileURL(join(dir, 'devices.mjs')).href);
    const circuits = await import(pathToFileURL(join(dir, 'circuits.mjs')).href);
    assert.deepEqual(devices.BUILT_IN_DEVICES, [], 'a new site has no hardware until somebody enrols it');
    assert.deepEqual(circuits.CIRCUITS, [], 'and no metered circuits until somebody wires them');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a new site declares no scene pack, because nobody has modelled that building', async () => {
  const root = sandbox();
  try {
    scaffoldSite({ root, slug: 'test-lab' });
    const site = await import(pathToFileURL(join(root, 'shared', 'sites', 'test-lab', 'site.mjs')).href + '?scene');
    assert.equal(site.SITE.scene_pack, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('it refuses to overwrite a site that already exists, and touches nothing', () => {
  const root = sandbox();
  try {
    const dir = join(root, 'shared', 'sites', 'existing');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'site.mjs'), 'REAL CONTENT');
    assert.throws(() => scaffoldSite({ root, slug: 'existing' }), /already exists/i);
    assert.equal(readFileSync(join(dir, 'site.mjs'), 'utf8'), 'REAL CONTENT', 'the existing site must be untouched');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('it refuses a slug that is not one, before creating anything', () => {
  const root = sandbox();
  try {
    assert.throws(() => scaffoldSite({ root, slug: '../escape' }), /slug/i);
    assert.equal(existsSync(join(root, 'shared', 'sites', '..', 'escape')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('it does not activate the site — that is a person\'s decision', () => {
  const root = sandbox();
  try {
    // A scaffolder that repointed siteConfig would take a running building offline: every device
    // id in the live flow would stop resolving, from a command that sounds additive.
    const pointer = join(root, 'shared', 'siteConfig.mjs');
    writeFileSync(pointer, "export { SITE } from './sites/original/site.mjs';\n");
    const result = scaffoldSite({ root, slug: 'test-lab' });
    assert.match(readFileSync(pointer, 'utf8'), /sites\/original\/site\.mjs/, 'siteConfig must be untouched');
    // ...but it must say exactly what to change, or "one line" is only true for whoever wrote it.
    assert.match(result.nextStep, /siteConfig\.mjs/);
    assert.match(result.nextStep, /test-lab/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the scaffolded files carry no reference to any other building', () => {
  const root = sandbox();
  try {
    scaffoldSite({ root, slug: 'test-lab' });
    const dir = join(root, 'shared', 'sites', 'test-lab');
    for (const f of ['site.mjs', 'devices.mjs', 'circuits.mjs']) {
      const text = readFileSync(join(dir, f), 'utf8');
      assert.equal(/mmsu|nberic|care\b/i.test(text), false, `${f} mentions the original site`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
