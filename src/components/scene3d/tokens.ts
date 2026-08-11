/**
 * Hex mirror of the CSS custom properties in `src/index.css`'s `:root` block. Three.js
 * materials need real color values, not CSS custom properties, and reading them via
 * `getComputedStyle` at scene-init time would make every material color a runtime DOM
 * dependency for what should be pure, testable functions (`materials.ts`). Duplicated
 * instead — `tokens.test.ts` fails loudly if `index.css` changes without this file being
 * updated to match, the same drift-guard pattern used for `shared/registry.mjs` vs the
 * generated Node-RED flow.
 */
export const TOKENS = {
  // Phase L: dark charcoal + dark gold glassmorphism — see index.css's :root docblock.
  accent: '#e6a100',
  good: '#4ade80',
  warn: '#fbbf24',
  bad: '#f87171',
  bgSurface2: '#241f18',
  border: '#3a3226',
  muted: '#b8b0a0',
  muted2: '#9b9384', // WCAG AA, recomputed for glass, Phase L — see index.css's --muted-2 comment
  txt: '#ffffff',
} as const;
