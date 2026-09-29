/**
 * The shared press effect must not move a control that is positioned by its own transform.
 *
 * WHY THIS EXISTS, and it is a scar. `src/index.css` gives a list of controls one press effect,
 * `:active { transform: scale(0.96) }`. `transform` is one property, so on a control that is CENTRED
 * by its own `transform: translate(-50%, -50%)` the press effect does not add to the translate, it
 * replaces it. The Control plan's lamps are exactly that: absolutely positioned on a plan coordinate
 * and centred by a translate. On mousedown each lamp jumped half its own size down and right, the
 * mouseup landed just outside it, and the browser fired no click. A press on the middle of a lamp,
 * where anyone presses, did nothing, on the page's primary control, until 2026-09-29.
 *
 * WHAT NOTHING ELSE CATCHES. jsdom has no layout, so every Control test clicked the lamp and passed;
 * `fireEvent.click` never goes through mousedown, `:active` and mouseup at all. A real browser is the
 * only thing that shows it, and only to someone who clicks where the pointer lands, not with
 * `element.click()`.
 *
 * WHAT IT CHECKS. For every class in the shared press-effect rule whose own base rule centres it with
 * `translate(`, there must be an `:active` rule for that class that keeps the `translate(`. Static
 * source text, like `css-touch-targets.test.mjs` beside it; run by `node --test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(HERE, '..', 'src', 'index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Every top-level-or-nested rule as { selector, body }, found by walking braces. */
function rules(source) {
  const out = [];
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] !== '{') continue;
    let start = i - 1;
    while (start >= 0 && !'{};'.includes(source[start])) start -= 1;
    const selector = source.slice(start + 1, i).trim();
    const end = source.indexOf('}', i);
    const body = source.slice(i + 1, end);
    if (selector && !selector.startsWith('@') && !body.includes('{')) out.push({ selector, body });
  }
  return out;
}

const all = rules(css);

/** The class names the shared press-effect rule scales — the rule whose body is `scale(0.96)`. */
function pressedClasses() {
  const press = all.find((r) => /transform:\s*scale\(0\.96\)/.test(r.body) && r.selector.includes(':active,'));
  assert.ok(press, 'the shared press-effect rule (`:active { transform: scale(0.96) }`) was not found');
  return [...new Set(press.selector.split(',').map((s) => s.trim().match(/^\.([\w-]+)/)?.[1]).filter(Boolean))];
}

test('the shared press effect exists and names the Control plan lamp', () => {
  assert.ok(pressedClasses().includes('control-lamp'));
});

test('a control centred by its own translate keeps the translate while pressed', () => {
  const problems = [];
  for (const cls of pressedClasses()) {
    const base = all.find((r) => r.selector === `.${cls}` && /transform:\s*translate\(/.test(r.body));
    if (!base) continue;
    const keeps = all.some(
      (r) => r.selector.split(',').some((s) => s.trim().startsWith(`.${cls}`) && s.includes(':active')) && /transform:[^;]*translate\(/.test(r.body),
    );
    if (!keeps) problems.push(`.${cls}`);
  }
  assert.deepEqual(
    problems,
    [],
    `pressing these jumps them off their position, and the click is lost — give each an :active rule that keeps its translate:\n  ${problems.join('\n  ')}`,
  );
});
