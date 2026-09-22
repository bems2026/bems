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
 *  - A CHART FITS A PHONE (found live 2026-09-17). `.report-charts` is a grid, and a grid's implicit
 *    column is as wide as its widest content: the drawings' 460px minimum. At 375px every figure was
 *    493px in a 319px column, and `.app-content` clips horizontal overflow, so the right third of every
 *    chart was cut off with nothing to scroll. The column has to be allowed to shrink, so the scroll
 *    `.report-chart__plot` already provides takes over.
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

function chartColumnFindings(source) {
  const grid = declarationsOf(source, '.report-charts');
  const figure = declarationsOf(source, '.report-chart');
  const findings = [];
  if (!/minmax\(\s*0(px)?\s*,\s*1fr\s*\)/.test(grid['grid-template-columns'] ?? '')) {
    findings.push('.report-charts has no column that can shrink below its drawings');
  }
  if (figure['min-width'] !== '0') findings.push('.report-chart can still be held open by its content');
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
  assert.deepEqual(chartColumnFindings('.report-charts { display: grid; } .report-chart { position: relative; }'), [
    '.report-charts has no column that can shrink below its drawings',
    '.report-chart can still be held open by its content',
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
  assert.deepEqual(chartColumnFindings('.report-charts { grid-template-columns: minmax(0, 1fr); } .report-chart { min-width: 0; }'), []);
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

test('a report chart fits a phone: its column shrinks, and the drawing scrolls inside the plot', () => {
  assert.deepEqual(chartColumnFindings(css), []);
});

// RM-140. The Reports page crossfades a period change with the native View Transitions API. The global
// reduced-motion block zeroes animations on `*`, and `*` does not match the `::view-transition-*`
// pseudo-elements — so without naming them, a reader who asked for less motion would still get the fade
// wherever the script's own check was missed.
test('the global reduced-motion block reaches the view-transition pseudo-elements', () => {
  const blocks = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]);
  const global = blocks.find((b) => /(^|\n)\s*\*[\s,{]/.test(b));
  assert.ok(global, 'no reduced-motion block names `*`');
  for (const pseudo of ['::view-transition-group(*)', '::view-transition-old(*)', '::view-transition-new(*)']) {
    assert.ok(global.includes(pseudo), `the global reduced-motion block does not name ${pseudo}`);
  }
});

test('the report control bar stays put while the page crossfades under it', () => {
  const bar = declarationsOf(css, '.report-controls');
  assert.equal(bar['view-transition-name'], 'report-controls');
});

// RM-141. The day calendar's seven 40 px columns and six 4 px gaps are 304 px, in a popover whose content
// box was 302 px (320 less 8 px padding and a 1 px border each side) — and on a touch screen each cell is
// 44 px inside a 40 px column. Both gave the popover a horizontal scrollbar at every screen size. This
// reads the width the picker asks for and the grid the stylesheet draws, and requires the one to hold the
// other: at a mouse, and at a finger on a 360 px phone, where the popover is capped at 360 − 16.
test('the day calendar fits the popover the picker asks for, at a mouse and at a finger', () => {
  const picker = readFileSync(join(HERE, '..', 'src', 'components', 'reports', 'PeriodPicker.tsx'), 'utf8');
  const asked = /preferredWidth:\s*period === 'day' \? (\d+) : \d+/.exec(picker);
  assert.ok(asked, 'PeriodPicker no longer states the width it asks for a day');
  const inside = (popover) => popover - 2 * 8 - 2 * 1;
  const px = (v) => (v === 'var(--sp-1)' ? 4 : v === '0' || v === undefined ? 0 : Number.parseFloat(v));
  const grid = (decls) => {
    const m = /repeat\(\s*(\d+),\s*(\d+)px\s*\)/.exec(decls['grid-template-columns'] ?? '');
    assert.ok(m, `no fixed-column day grid: ${decls['grid-template-columns']}`);
    return Number(m[1]) * Number(m[2]) + (Number(m[1]) - 1) * px(decls.gap);
  };
  const coarseAt = css.indexOf('@media (pointer: coarse)');
  const fine = declarationsOf(css.slice(0, coarseAt), '.report-calendar__daygrid');
  const coarse = { ...fine, ...declarationsOf(css.slice(coarseAt), '.report-calendar__daygrid') };
  const width = Number(asked[1]);
  assert.ok(grid(fine) <= inside(width), `mouse: ${grid(fine)} px of grid in ${inside(width)} px`);
  assert.ok(Number.parseFloat(coarse['grid-template-columns'].match(/(\d+)px/)[1]) >= 44, 'a finger’s column is narrower than its 44 px cell');
  assert.ok(grid(coarse) <= inside(Math.min(width, 360 - 16)), `finger on a phone: ${grid(coarse)} px of grid in ${inside(Math.min(width, 344))} px`);
});

// RM-141. The export drawer is the shared floating panel, capped at `100vh`: on a phone whose browser bar
// comes and goes, 100vh is taller than what is visible, and a centred panel loses its heading and Close
// above the top. The dynamic unit is the visible height, with `vh` first for a browser without it. And on the
// 800×480 kiosk the body scrolls — Generate, the one control the drawer exists for, scrolled away with it.
test('the floating panel caps at the visible height, with a fallback', () => {
  const rule = /\n\.overlay-panel \{([^}]*)\}/.exec(css);
  assert.ok(rule, 'no .overlay-panel rule');
  const caps = [...rule[1].matchAll(/max-height:\s*([^;]+);/g)].map((m) => m[1].trim());
  assert.deepEqual(caps, ['calc(100vh - var(--sp-4) * 2)', 'calc(100dvh - var(--sp-4) * 2)']);
});

test('the export drawer keeps Generate in reach while its options scroll', () => {
  const actions = declarationsOf(css, '.report-export__actions');
  assert.equal(actions.position, 'sticky');
  // Down into the body's own 20 px padding, which the browser otherwise keeps clear under a sticky row.
  assert.equal(actions.bottom, 'calc(var(--sp-5) * -1)');
  assert.equal(actions.background, 'var(--pop-bg)');
});
