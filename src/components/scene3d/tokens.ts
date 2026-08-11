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

/**
 * Interior material palette for the 3D scene's furniture and shell — deliberately NOT part
 * of `TOKENS` above and NOT drift-guarded against `index.css`. These are colors for
 * physical materials (desk wood, chair fabric, wall paint, ACU plastic) that have no UI
 * equivalent to mirror; they're sourced from TEST2.html's own furniture factories (a
 * light, desaturated grey-blue interior with warm wood desks and navy chairs), not from
 * this app's amber/gold UI chrome, which is a deliberately separate palette — see
 * `officeScene.ts`'s header comment on why the scene needs its own lighting-responsive
 * colors instead of the UI's unlit emissive tokens.
 */
export const SCENE_PALETTE = {
  wood: 0xb38b58,
  metal: 0x4a5568,
  chairFabric: 0x2d3a52,
  keyboard: 0x20262f,
  wall: 0xccd4df,
  baseboard: 0x7a8494,
  floorGrout: 0x8c93a1,
  floorTileLight: 0xb0b5be,
  floorTileDark: 0xa5abb5,
  monitorScreen: 0x1b4a73,
  monitorBody: 0x090d12,
  towerBody: 0x1f242b,
  cabinetBody: 0x8a98ad,
  cabinetShelf: 0x6f7c91,
  workbenchTop: 0x6b7280,
  workbenchBack: 0x8a98ad,
  acuBody: 0xf4f7fb,
  acuLouver: 0x3a567d,
  acuDisplay: 0x12325a,
  acuGlow: 0x9ad1ff,
  dispenserBody: 0xeef2f6,
  dispenserTray: 0x9fb0c4,
  dispenserHotTap: 0xd9433a,
  dispenserColdTap: 0x3a78d9,
  plantLeafLight: 0x59c05e,
  plantLeafDark: 0x3fa64a,
  plantStem: 0x2f6b3a,
  outletFaceplate: 0xdee3eb,
  outletSocketFace: 0xcbd2db,
  ledOn: 0x27c79a,
  padConcrete: 0x9aa0a8,
} as const;
