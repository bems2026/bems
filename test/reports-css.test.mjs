/**
 * Two Reports-page surfaces the page depends on and vitest cannot see — RM-104 and RM-107.
 *
 * `vite.config.ts` runs the component tests with `css: false`, so a rule can vanish from
 * `index.css` and every React test stays green. The touch-target and 8-point guards in this
 * directory exist for that reason, and this file joins them for two rules that carry a promise:
 *
 *  - THE HERO TILE IS THE ONE ELEVATED SURFACE on the report (RM-104). It wears the same lift the
 *    app's cards do — `--shadow-card` and the `--card-lip` highlight — and a rule of `--accent-text`
 *    along its top, so the headline figure reads first without a gradient nothing can measure.
 *    Every other KPI tile stays flat; the contrast guard measures tokens, and these are tokens.
 *
 *  - THE EXPORT IS THE ONE PRIMARY ACTION on the page (RM-108). It wears the inverted chip the active
 *    pills already wear — measured in both themes — and answers a hover and a press with motion,
 *    inside the global reduced-motion rule. On the kiosk's touchscreen it is a 44px target.
 *
 *  - A MONTH'S TABLE KEEPS ITS HEADERS (RM-107). Thirty-one 40px rows scroll the column captions
 *    off the top of an 800x480 kiosk. The `thead` is sticky inside a bounded scroll box, and it is
 *    painted, because a transparent sticky header shows the rows sliding beneath it.
 *
 * Positive controls first: a synthetic sheet missing each promise must be flagged.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(HERE, '..', 'src', 'index.css'), 'utf8');

/** Innermost `selector { declarations }` blocks, comments removed, declarations as a map. */
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
      if (open && !open.nested) {
        const decls = {};
        for (const d of text.slice(open.start, i).split(';')) {
          const at = d.indexOf(':');
          if (at > 0) decls[d.slice(0, at).trim()] = d.slice(at + 1).trim();
        }
        out.push({ selector: open.selector, decls });
      }
      last = i + 1;
    } else if (ch === ';' && stack.length === 0) {
      last = i + 1;
    }
  }
  return out;
}

/** The merged declarations of every rule whose selector list names `selector` exactly. */
function declarationsOf(source, selector) {
  const merged = {};
  for (const r of rules(source)) {
    if (r.selector.split(',').map((s) => s.trim()).includes(selector)) Object.assign(merged, r.decls);
  }
  return merged;
}

function heroFindings(source) {
  const d = declarationsOf(source, '.report-kpis .report-kpi--hero');
  const findings = [];
  if (!/var\(--shadow-card\)/.test(d['box-shadow'] ?? '')) findings.push('hero has no --shadow-card lift');
  if (!/var\(--card-lip\)/.test(d['box-shadow'] ?? '')) findings.push('hero has no --card-lip highlight');
  if (!/var\(--accent-text\)/.test(d['border-top'] ?? '')) findings.push('hero has no --accent-text top rule');
  return findings;
}

function primaryFindings(source) {
  const base = declarationsOf(source, '.report-primary-btn');
  const hover = declarationsOf(source, '.report-primary-btn:not(:disabled):hover');
  const active = declarationsOf(source, '.report-primary-btn:not(:disabled):active');
  const findings = [];
  if (!/var\(--txt\)/.test(base.background ?? '')) findings.push('primary button is not the inverted chip');
  if (!base.transition) findings.push('primary button has no transition');
  if (!hover.transform) findings.push('primary button does not move on hover');
  if (!active.transform) findings.push('primary button does not move on press');
  const coarse = source.slice(source.lastIndexOf('@media (pointer: coarse)'));
  if (!/\.report-primary-btn[,\s]/.test(coarse)) findings.push('primary button is not a 44px target on a touchscreen');
  return findings;
}

function tableFindings(source) {
  const head = declarationsOf(source, '.report-table thead th');
  const box = declarationsOf(source, '.report-table-scroll');
  const findings = [];
  if (head.position !== 'sticky') findings.push('thead th is not sticky');
  if (head.top !== '0') findings.push('thead th has no top: 0');
  if (!/var\(--bg-surface\)/.test(head.background ?? '')) findings.push('thead th is not painted');
  if (!box['max-height']) findings.push('.report-table-scroll has no max-height, so nothing scrolls under the header');
  if (box.overflow !== 'auto') findings.push('.report-table-scroll does not scroll both ways');
  return findings;
}

test('positive control: a sheet without the hero lift or the sticky header is flagged', () => {
  const flat = `
    .report-kpis .report-kpi--hero { grid-column: span 2; }
    .report-table thead th { font-weight: 600; }
    .report-table-scroll { overflow-x: auto; }
  `;
  assert.deepEqual(heroFindings(flat), [
    'hero has no --shadow-card lift',
    'hero has no --card-lip highlight',
    'hero has no --accent-text top rule',
  ]);
  assert.deepEqual(primaryFindings(flat), [
    'primary button is not the inverted chip',
    'primary button has no transition',
    'primary button does not move on hover',
    'primary button does not move on press',
    'primary button is not a 44px target on a touchscreen',
  ]);
  assert.deepEqual(tableFindings(flat), [
    'thead th is not sticky',
    'thead th has no top: 0',
    'thead th is not painted',
    '.report-table-scroll has no max-height, so nothing scrolls under the header',
    '.report-table-scroll does not scroll both ways',
  ]);
});

test('positive control: a sheet that keeps both promises is clean', () => {
  const kept = `
    .report-kpis .report-kpi--hero { border-top: 3px solid var(--accent-text); box-shadow: var(--shadow-card), inset 0 1px 0 var(--card-lip); }
    .report-table thead th { position: sticky; top: 0; background: var(--bg-surface); }
    .report-table-scroll { max-height: min(70vh, 640px); overflow: auto; }
    .report-primary-btn { background: var(--txt); transition: transform 0.15s ease; }
    .report-primary-btn:not(:disabled):hover { transform: translateY(-1px); }
    .report-primary-btn:not(:disabled):active { transform: scale(0.97); }
    @media (pointer: coarse) { .report-primary-btn, .x { min-height: 44px; } }
  `;
  assert.deepEqual(primaryFindings(kept), []);
  assert.deepEqual(heroFindings(kept), []);
  assert.deepEqual(tableFindings(kept), []);
});

test('RM-104: the hero KPI tile is the one lifted surface, in tokens the contrast guard measures', () => {
  assert.deepEqual(heroFindings(css), []);
});

test('RM-108: the export is the one primary action, and it answers a hover and a press', () => {
  assert.deepEqual(primaryFindings(css), []);
});

test('RM-107: a report table keeps its column headers while its rows scroll', () => {
  assert.deepEqual(tableFindings(css), []);
});
