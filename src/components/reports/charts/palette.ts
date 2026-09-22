import type { ChartPalette } from './types';

/**
 * Two palettes, because a chart has two backdrops and only one of them is a token.
 *
 * ON SCREEN the values are `var(--…)` references, so they resolve against whichever theme the
 * kiosk is set to with no code at all — the theme toggle is `data-theme` on `:root` and CSS does
 * the rest.
 *
 * IN THE PDF there is no stylesheet and no theme. **Paper is white.** So the print palette is
 * concrete hex, mirroring the LIGHT `:root` block, and a reader who happens to have dark mode on
 * still gets a document that can be printed. This also removes the whole question of resolving
 * custom properties at export time.
 *
 * Resolving tokens at click time with `getComputedStyle` was the obvious alternative and loses
 * three ways: it makes the generators DOM-dependent, destroying the "pure function, returns a
 * value, unit-testable" property that is the entire reason these charts are hand-rolled rather
 * than Recharts; it would emit dark ink for a dark-mode reader; and it is **untestable in this
 * project** — `vite.config.ts` sets `css: false`, so vitest never processes the stylesheet and
 * jsdom returns `''` for every custom property. A guard that cannot run is not a guard.
 *
 * The duplication is the same trade `scene3d/tokens.ts` already makes for Three.js, and it is
 * guarded the same way: `palette.test.ts` fails if `index.css` moves without this file moving.
 *
 * THE SERIES TIER IS NOT THE SCREEN'S TIER, AND THAT IS THE POINT. `AnalyticsPage` draws chart
 * lines in the `-bright` tier because they sit on a tinted card. On white, `--accent` measures
 * **2.15:1** — `index.css` says so itself, and ships `--accent-text` because of it. So print
 * takes the AA-strength tier throughout. `palette.test.ts` asserts this rather than trusting it.
 *
 * WHY TWO SERIES WEAR THE STATUS HUES, AND WHY THAT STAYS — RM-139. Series 0 is the amber of `warn`
 * and series 2 the green of `good` (identical hex in print), so Lighting reads amber and Others green
 * beside amber and green status badges. Re-mapping them was tried, 2026-09-22, against every guard
 * `palette.test.ts` holds — 3:1 on paper, CIE76 ΔE ≥ 25 between print series, every pair apart for
 * full colour vision and under protanopia and deuteranopia, each theme's lightness band — plus the
 * new wish to stay OKLab ΔE×100 ≥ 15 from good, warn and bad. With blue and purple kept, no pair of
 * replacements passes all three renderings; with all four free, every palette that does needs a
 * rose-red at OKLCH hue ≈ 20°, the fault family. The arc outside green, amber and red holds about
 * three hues a colour-blind reader can tell apart, and this building has four branch circuits.
 * So colour is the second channel: every series also carries a pattern (`SERIES_DASH`) and its name
 * beside the plot, and status is never said by colour alone — the badges carry words.
 */

/**
 * A line pattern per series index, so a line is its circuit's before its colour is — RM-139. Solid,
 * long dash, dotted, dash-dot: four shapes that stay four at a 2 px stroke and in the PDF, which draws
 * `stroke-dasharray` like any other attribute. Indexed like `series`, by the circuit's fixed
 * `colourIndex`, so a circuit keeps its pattern as it keeps its colour.
 */
export const SERIES_DASH: readonly (string | undefined)[] = [undefined, '8 3', '2 3', '9 3 2 3'];

/** Which CSS custom property each print value claims to be. The drift guard reads this. */
export const PRINT_MIRROR = {
  ink: '--txt',
  text: '--txt',
  textMuted: '--muted',
  grid: '--border',
  surface: '--bg-surface',
  good: '--good',
  warn: '--warn',
  bad: '--bad',
  gap: '--muted-2',
  threshold: '--red',
  series0: '--accent-text',
  series1: '--blue',
  series2: '--green',
  series3: '--purple',
  heat0: '--heat-1',
  heat1: '--heat-2',
  heat2: '--heat-3',
  heat3: '--heat-4',
  heat4: '--heat-5',
} as const;

export const PRINT_PALETTE: ChartPalette = {
  ink: '#1e293b',
  text: '#1e293b',
  textMuted: '#475569',
  grid: '#e2e8f0',
  surface: '#ffffff',
  /** Four, matching the four branch meters this building actually has. */
  series: ['#ae4d03', '#1e5ce4', '#037756', '#6200be'],
  /** White on every AA-tier series: 5.4–9.3:1. The screen's bright tier needs dark ink on three (RM-139). */
  seriesText: ['#ffffff', '#ffffff', '#ffffff', '#ffffff'],
  good: '#037756',
  warn: '#ae4d03',
  bad: '#b91c1c',
  gap: '#5f6b7d',
  threshold: '#b91c1c',
  heat: ['#dbeafe', '#93c5fd', '#60a5fa', '#2563eb', '#1e3a8a'],
  /**
   * Roboto, not the app's Manrope. pdfmake's bundled font container IS Roboto, and a label
   * inside an inline SVG is measured by the same font machinery as the body text around it —
   * naming a face the document does not embed gets a substitution, and the failure mode is
   * labels that overlap rather than an error. Embedding Manrope would ship the font twice for
   * a document nobody reads beside the screen. Part of the palette rather than a literal in
   * the generators precisely so this stays one decision in one place.
   */
  fontFamily: 'Roboto',
};

export const SCREEN_PALETTE: ChartPalette = {
  ink: 'var(--txt)',
  text: 'var(--txt)',
  textMuted: 'var(--muted)',
  grid: 'var(--border)',
  surface: 'var(--bg-surface)',
  series: ['var(--accent)', 'var(--blue-bright)', 'var(--green-bright)', 'var(--purple-bright)'],
  seriesText: ['var(--on-series-0)', 'var(--on-series-1)', 'var(--on-series-2)', 'var(--on-series-3)'],
  good: 'var(--good)',
  warn: 'var(--warn)',
  bad: 'var(--bad)',
  gap: 'var(--muted-2)',
  threshold: 'var(--bad)',
  heat: ['var(--heat-1)', 'var(--heat-2)', 'var(--heat-3)', 'var(--heat-4)', 'var(--heat-5)'],
  /** Inherits the page's own stack rather than naming a face — the charts are part of the page. */
  fontFamily: 'inherit',
};
