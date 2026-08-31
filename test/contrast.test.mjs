/**
 * FI-008 — every text token clears WCAG AA against every surface it can land on, in both themes.
 *
 * WHY THIS EXISTS. Three separate AA failures were found by hand during one audit, and one of
 * them — `.space-tree-panel__name` at **1.14:1** in dark mode — shipped. `test/design-tokens.test.mjs`
 * closed the cheaper half of that (a token name that was never defined). This closes the other
 * half, which its own header names and defers: *"a token that exists can still be unreadable on a
 * given background"*.
 *
 * THE FAILURE MODE THIS CATCHES IS LATENT, NOT VISIBLE. FI-007 states it exactly: a colour
 * "passes everywhere it currently renders, but will fail the first time" it is placed somewhere
 * new. Checking only the pairs the app composes today would make this file agree with every such
 * hazard instead of finding it. So every text token is measured against every surface that
 * carries text, whether or not that combination exists yet — the palette is a promise that any
 * tier may sit on any surface, and this is that promise being kept.
 *
 * WHAT IT DOES NOT DO. It does not read the DOM, so it cannot catch text placed on a background
 * that is not a palette surface (a gradient, an image, an inline colour). It measures the palette,
 * not the page. A real browser is still the only thing that can measure a composition — which is
 * what found the 1.14:1 in the first place.
 *
 * TWO PARSING TRAPS, BOTH PAID FOR WHILE WRITING THIS.
 *   1. `:root` also appears INSIDE `@media (prefers-contrast: high)`, which redefines `--muted`
 *      and `--muted-2`. Folding that into the base palette made `--muted` measure identically to
 *      `--txt` — a wrong number that looked entirely plausible. Only top-level blocks (selector at
 *      column 0) are the palette; an indented one is a conditional override.
 *   2. Translucent tokens must be composited before they mean anything. `--glass` is
 *      `rgb(255 255 255 / 0.75)`; over `--bg-page` that resolves to ~rgb(251,252,253), which is
 *      the exact figure `src/index.css` documents for its own hand-verification. That agreement
 *      is what says the maths here matches the maths the palette was designed with.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8');

/** WCAG 2.2 SC 1.4.3: normal-size text. Large text may sit at 3:1, but a palette token cannot
 * know what size it will be used at, so the palette is held to the stricter bar. */
const AA_NORMAL = 4.5;

/**
 * Text colours. Every one of these is used as `color:` somewhere in the stylesheet.
 *
 * `--good`/`--warn`/`--bad` were missed on the first pass and that mattered immediately: `--bad`
 * is a *hand-copied duplicate* of `--red` carrying the comment `= --red`, so raising `--red` to
 * clear AA left the copy behind at 4.33:1 — the fix and the bug living four lines apart. It has
 * to stay a duplicate, because `scene3d/tokens.ts` mirrors it into a Three.js material and
 * three.js cannot resolve `var()`; the equality its comment asserted is checked at the foot of
 * this file instead.
 *
 * Deliberately absent: `--accent` (2.15:1 in light — the stylesheet ships `--accent-text` for
 * exactly this reason) and `--faint`/`--faintest`, which are documented decoration-only. Adding
 * them would not find a bug, it would record a rule the palette already states.
 */
const TEXT_TOKENS = ['--txt', '--muted', '--muted-2', '--accent-text', '--blue', '--green', '--red', '--purple', '--good', '--warn', '--bad'];

/** Surfaces that carry text. `--bg-page` is deliberately absent: content sits on a card or a
 * glass panel, never directly on the page, and `--glass` over the page is the composite that
 * actually appears. FI-007 tracks the one token where that distinction bites. */
const SURFACE_TOKENS = ['--bg-surface', '--bg-surface-2', '--bg-inset', '--glass', '--glass-2', '--pop-bg', '--field-bg', '--chip-bg'];

/**
 * Read one top-level block's custom properties. `selector` is matched at column 0 only — see
 * trap 1 above.
 */
function paletteOf(selectorSource) {
  const found = {};
  const re = new RegExp(`(^|\\n)${selectorSource}\\s*\\{`, 'g');
  // `re.exec` for its side effect on `lastIndex` — the match itself is not needed, only where
  // the block starts, so the brace walk below can find where it ends.
  while (re.exec(css) !== null) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    for (const d of css.slice(re.lastIndex, i - 1).matchAll(/(^|[;{\s])(--[a-zA-Z0-9-_]+)\s*:\s*([^;]+);/g)) {
      found[d[2]] = d[3].trim();
    }
  }
  return found;
}

const LIGHT = paletteOf(':root');
const DARK = { ...LIGHT, ...paletteOf(":root\\[data-theme='dark'\\]") };

/** `#rgb`, `#rrggbb`, `rgb()`/`rgba()` in either syntax, or a `var()` pointing at one of those. */
function parseColor(value, palette, depth = 0) {
  if (typeof value !== 'string' || depth > 5) return null;
  const v = value.trim();

  const ref = v.match(/^var\(\s*(--[a-zA-Z0-9-_]+)/);
  if (ref) return parseColor(palette[ref[1]], palette, depth + 1);

  const six = v.match(/^#([0-9a-fA-F]{6})$/);
  if (six) {
    const n = parseInt(six[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const three = v.match(/^#([0-9a-fA-F]{3})$/);
  if (three) {
    const [x, y, z] = three[1];
    return { r: parseInt(x + x, 16), g: parseInt(y + y, 16), b: parseInt(z + z, 16), a: 1 };
  }
  const rgb = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[/,]\s*([\d.]+)\s*)?\)$/);
  if (rgb) return { r: +rgb[1], g: +rgb[2], b: +rgb[3], a: rgb[4] === undefined ? 1 : +rgb[4] };

  return null;
}

const channel = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ({ r, g, b }) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

/** Source-over compositing. A translucent colour is not a colour until it has a backdrop. */
const composite = (fg, bg) =>
  fg.a >= 1
    ? fg
    : { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 };

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('the contrast maths is right, so a passing palette means something', () => {
  // Without this the rest of the file could be measuring anything at all and reporting success.
  const black = { r: 0, g: 0, b: 0, a: 1 };
  const white = { r: 255, g: 255, b: 255, a: 1 };
  assert.equal(Math.round(contrast(black, white)), 21);
  assert.equal(contrast(white, white), 1);
  // A known AA boundary: #767676 on white is the canonical 4.54:1 example.
  assert.ok(Math.abs(contrast(parseColor('#767676', {}), white) - 4.54) < 0.02);
});

test('a half-transparent white over black composites to mid grey, not to white', () => {
  const mid = composite({ r: 255, g: 255, b: 255, a: 0.5 }, { r: 0, g: 0, b: 0, a: 1 });
  assert.equal(Math.round(mid.r), 128);
});

test('the glass composite matches the figure the stylesheet documents for itself', () => {
  // src/index.css says the glass-over-page composite is ~rgb(251,252,253). Agreement here is
  // what ties this file's maths to the hand-verification the palette was built on.
  const glass = composite(parseColor(LIGHT['--glass'], LIGHT), parseColor(LIGHT['--bg-page'], LIGHT));
  assert.deepEqual([Math.round(glass.r), Math.round(glass.g), Math.round(glass.b)], [251, 252, 253]);
});

test('both palettes were actually read, and the dark one overrides the light', () => {
  // The prefers-contrast trap: if an indented `:root` were folded in, --muted would equal --txt.
  assert.ok(Object.keys(LIGHT).length > 40, `light palette looks empty: ${Object.keys(LIGHT).length} tokens`);
  assert.notEqual(LIGHT['--muted'], LIGHT['--txt'], 'a media-query :root has leaked into the base palette');
  assert.notEqual(DARK['--bg-surface'], LIGHT['--bg-surface'], 'the dark block was not read');
});

for (const [themeName, palette] of [['light', LIGHT], ['dark', DARK]]) {
  const page = parseColor(palette['--bg-page'], palette);

  test(`${themeName}: every text token is a colour this file can actually measure`, () => {
    // A token that fails to parse would silently drop out of the matrix below, leaving a guard
    // that passes because it checked nothing — the exact shape of the three guards that could
    // not fire.
    for (const token of [...TEXT_TOKENS, ...SURFACE_TOKENS]) {
      assert.ok(parseColor(palette[token], palette), `${token} did not parse: ${palette[token]}`);
    }
    assert.ok(page, '--bg-page did not parse');
  });

  test(`${themeName}: every text token clears AA on every surface that carries text`, () => {
    const failures = [];
    for (const surfaceToken of SURFACE_TOKENS) {
      const surface = composite(parseColor(palette[surfaceToken], palette), page);
      for (const textToken of TEXT_TOKENS) {
        const text = composite(parseColor(palette[textToken], palette), surface);
        const ratio = contrast(text, surface);
        if (ratio < AA_NORMAL) failures.push(`${textToken} on ${surfaceToken}: ${ratio.toFixed(2)}:1`);
      }
    }
    assert.deepEqual(
      failures,
      [],
      `Below ${AA_NORMAL}:1. These are palette-level, so they fail wherever the pair is composed — ` +
        'not only where it is composed today. Lighten the text token rather than narrowing this list.',
    );
  });
}

/**
 * `--bad` is a hand-copied duplicate of `--red` and has to stay one: `scene3d/tokens.ts` mirrors
 * it into a Three.js material, and three.js cannot resolve `var()`. Its comment said `= --red`
 * for both themes and the dark copy had silently drifted — raising `--red` to clear AA left the
 * duplicate four lines away still failing. A comment cannot notice that; this can.
 */
/**
 * `--good` and `--warn` are the same kind of duplicate, carrying the same kind of comment. They
 * agree today; the `--bad` drift is the reason not to take that on trust.
 */
const DUPLICATES = [
  ['--bad', '--red'],
  ['--good', '--green'],
  ['--warn', '--accent-text'],
];

for (const [themeName, palette] of [['light', LIGHT], ['dark', DARK]]) {
  for (const [copy, original] of DUPLICATES) {
    test(`${themeName}: ${copy} is still the same colour as ${original}, which its comment claims`, () => {
      assert.deepEqual(parseColor(palette[copy], palette), parseColor(palette[original], palette));
    });
  }
}

/**
 * FI-007 — a semantic colour on its OWN tint, which is what a badge is.
 *
 * `.badge--good { background: var(--good-soft); color: var(--good); }`, and the same for warn and
 * bad. The tint is translucent, so it composites onto whatever surface the badge sits on and
 * pulls that surface *towards the text colour* — which is exactly the direction that destroys
 * contrast. Every pair here loses between 0.4 and 1.5 against its plain-surface figure.
 *
 * FI-007 recorded one instance of this (`--good` at 4.45:1 on the page, 4.99 on a card) and read
 * it as a hazard for later. Measuring the whole set showed it was already live in three of the
 * four dark-theme semantics.
 *
 * The pairs are the palette's own contract — a `-soft` token exists to be the background for its
 * matching text colour — so all of them are measured, not only the three the stylesheet composes
 * in `.badge--*` today. That is the same reasoning as the surface matrix above.
 */
const TINT_PAIRS = [
  ['--good', '--good-soft'],
  ['--warn', '--warn-soft'],
  ['--bad', '--bad-soft'],
  ['--blue', '--blue-soft'],
  ['--green', '--green-soft'],
  ['--red', '--red-soft'],
  ['--accent-text', '--accent-soft'],
];

for (const [themeName, palette] of [['light', LIGHT], ['dark', DARK]]) {
  const page = parseColor(palette['--bg-page'], palette);

  test(`${themeName}: a badge's text clears AA on its own tint, over every surface`, () => {
    const failures = [];
    for (const [textToken, tintToken] of TINT_PAIRS) {
      const text = parseColor(palette[textToken], palette);
      const tint = parseColor(palette[tintToken], palette);
      assert.ok(text && tint, `${textToken}/${tintToken} did not parse`);
      for (const surfaceToken of SURFACE_TOKENS) {
        // Two composites, in order: the tint sits on the surface, the text sits on that.
        const surface = composite(parseColor(palette[surfaceToken], palette), page);
        const chip = composite(tint, surface);
        const ratio = contrast(composite(text, chip), chip);
        if (ratio < AA_NORMAL) failures.push(`${textToken} on ${tintToken} over ${surfaceToken}: ${ratio.toFixed(2)}:1`);
      }
    }
    assert.deepEqual(
      failures,
      [],
      `Below ${AA_NORMAL}:1. Lowering the tint's alpha cannot fix all of these — some of the text ` +
        'tokens sit under 4.6 on the darkest flat surface before any tint is applied at all.',
    );
  });
}
