/**
 * No shared frontend module may name one of this building's devices — FI-016.
 *
 * WHY THIS IS THE RIGHT INVARIANT. The device registry, the space tree, the totals, the floor
 * plan, the generated flow and every timestamp were each made site-independent one at a time,
 * and each time something was missed and found later by looking at a running page. A device id
 * in a shared component is the mechanical, checkable form of that whole class of mistake: if
 * `co3` appears in code every deployment runs, that code is about this building.
 *
 * THE EXEMPTIONS ARE PACKS, and a pack is allowed to know its own building. A pack is a
 * directory that renders only when `SITE.scene_pack` names it, so a site that declares no pack
 * never loads it and never sees this building's hardware drawn into its room.
 *
 * WHAT THIS DOES NOT CLAIM. Naming no device id is necessary, not sufficient: a component can
 * still assume seven of something, or a room shape, without spelling an id. It catches the
 * commonest and most damaging form, which is a coordinate table keyed by device.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';
import { BUILT_IN_DEVICES } from '../shared/siteConfig.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Directories that render only behind `SITE.scene_pack`. */
const PACKS = ['src/components/scene3d/', 'src/components/control/plans/'];

/** Comments explaining WHY something used to be site-specific are not themselves couplings —
 * several files in this repo say exactly that, at length. */
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(path);
  }
  return out;
}

const ids = BUILT_IN_DEVICES.map((d) => d.id);

test('there are device ids to look for, so this cannot pass vacuously', () => {
  assert.ok(ids.length > 5, `expected this site's device list, found ${ids.length}`);
});

test('the matcher fires on a device id and not on a longer word containing one', () => {
  // Proving the matcher works before believing what it reports. Three guards in this suite once
  // could not match anything at all and passed for it.
  const hit = (text) => ids.filter((id) => new RegExp(`\\b${id}\\b`).test(text));
  assert.deepEqual(hit(`const x = '${ids[0]}';`), [ids[0]], 'the matcher is broken');
  assert.deepEqual(hit(`const x = '${ids[0]}extra';`), [], 'the matcher ignores word boundaries');
});

test('no shared frontend module names one of this building devices', () => {
  const offenders = [];
  for (const file of sourceFiles(join(ROOT, 'src'))) {
    const rel = relative(ROOT, file).split(sep).join('/');
    if (PACKS.some((p) => rel.startsWith(p))) continue;
    const code = stripComments(readFileSync(file, 'utf8'));
    const named = ids.filter((id) => new RegExp(`\\b${id}\\b`).test(code));
    if (named.length) offenders.push(`${rel}: ${named.join(', ')}`);
  }
  assert.deepEqual(
    offenders,
    [],
    'These render this building\'s devices at every deployment. Move them into a pack under ' +
      `${PACKS.join(' or ')}, which loads only when SITE.scene_pack names it.`,
  );
});
