/**
 * The Reports page's own CSS sits on an 8-point grid — RM-082.
 *
 * WHY THIS EXISTS. The operator asked for the report to be laid out on a strict 8-point spatial
 * grid, and the rules as RM-072 left them used 2px, 6px and 12px beside 8 and 16 — each defensible
 * alone, together the reason a card's contents never quite lined up with the card beside it. A
 * grid survives only as long as nobody adds "just 12px here", and a reviewer does not see 12px in a
 * diff that also moves forty lines. This does.
 *
 * WHAT IT CHECKS. Every margin, padding and gap in any rule whose selector names a `.report-` or
 * `.reports-` class. Allowed: 0, auto, inherit, a px value that is a multiple of 8,
 * `var(--sp-2)` (8) and `var(--sp-4)` (16), and `calc(var(--sp-2) * N)` for 24, 32, 48. One
 * exception: `var(--sp-1)` (4) in a GAP, for an icon beside its label — the one place a half step
 * reads as intended rather than as drift.
 *
 * WHAT IT IS NOT. The app's global scale is 4/8/12/16/20/28 and every other page keeps it; this is
 * not a verdict on that. It does not check sizes, borders or line-heights, and it cannot see an
 * inline style. It reads the stylesheet, not the page.
 *
 * Positive controls first, per this project's rule that a guard must be seen to fail before its
 * pass is believed: a synthetic sheet with known violations must be flagged, and a clean one
 * must not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(HERE, '..', 'src', 'index.css'), 'utf8');

const SPACING = /^(margin|padding)(-(top|right|bottom|left|block|inline)(-(start|end))?)?$|^(row-|column-)?gap$/;
const IS_GAP = /gap$/;

/** Innermost `selector { declarations }` blocks, at any depth, with comments removed. */
function rules(source) {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const stack = [];
  let last = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') {
      stack.push({ selector: text.slice(last, i).trim(), start: i + 1, nested: false });
      if (stack.length > 1) stack[stack.length - 2].nested = true;
      last = i + 1;
    } else if (ch === '}') {
      const open = stack.pop();
      if (open && !open.nested) out.push({ selector: open.selector, body: text.slice(open.start, i) });
      last = i + 1;
    } else if (ch === ';' && stack.length === 0) {
      last = i + 1;
    }
  }
  return out;
}

/** Split a value on spaces that are not inside parentheses: `calc(var(--sp-2) * 3) 0`. */
function tokens(value) {
  const out = [];
  let depth = 0;
  let current = '';
  for (const ch of value.trim()) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (/\s/.test(ch) && depth === 0) {
      if (current) out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) out.push(current);
  return out;
}

function allowed(token, property) {
  if (['0', 'auto', 'inherit'].includes(token)) return true;
  const px = /^(\d+)px$/.exec(token);
  if (px) return Number(px[1]) % 8 === 0;
  if (token === 'var(--sp-2)' || token === 'var(--sp-4)') return true;
  if (token === 'var(--sp-1)') return IS_GAP.test(property);
  return /^calc\(var\(--sp-2\)\s*\*\s*\d+\)$/.test(token);
}

/** Every off-grid spacing declaration in the Reports rules of `source`. */
function offGrid(source) {
  const found = [];
  let checked = 0;
  for (const { selector, body } of rules(source)) {
    if (!/\.reports?-/.test(selector)) continue;
    checked += 1;
    for (const decl of body.split(';')) {
      const colon = decl.indexOf(':');
      if (colon === -1) continue;
      const property = decl.slice(0, colon).trim();
      if (!SPACING.test(property)) continue;
      const value = decl.slice(colon + 1).replace(/!important/, '').trim();
      for (const token of tokens(value)) {
        if (!allowed(token, property)) found.push(`${selector} { ${property}: ${value} } — ${token}`);
      }
    }
  }
  return { found, checked };
}

test('the guard flags off-grid spacing in a synthetic sheet', () => {
  const bad = `
    .report-a { margin: 12px 0; }
    .reports-b { gap: var(--sp-3); }
    @media (max-width: 640px) { .report-c { padding: 0 var(--sp-5); } }
    .report-d { margin-top: var(--sp-1); }
    .report-e { padding: calc(var(--sp-3) * 2); }
  `;
  const { found } = offGrid(bad);
  assert.equal(found.length, 5, found.join('\n'));
});

test('the guard accepts on-grid spacing, and ignores rules that are not the Reports page’s', () => {
  const good = `
    .report-a { margin: 0 auto var(--sp-4); padding: var(--sp-2) var(--sp-4); }
    .reports-b { gap: var(--sp-1) var(--sp-2); row-gap: 24px; }
    .report-c { padding-inline: calc(var(--sp-2) * 3); }
    .tariff-form { gap: var(--sp-3); }
  `;
  const { found, checked } = offGrid(good);
  assert.deepEqual(found, []);
  assert.equal(checked, 3);
});

test('every margin, padding and gap in the Reports rules sits on the 8-point grid', () => {
  const { found, checked } = offGrid(css);
  // A parser that matched nothing would pass this vacuously.
  assert.ok(checked >= 15, `expected at least 15 Reports rules, found ${checked}`);
  assert.deepEqual(found, [], `off-grid spacing:\n${found.join('\n')}`);
});
