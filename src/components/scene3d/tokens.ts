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
  /**
   * Phase M: mechanical value sync only — index.css's :root flipped to v4's light
   * glassmorphism, so these mirror it exactly per this file's drift-guard job, but the
   * scene's actual light rig/materials are untouched here. The 3D viewport stays dark by
   * design even on this light page (see the Phase M plan §4's "3D re-light" — a separate,
   * scoped pass that fixes fixture-color legibility against that dark backdrop). Until
   * that lands, these values are correct as a *mirror* and not yet re-tuned for how they
   * render against the dark canvas.
   */
  accent: '#f59e0b',
  good: '#037756',
  warn: '#ae4d03',
  bad: '#b91c1c',
  bgSurface2: '#f8fafc',
  border: '#e2e8f0',
  muted: '#475569',
  muted2: '#5f6b7d',
  txt: '#1e293b',
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
  // Phase M re-light: v4's care-office-3d.js wall/floor values, replacing TEST2's darker
  // grey-blue — this scene now renders under real light on a light page, not unlit on dark.
  wall: 0xd6dde8,
  baseboard: 0x8893a4,
  floorBase: 0xc9d2de,
  floorGrid: 0xaeb7c4,
  glassFrame: 0xaeb9c8,
  glassPane: 0xbfe0f0,
  windowGlass: 0x9fd0ec,
  windowFrame: 0xeef2f7,
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
  /** Base color of an "off" outlet socket block — dark plastic, not a hole. Lifted from the
   * old LED disc's 0x1b2129 (near-black) as part of Phase N's enlarged, standoff-corrected
   * outlets — see officeScene.ts's `socketMaterial()`. */
  outletSocketBase: 0x2a323d,
  ledOn: 0x27c79a,
  padConcrete: 0x9aa0a8,
  // Phase N — lit-room realism and the glazed partition (officeScene.ts §1.2/§1.3).
  /** Warm floor light-pool under a lit luminaire — unlit MeshBasicMaterial, additive. */
  lightPool: 0xffe3b0,
  /** The per-row PointLight's own color. */
  lampWhite: 0xfff1d6,
  /** Office-partition glazing — clearer than the window/door glass, since the partition is
   * now full height and this pane is the only remaining sightline into the compartment. */
  partitionGlass: 0xcfe6f2,
  /** Selection ring under a picked "Edit layout" desk/table (`officeScene.ts`'s
   * `buildEditablePiece`) — the app's own `--blue-bright` (`index.css`), not a scene-interior
   * material color: this ring is UI feedback for an editing tool, not part of the room, so it
   * borrows the app's own accent-for-selection vocabulary (the same blue Analytics' selected
   * source card rings with — see `.analytics-source-card--selected`) rather than inventing a
   * new one. */
  editSelection: 0x3b82f6,
} as const;
