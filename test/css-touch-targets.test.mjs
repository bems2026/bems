/**
 * The `@media (pointer: coarse)` block must actually contain rules.
 *
 * WHY THIS EXISTS, and it is a scar. `src/index.css` carried `.automation-write-btn,,` — a stray
 * second comma, leaving an empty member in a selector list. **A selector list is all-or-nothing:
 * one invalid member and the browser discards the entire rule**, with no console warning, no
 * parse error surfaced anywhere, and nothing visibly broken on screen. Twelve controls silently
 * lost their 44px floor across the whole app.
 *
 * WHAT IT COST. Eleven of the twelve listed controls had nothing else holding the floor — no
 * pseudo-element hit-area expander, no `min-height` of their own — so they had no 44px guarantee
 * at all. "Save changes" measured 36px on a coarse pointer. Both `.confirm-modal__` buttons were
 * among them, and that is the dialog gating unattended load shedding, reached from the kiosk's
 * own touchscreen.
 *
 * `.nav-icon-btn` is the exception and is recorded here because a naive audit will re-flag it:
 * its `::after` expander (`inset: -6px` on a 32px box) kept a real 44px tap target the whole
 * time. Only the drawn box was small. Measure hit areas, not `getBoundingClientRect()`.
 *
 * WHY NOBODY NOTICED. The SECOND rule in the same media block (`.nav-tab, .tabs__tab, …`) has no
 * typo, so a correct 44px tab strip sat directly beside a 36px button. Everything looked
 * deliberate. That is the failure mode this file exists for: not "the CSS is wrong" but "the CSS
 * is absent, and absence renders as a slightly smaller button".
 *
 * WHAT NOTHING ELSE CATCHES. `tsc` does not read stylesheets. eslint does not read CSS. vitest
 * renders in jsdom, which does not implement `pointer: coarse` and computes no such cascade.
 * `design-tokens.test.mjs` checks that token NAMES resolve, which this rule never violated —
 * every declaration in it was valid; the selector was not. A browser is the only thing that
 * reports it, and only if someone thinks to measure a button.
 *
 * WHAT THIS IS NOT. It is not a check that the right controls are listed, nor that 44px is the
 * right number, nor that the rule wins the cascade. It answers one question the cheap way: did
 * every rule in this block survive parsing, or did one of them evaporate?
 *
 * Lives in `test/` beside `design-tokens.test.mjs` and `contrast.test.mjs` — static guards over
 * source text, run by `node --test` (`npm run test:bridge`), NOT by vitest.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS_PATH = join(HERE, '..', 'src', 'index.css');
const css = readFileSync(CSS_PATH, 'utf8');

/**
 * Strip comments before looking at punctuation. A comma inside a prose comment is not a selector
 * delimiter, and this file's comments are long enough that ignoring them would guarantee a false
 * positive on the very first run.
 */
const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * The block runs from its `@media (pointer: coarse) {` to the matching close brace. Counted by
 * brace depth rather than matched with a regex, because the block contains nested rules and a
 * non-greedy `.*?` would stop at the first `}` it met — the end of the first rule, not the block.
 */
function coarsePointerBlock(source) {
  const start = source.search(/@media\s*\(\s*pointer\s*:\s*coarse\s*\)\s*\{/);
  if (start === -1) return null;
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

test('the coarse-pointer block exists and is not empty', () => {
  const block = coarsePointerBlock(withoutComments);
  assert.ok(block !== null, '@media (pointer: coarse) is missing from src/index.css entirely');
  assert.ok(
    block.trim().length > 0,
    'the coarse-pointer block is empty — every touch target on the kiosk just lost its floor',
  );
});

test('no rule inside it has an empty selector-list member', () => {
  // The exact shape of the original defect: `.a,, .b { … }`. Also catches a list that opens or
  // closes on a comma (`,.a {`, `.a, {`), which fails the same all-or-nothing way.
  const block = coarsePointerBlock(withoutComments);
  const selectors = block.split('}').map((chunk) => chunk.split('{')[0]).filter((s) => s.trim());

  for (const selector of selectors) {
    const members = selector.split(',');
    const empty = members.filter((m) => m.trim() === '');
    assert.equal(
      empty.length,
      0,
      `empty member in a selector list — the browser will DROP this whole rule, silently:\n  ${selector.trim().replace(/\s+/g, ' ')}`,
    );
  }
});

test('every control the block names still gets a 44px floor', () => {
  // Not an exhaustive list of what SHOULD be covered — it is the set that was silently uncovered,
  // pinned so the same controls cannot quietly fall out again. `.confirm-modal__*` is the one that
  // matters most: it is the dialog that gates arming auto-shed, reached from a touchscreen.
  const block = coarsePointerBlock(withoutComments);
  const mustBeCovered = [
    '.nav-icon-btn',
    '.control-master-btn',
    '.confirm-modal__cancel',
    '.confirm-modal__confirm',
    '.automation-write-btn',
    '.devices-filter-chip',
    '.overlay-panel__close',
    '.devices-add-btn',
  ];

  for (const selector of mustBeCovered) {
    assert.ok(
      block.includes(selector),
      `${selector} is no longer covered by the coarse-pointer touch-target block`,
    );
  }
});

test('the whole stylesheet has no empty selector-list member anywhere', () => {
  // The defect was not special to the touch-target block; it was a typo that could land in any of
  // this file's 8,000 lines and fail exactly as invisibly. Scanning the whole file costs nothing.
  //
  // EACH SELECTOR IS TAKEN AS THE TEXT BETWEEN A `{` AND THE NEAREST PRECEDING `{`, `}` OR `;`,
  // rather than by splitting the file on `}`. The first draft did split on `}`, and it had a hole
  // exactly where the real bug lived: the first rule inside `@media (…) { … }` shares its chunk
  // with the at-rule prelude, so a test that skips any chunk containing `@` skips that rule too.
  // It passed on the reintroduced defect. Walking brace positions has no such blind spot — the
  // at-rule prelude and the rule after it are separate preludes.
  //
  // Declaration VALUES are never inspected: they legitimately contain commas and can look empty
  // (`rgba(0, 0, 0, .5)`, `font-family: a, b`). Everything after a `{` up to its `}` is skipped
  // by construction, since a prelude only ever ends at a `{`.
  const problems = [];

  for (let i = 0; i < withoutComments.length; i += 1) {
    if (withoutComments[i] !== '{') continue;
    let start = i - 1;
    while (start >= 0 && !'{};'.includes(withoutComments[start])) start -= 1;
    const prelude = withoutComments.slice(start + 1, i).trim();
    // `@media`/`@supports`/`@keyframes` preludes are not selector lists and use commas differently.
    if (!prelude || prelude.startsWith('@')) continue;
    // `@keyframes` stop offsets (`0%, 100% { … }`) are also not selector lists, but they cannot
    // produce an empty member without being malformed anyway, so they need no special case.
    if (prelude.split(',').some((m) => m.trim() === '')) {
      problems.push(prelude.replace(/\s+/g, ' ').slice(0, 100));
    }
  }

  assert.deepEqual(
    problems,
    [],
    `selector list(s) with an empty member — each one silently disables its entire rule:\n  ${problems.join('\n  ')}`,
  );
});
