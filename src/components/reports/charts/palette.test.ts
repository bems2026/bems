import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PRINT_PALETTE, PRINT_MIRROR, SCREEN_PALETTE } from './palette';

/**
 * Two guards, and they answer different questions.
 *
 * THE FIRST IS DRIFT — the same job `scene3d/tokens.test.ts` does for the 3D scene, and for the
 * same reason: a consumer that cannot resolve `var()` needs concrete values, so the values get
 * duplicated, so something has to fail when the original moves.
 *
 * THE SECOND IS NEW, AND IT IS THE POINT. `test/contrast.test.mjs` measures every text token
 * against every palette SURFACE, and its own header says what it does not do: *"It measures the
 * palette, not the page."* Paper is not a palette surface. A colour can pass every check that
 * file makes and still be unreadable printed, because the lightest surface it is measured
 * against is `--bg-surface` — which happens to be #ffffff, so for once the two agree. They will
 * not agree the first time the light theme's surface stops being pure white, and the whole
 * reason this file exists is that the PDF's backdrop is not a token at all.
 *
 * `--accent` is the worked example: `index.css` documents it at **2.15:1 against white** and
 * ships `--accent-text` because of it. So the print series takes the AA-strength tier
 * (`--accent-text`, `--blue`, `--green`, `--purple`), never the `-bright` tier the screen uses
 * for lines on a tinted card.
 */

const CSS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'index.css'), 'utf8');

/**
 * Only TOP-LEVEL `:root` is the light palette. `:root` also appears indented inside
 * `@media (prefers-contrast: high)`, and folding that in is the trap `test/contrast.test.mjs`
 * paid for: it made `--muted` measure identically to `--txt` — a wrong number that looked
 * entirely plausible. A declaration is the base palette only if its `:root` sits at column 0.
 */
function lightRootBlock(): string {
  const start = CSS.indexOf('\n:root {');
  if (start === -1) throw new Error('no top-level :root block in index.css');
  const end = CSS.indexOf('\n}', start);
  return CSS.slice(start, end);
}

function cssVar(name: string): string {
  const m = lightRootBlock().match(new RegExp(`\\n\\s+${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`${name} not found in the top-level :root block`);
  // Strip a trailing comment — several of these tokens carry their measured ratio inline.
  return m[1].replace(/\/\*.*$/, '').trim();
}

// --- WCAG maths ---------------------------------------------------------------------------
// A second copy of what `test/contrast.test.mjs` holds. Deliberately not extracted to a shared
// module: it is test-only arithmetic, that file runs under `node --test` and this one under
// vitest, and production code should not carry it. Both copies self-verify against known
// values below, so a copy that has drifted cannot report success.

const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

function rgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) throw new Error(`not a 6-digit hex colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

const luminance = (hex: string) => {
  const { r, g, b } = rgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** sRGB -> CIE L*a*b*, D65. Needed because contrast answers "can I read it" and says nothing
 *  about "can I tell these two apart", which is the question a categorical palette asks. */
function lab(hex: string): [number, number, number] {
  const { r, g, b } = rgb(hex);
  const [lr, lg, lb] = [r, g, b].map(channel);
  // Linear sRGB -> XYZ (D65), then normalised by the D65 white point.
  const x = (0.4124 * lr + 0.3576 * lg + 0.1805 * lb) / 0.95047;
  const y = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
  const z = (0.0193 * lr + 0.1192 * lg + 0.9505 * lb) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 — plain Euclidean distance in Lab. */
function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

const PAPER = '#ffffff';

describe('the colour maths is right, so a passing palette means something', () => {
  it('reproduces the known contrast anchors', () => {
    expect(Math.round(contrast('#000000', '#ffffff'))).toBe(21);
    expect(contrast('#ffffff', '#ffffff')).toBe(1);
    // The canonical AA boundary example.
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 1);
  });

  it('reproduces the known Lab anchors', () => {
    // Without these the ΔE assertions below could be measuring anything and reporting success.
    const [lw, aw, bw] = lab('#ffffff');
    expect(lw).toBeCloseTo(100, 1);
    expect(aw).toBeCloseTo(0, 1);
    expect(bw).toBeCloseTo(0, 1);
    expect(lab('#000000')[0]).toBeCloseTo(0, 1);
    // Mid grey sits near L*=53.6 — the standard sanity value for #808080.
    expect(lab('#808080')[0]).toBeCloseTo(53.6, 0);
    expect(deltaE('#ffffff', '#ffffff')).toBe(0);
    // Pure red against pure green is about as far apart as sRGB gets.
    expect(deltaE('#ff0000', '#00ff00')).toBeGreaterThan(100);
  });
});

/** `series0` -> PRINT_PALETTE.series[0], `heat2` -> .heat[2], anything else -> that field. */
function printValue(key: string): string {
  const indexed = /^(series|heat)(\d+)$/.exec(key);
  if (indexed) {
    const arr = indexed[1] === 'series' ? PRINT_PALETTE.series : PRINT_PALETTE.heat;
    const v = arr[Number(indexed[2])];
    if (v === undefined) throw new Error(`${key} is mirrored but the palette has no such entry`);
    return v;
  }
  const v = (PRINT_PALETTE as unknown as Record<string, unknown>)[key];
  if (typeof v !== 'string') throw new Error(`${key} is mirrored but the palette has no such field`);
  return v;
}

describe('PRINT_PALETTE mirrors the light :root block of index.css', () => {
  it.each(Object.entries(PRINT_MIRROR))('%s mirrors %s', (key, cssName) => {
    expect(printValue(key)).toBe(cssVar(cssName));
  });

  it('declares a mirror for every colour it carries', () => {
    // A palette entry with no mirror entry is a value nothing guards — the exact gap this
    // whole file exists to close, so it is checked in both directions.
    const mirrored = new Set(Object.keys(PRINT_MIRROR));
    PRINT_PALETTE.series.forEach((_, i) => expect(mirrored.has(`series${i}`)).toBe(true));
    PRINT_PALETTE.heat.forEach((_, i) => expect(mirrored.has(`heat${i}`)).toBe(true));
    Object.entries(PRINT_PALETTE)
      .filter(([k, v]) => typeof v === 'string' && k !== 'fontFamily')
      .forEach(([k]) => expect(mirrored.has(k)).toBe(true));
  });
});

describe('PRINT_PALETTE is legible as ink on white paper', () => {
  /**
   * WCAG 2.2 SC 1.4.11 is about graphical objects **required to understand** the content, and
   * that qualifier is load-bearing. `grid` is deliberately absent from this list: a gridline is
   * a reading aid, not a datum, and one that cleared 3:1 would be as loud as the series drawn
   * on top of it. Holding it to this bar would make a measurably worse chart while reporting
   * success — which is the failure mode this whole file is written against. Its real invariant
   * is asserted separately below.
   */
  it.each(['ink', 'gap', 'threshold', 'good', 'warn', 'bad'] as const)(
    '%s clears 3:1 against paper',
    (key) => {
      expect(contrast(PRINT_PALETTE[key], PAPER)).toBeGreaterThanOrEqual(3);
    }
  );

  // SC 1.4.3: text.
  it.each(['text', 'textMuted'] as const)('%s clears 4.5:1 against paper', (key) => {
    expect(contrast(PRINT_PALETTE[key], PAPER)).toBeGreaterThanOrEqual(4.5);
  });

  it('every series colour clears 3:1 against paper', () => {
    // This is the assertion that rejects `--accent` (#f59e0b, 2.15:1) and forces the
    // AA-strength tier. If it ever passes with the bright tier, the maths above is wrong.
    PRINT_PALETTE.series.forEach((c) => expect(contrast(c, PAPER)).toBeGreaterThanOrEqual(3));
  });

  it('the gridline recedes behind the data instead of competing with it', () => {
    // The property a gridline actually has to have, stated as the comparison it is really
    // about: lighter than the ink, and lighter than every series it sits beneath.
    const gridL = luminance(PRINT_PALETTE.grid);
    expect(gridL).toBeGreaterThan(luminance(PRINT_PALETTE.ink));
    PRINT_PALETTE.series.forEach((c) => expect(gridL).toBeGreaterThan(luminance(c)));
    // And still visible on the page it is drawn on.
    expect(contrast(PRINT_PALETTE.grid, PAPER)).toBeGreaterThan(1.1);
  });

  it('series colours are perceptually distinct from one another', () => {
    /**
     * Measured as CIE76 ΔE in Lab, NOT as a difference in luminance.
     *
     * The luminance version of this test is the one I wrote first, and it failed on
     * `--blue` against `--purple` at 0.0078 — two colours nobody would confuse. Luminance is
     * the wrong instrument for a CATEGORICAL palette: it is exactly the axis on which two
     * perfectly distinguishable hues are allowed to coincide. Tightening the threshold until
     * it passed would have been fitting the guard to the palette, and the guard would then
     * have measured nothing.
     *
     * ΔE ≥ 25 is comfortably above the ~2.3 just-noticeable difference and above the ~11 that
     * separates "different shade" from "different colour" — a deliberate margin, because these
     * land as thin lines and small swatches rather than as adjacent blocks.
     */
    const series = PRINT_PALETTE.series;
    series.forEach((a, i) =>
      series.slice(i + 1).forEach((b) => {
        expect(deltaE(a, b), `${a} vs ${b}`).toBeGreaterThanOrEqual(25);
      })
    );
  });
});

describe('the heat ramp reads as an ordered scale', () => {
  // A heat cell carries no text and its value is recoverable from the adjacent data table, so
  // the per-step bar is ordering rather than contrast: a ramp whose steps are not monotonic in
  // luminance encodes magnitude as something the eye cannot rank.
  it('is monotonically darker', () => {
    const lums = PRINT_PALETTE.heat.map(luminance);
    lums.slice(1).forEach((l, i) => expect(l).toBeLessThan(lums[i]));
  });

  it('spans enough range for its ends to be told apart', () => {
    expect(contrast(PRINT_PALETTE.heat[0], PRINT_PALETTE.heat[PRINT_PALETTE.heat.length - 1]))
      .toBeGreaterThanOrEqual(3);
  });

  it('the dark theme INVERTS the ramp rather than reusing the light one', () => {
    // "More" has to read as more ink on paper and more light on a dark screen. Carrying the
    // light ramp across would make an unobserved hour the loudest cell on the page — a chart
    // that is exactly backwards, and looks fine in a swatch strip. --heat-1 stays "least" in
    // both themes, so no generator needs to know which theme it is drawing for.
    const dark = CSS.slice(CSS.indexOf("\n:root[data-theme='dark'] {"));
    const ramp = [1, 2, 3, 4, 5].map((n) => {
      const m = dark.match(new RegExp(`\\n\\s+--heat-${n}:\\s*(#[0-9a-fA-F]{6});`));
      if (!m) throw new Error(`--heat-${n} not overridden for the dark theme`);
      return m[1];
    });
    const lums = ramp.map(luminance);
    lums.slice(1).forEach((l, i) => expect(l).toBeGreaterThan(lums[i]));
    expect(contrast(ramp[0], ramp[4])).toBeGreaterThanOrEqual(3);
  });
});

describe('SCREEN_PALETTE defers to the stylesheet', () => {
  it('is entirely var() references, so it follows the theme toggle with no extra code', () => {
    const values = [
      ...Object.values(SCREEN_PALETTE).filter((v): v is string => typeof v === 'string'),
      ...SCREEN_PALETTE.series,
      ...SCREEN_PALETTE.heat,
    ].filter((v) => v !== SCREEN_PALETTE.fontFamily);
    values.forEach((v) => expect(v).toMatch(/^var\(--[a-z0-9-]+\)$/));
  });

  it('names only custom properties that index.css actually defines', () => {
    // The cheaper half of the drift problem: a var() naming a token nobody declares renders as
    // nothing at all, silently, and only in the theme that was not checked.
    const names = [
      ...Object.values(SCREEN_PALETTE).filter((v): v is string => typeof v === 'string'),
      ...SCREEN_PALETTE.series,
      ...SCREEN_PALETTE.heat,
    ]
      .map((v) => /^var\((--[a-z0-9-]+)\)$/.exec(v)?.[1])
      .filter((n): n is string => Boolean(n));
    names.forEach((n) => expect(CSS).toContain(`${n}:`));
  });

  it('has the same shape as the print palette, so a chart cannot want a colour one of them lacks', () => {
    expect(Object.keys(SCREEN_PALETTE).sort()).toEqual(Object.keys(PRINT_PALETTE).sort());
    expect(SCREEN_PALETTE.series).toHaveLength(PRINT_PALETTE.series.length);
    expect(SCREEN_PALETTE.heat).toHaveLength(PRINT_PALETTE.heat.length);
  });
});
