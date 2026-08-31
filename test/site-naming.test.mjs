/**
 * The shared frontend must not name one particular building — RM-033.
 *
 * WHY THIS EXISTS, and it was found the same day by looking rather than by reasoning. Every
 * data-driven surface had been made site-agnostic and verified: the device registry, the space
 * tree, the totals, the floor plan, the generated flow. Then a deployment was pointed at a
 * freshly scaffolded site and the dashboard was opened, and the header still read
 *
 *     MMSU CARE Office · NBERIC
 *
 * along with "Building Energy Management System - MMSU Care Office", "NBERIC · CARE office",
 * "Room · CARE office" and "· Batac City". Five literals in the page chrome — the most visible
 * text in the product, and the last place anyone thought to look, because none of it is data.
 *
 * WHAT THIS CHECKS AND WHAT IT DOES NOT. It scans for the two tokens that identify the
 * institution and can never be ordinary English: the university's initialism and the building's.
 * Tokens like "care" and "office" are deliberately NOT scanned — they appear in legitimate
 * prose and in this project's own filenames, and a guard with false positives gets disabled.
 * So this is a floor, not a ceiling: it catches the institution's name reappearing, not every
 * possible site-specific phrase.
 *
 * `src/components/scene3d/` is exempt. That directory IS the CARE office's scene pack, gated
 * behind `SITE.scene_pack` (RM-032), and a pack is allowed to know its own building.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';
import { SITE } from '../shared/siteConfig.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Institution-identifying tokens, taken from the site's own id and display name and filtered to
 * the ones that cannot be ordinary English. Derived rather than hardcoded so a differently-named
 * site is covered, and lowercased because the five literals used four different casings between
 * them.
 */
const GENERIC = new Set([
  'office', 'care', 'building', 'room', 'lab', 'main', 'annex', 'centre', 'center', 'campus',
  'hall', 'wing', 'floor', 'site', 'north', 'south', 'east', 'west', 'new', 'old',
]);

const tokens = [...new Set(`${SITE.id} ${SITE.display_name}`.toLowerCase().match(/[a-z]{4,}/g) ?? [])].filter(
  (t) => !GENERIC.has(t),
);

/** The scene pack is the one place allowed to name its own building. */
const EXEMPT = ['src/components/scene3d/'];

/** Comments are stripped before scanning: prose explaining WHY something is site-specific is not
 * itself a site coupling, and several files in this repo say exactly that. Crude but adequate —
 * a false negative here costs a missed comment, not a missed string literal. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(path);
  }
  return out;
}

test('there are tokens to scan for, so this cannot pass vacuously', () => {
  assert.ok(tokens.length > 0, `no distinctive tokens derived from "${SITE.id}" / "${SITE.display_name}"`);
});

test('no shared frontend module names this institution', () => {
  const offenders = [];
  for (const file of sourceFiles(join(ROOT, 'src'))) {
    const rel = relative(ROOT, file).split(sep).join('/');
    if (EXEMPT.some((e) => rel.startsWith(e))) continue;
    const code = stripComments(readFileSync(file, 'utf8')).toLowerCase();
    for (const token of tokens) {
      if (new RegExp(`\\b${token}\\b`).test(code)) offenders.push(`${rel} names "${token}"`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'These render one building\'s name at every deployment. Take the name from SITE.display_name.',
  );
});

test('the weather module does not carry a second copy of the site timezone', () => {
  // `SITE.timezone` is the site's declared zone and `test/site-config.test.mjs` already holds it
  // to agreeing with the offset. A literal here is a second source of truth for the same fact,
  // and the two would drift silently — the clock would be right and the forecast an hour out.
  const src = stripComments(readFileSync(join(ROOT, 'src', 'config', 'weather.ts'), 'utf8'));
  assert.equal(
    /WEATHER_TZ\s*=\s*['"]/.test(src),
    false,
    'WEATHER_TZ is a string literal — take it from SITE.timezone',
  );
});

test('the weather module carries no building location of its own', () => {
  // These were this module's own defaults — one office's coordinates and city — so a deployment
  // that had not set `VITE_WEATHER_*` showed THAT office's weather labelled as its own. A
  // forecast for somewhere else, presented as being about the reader's building, is the same
  // class of thing as a power reading nobody took. The building declares where it is now.
  const src = stripComments(readFileSync(join(ROOT, 'src', 'config', 'weather.ts'), 'utf8'));
  assert.equal(/WEATHER_(LAT|LON)[^;]*\d+\.\d+/.test(src), false, 'a coordinate literal is a building baked into shared code');
  assert.equal(/WEATHER_PLACE[^;]*['"][A-Za-z]/.test(src), false, 'a place-name literal is a building baked into shared code');
});

test('the Overview clock shows the building time, not the reader time', () => {
  // Without a `timeZone`, `toLocaleTimeString` renders the READER's clock — and it sat beside
  // the building's place name. Measured: a viewer in New York saw 00:20 while the building read
  // 12:20. A kiosk in the room was correct only by coincidence.
  const src = stripComments(readFileSync(join(ROOT, 'src', 'components', 'overview', 'OverviewPage.tsx'), 'utf8'));
  const calls = src.match(/toLocale(Time|Date)String\([^)]*\)/g) ?? [];
  assert.ok(calls.length > 0, 'expected the clock to format a time');
  for (const call of calls) {
    assert.match(call, /timeZone:\s*SITE\.timezone/, `${call} does not pin the site timezone`);
  }
});
