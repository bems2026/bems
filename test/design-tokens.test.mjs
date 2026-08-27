/**
 * Every `var(--token)` without a fallback must name a token that exists.
 *
 * WHY THIS EXISTS, and it is a scar. `var(--text)` was used in five declarations across RM-028
 * and RM-030. There is no `--text` in this project — the text colour is `--txt`. An undefined
 * custom property is not an error: CSS drops the declaration and the element inherits whatever
 * colour is in scope. On the dark theme that left `.space-tree-panel__name` — the labels of the
 * space tree — at 1.14:1 against its own card, and did the same to the by-space average-power
 * figure. Both shipped.
 *
 * NOTHING ELSE COULD HAVE CAUGHT IT. `tsc` does not read stylesheets. vitest renders in jsdom,
 * which computes no cascade worth checking. The contrast guard FI-008 proposed was never built.
 * It took reading computed colours out of a real browser in both themes — worth doing, and not
 * something that happens on every change, which is what this file is for.
 *
 * WHAT THIS IS NOT. It is not a contrast checker: a token that exists can still be unreadable on
 * a given background, and only a real browser can measure that. This catches the cheaper and
 * more common mistake — a name that was never defined at all.
 *
 * A fallback (`var(--maybe, var(--txt))`) is deliberately allowed: that is the syntax for "this
 * may not be defined", so using it is a statement of intent rather than a typo.
 *
 * Lives in `test/` beside `migration-idempotency.test.mjs` and the `phase*-schema` files, which
 * are static guards over source text rather than unit tests of a module. Same job, same place.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const STYLESHEET = join(SRC, 'index.css');

/** `--name:` at the start of a declaration. The leading class guards against matching the tail
 * of something longer. */
const DEFINITION = /(^|[;{\s])(--[a-zA-Z0-9-_]+)\s*:/g;
/** `var(--name)` or `var(--name, fallback)` — the trailing character says which. */
const USAGE = /var\(\s*(--[a-zA-Z0-9-_]+)\s*([,)])/g;

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(tsx?|css)$/.test(entry.name)) out.push(path);
  }
  return out;
}

const css = readFileSync(STYLESHEET, 'utf8');
const defined = new Set([...css.matchAll(DEFINITION)].map((m) => m[2]));

test('the stylesheet defines tokens, so this file cannot pass vacuously', () => {
  assert.ok(defined.size > 40, `expected the token palette, found ${defined.size}`);
  // Two the codebase leans on hardest. If either name ever changes, this file should be the
  // thing that says so rather than a screenshot six weeks later.
  for (const token of ['--txt', '--muted-2']) {
    assert.ok(defined.has(token), `${token} is missing — has the palette been renamed?`);
  }
});

for (const file of sourceFiles(SRC)) {
  const text = readFileSync(file, 'utf8');
  const missing = [...text.matchAll(USAGE)].filter((m) => m[2] === ')' && !defined.has(m[1])).map((m) => m[1]);

  if (missing.length === 0) continue; // No test emitted for a clean file — 200 passing no-ops is noise.
  test(`${relative(ROOT, file)}: every var(--token) names a token that exists`, () => {
    assert.deepEqual(
      [...new Set(missing)],
      [],
      'These resolve to nothing, so the declaration is dropped and the element inherits. ' +
        'Check the name against src/index.css, or give it an explicit fallback.',
    );
  });
}

test('every source file was checked', () => {
  // The loop above emits nothing for a clean file, so without this a broken walk would look
  // exactly like a clean tree.
  const files = sourceFiles(SRC);
  assert.ok(files.length > 100, `expected the source tree, walked ${files.length} files`);
  assert.ok(files.some((f) => f.endsWith('index.css')), 'the stylesheet itself must be in the walk');
});
