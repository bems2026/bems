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
  accent: '#e8a33d',
  good: '#4ade80',
  warn: '#fbbf24',
  bad: '#f87171',
  bgSurface2: '#1a1d23',
  border: '#24272e',
  muted: '#8b8f99',
  muted2: '#5c606b',
  txt: '#f0eee9',
} as const;
