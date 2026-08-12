/**
 * Furniture geometry factories for the CARE office 3D scene — ported from TEST2.html's
 * furniture library (see the Phase L research report), which builds every piece from
 * primitive `BoxGeometry`/`CylinderGeometry`/`SphereGeometry` assembled into groups, no
 * loaded models. Placement (which factory runs where) lives in `geometry.ts`'s `FURNITURE`
 * table, not here — this file only knows how to build one of each kind at the origin.
 *
 * Shared materials are created once at module scope and reused across every instance
 * (eight desks share one `wood` material) rather than per-call — Three.js materials are
 * safe to share across meshes, and doing so is both TEST2's own pattern and cheaper to
 * dispose.
 */

import * as THREE from 'three';
import { SCENE_PALETTE as P } from './tokens';
import type { FurnitureKind, FurnitureSpec } from './geometry';

const wood = new THREE.MeshStandardMaterial({ color: P.wood, roughness: 0.5, metalness: 0.1 });
const metal = new THREE.MeshStandardMaterial({ color: P.metal, roughness: 0.35, metalness: 0.5 });
const chairFabric = new THREE.MeshStandardMaterial({ color: P.chairFabric, roughness: 0.8 });
const keyboard = new THREE.MeshStandardMaterial({ color: P.keyboard, roughness: 0.8 });
const monitorScreen = new THREE.MeshStandardMaterial({ color: P.monitorBody, emissive: P.monitorScreen, emissiveIntensity: 0.75 });
const towerBody = new THREE.MeshStandardMaterial({ color: P.towerBody, roughness: 0.7 });
const cabinetBody = new THREE.MeshStandardMaterial({ color: P.cabinetBody, roughness: 0.7 });
const cabinetShelf = new THREE.MeshStandardMaterial({ color: P.cabinetShelf, roughness: 0.6 });
const workbenchTop = new THREE.MeshStandardMaterial({ color: P.workbenchTop, roughness: 0.6 });
const workbenchBack = new THREE.MeshStandardMaterial({ color: P.workbenchBack, roughness: 0.7 });
const acuBody = new THREE.MeshStandardMaterial({ color: P.acuBody, roughness: 0.4 });
const acuLouver = new THREE.MeshStandardMaterial({ color: P.acuLouver, roughness: 0.5 });
const acuDisplay = new THREE.MeshStandardMaterial({ color: 0x101a2c, emissive: P.acuDisplay, emissiveIntensity: 0.6 });
const dispenserBody = new THREE.MeshStandardMaterial({ color: P.dispenserBody, roughness: 0.5 });
const dispenserTray = new THREE.MeshStandardMaterial({ color: P.dispenserTray, roughness: 0.6 });
const dispenserBottle = new THREE.MeshStandardMaterial({ color: 0x5fb6e6, transparent: true, opacity: 0.6, roughness: 0.1 });
const dispenserHotTap = new THREE.MeshStandardMaterial({ color: P.dispenserHotTap });
const dispenserColdTap = new THREE.MeshStandardMaterial({ color: P.dispenserColdTap });
const plantLeafA = new THREE.MeshStandardMaterial({ color: P.plantLeafDark, roughness: 0.85 });
const plantLeafB = new THREE.MeshStandardMaterial({ color: P.plantLeafLight, roughness: 0.85 });
const plantStem = new THREE.MeshStandardMaterial({ color: P.plantStem });
const padConcrete = new THREE.MeshStandardMaterial({ color: P.padConcrete, roughness: 0.9 });

/** Adds a mesh to `parent` at a local offset, with shadows on both sides. Ported verbatim from TEST2's `mk()`. */
function mk(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/*
 * Chair geometries, shared across every instance (Stage L4 perf pass). The scene places
 * ~21 chairs (8 workstations + 6 oval + 6 rect + 1 workbench); each chair is 8 meshes, so
 * building a fresh BoxGeometry/CylinderGeometry per chair meant ~170 distinct geometry
 * buffers for what is visually one shape repeated. Three.js meshes sharing one geometry
 * instance is the normal, supported pattern — only the material needs to differ when a
 * mesh's appearance varies, and none of these do (chairs are static, unlit-by-state
 * furniture, never id-bound to a device reading).
 */
const chairSeatGeo = new THREE.BoxGeometry(0.42, 0.07, 0.42);
const chairBackGeo = new THREE.BoxGeometry(0.42, 0.45, 0.07);
const chairPostGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.34, 10);
const chairFootGeo = new THREE.BoxGeometry(0.2, 0.03, 0.05);

/** One 5-star-base office chair, reused by every seated furniture piece. */
function placeChair(parent: THREE.Object3D, x: number, z: number, ry: number) {
  const chair = new THREE.Group();
  mk(chair, chairSeatGeo, chairFabric, 0, 0.44, 0); // seat
  mk(chair, chairBackGeo, chairFabric, 0, 0.66, 0.2); // backrest
  mk(chair, chairPostGeo, metal, 0, 0.22, 0); // gas post
  for (let a = 0; a < 5; a++) {
    const ang = (a / 5) * Math.PI * 2;
    const foot = mk(chair, chairFootGeo, metal, Math.cos(ang) * 0.12, 0.05, Math.sin(ang) * 0.12);
    foot.rotation.y = -ang;
  }
  chair.rotation.y = ry;
  chair.position.set(x, 0, z);
  parent.add(chair);
}

function makeWorkstation(): THREE.Group {
  const g = new THREE.Group();
  mk(g, new THREE.BoxGeometry(1.0, 0.04, 0.62), wood, 0, 0.45, 0); // desktop
  mk(g, new THREE.BoxGeometry(0.035, 0.45, 0.56), metal, -0.46, 0.225, 0); // left leg panel
  mk(g, new THREE.BoxGeometry(0.035, 0.45, 0.56), metal, 0.46, 0.225, 0); // right leg panel
  mk(g, new THREE.BoxGeometry(0.22, 0.02, 0.14), metal, 0, 0.48, -0.17); // monitor foot
  mk(g, new THREE.BoxGeometry(0.04, 0.18, 0.04), metal, 0, 0.56, -0.17); // monitor stem
  mk(g, new THREE.BoxGeometry(0.54, 0.32, 0.03), monitorScreen, 0, 0.72, -0.19); // screen
  mk(g, new THREE.BoxGeometry(0.34, 0.02, 0.12), keyboard, -0.04, 0.48, 0.1);
  mk(g, new THREE.BoxGeometry(0.06, 0.02, 0.09), keyboard, 0.22, 0.48, 0.1); // mouse
  mk(g, new THREE.BoxGeometry(0.16, 0.36, 0.36), towerBody, 0.42, 0.2, 0.16); // PC tower
  placeChair(g, -0.02, 0.5, 0);
  return g;
}

function makeTableOval(): THREE.Group {
  const g = new THREE.Group();
  const top = mk(g, new THREE.CylinderGeometry(0.72, 0.72, 0.06, 32), wood, 0, 0.48, 0);
  top.scale.set(1.2, 1, 0.82);
  mk(g, new THREE.CylinderGeometry(0.2, 0.2, 0.46, 16), metal, 0, 0.23, 0);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    placeChair(g, Math.cos(a) * 1.12, Math.sin(a) * 0.82, Math.PI / 2 - a);
  }
  return g;
}

function makeTableRect(w: number, d: number, n: number): THREE.Group {
  const g = new THREE.Group();
  mk(g, new THREE.BoxGeometry(w, 0.05, d), wood, 0, 0.47, 0);
  mk(g, new THREE.BoxGeometry(w - 0.2, 0.45, d - 0.2), metal, 0, 0.23, 0);
  const cols = Math.ceil(n / 2);
  for (let i = 0; i < n; i++) {
    const side = i < n / 2 ? -1 : 1;
    const col = i % cols;
    const x = -w / 2 + (w / (cols + 1)) * (col + 1);
    const z = side * (d / 2 + 0.36);
    placeChair(g, x, z, side > 0 ? 0 : Math.PI);
  }
  return g;
}

function makeWorkbench(): THREE.Group {
  const g = new THREE.Group();
  mk(g, new THREE.BoxGeometry(1.4, 0.05, 0.62), workbenchTop, 0, 0.78, 0); // worktop
  mk(g, new THREE.BoxGeometry(0.06, 0.78, 0.56), metal, -0.66, 0.39, 0);
  mk(g, new THREE.BoxGeometry(0.06, 0.78, 0.56), metal, 0.66, 0.39, 0);
  mk(g, new THREE.BoxGeometry(1.4, 0.5, 0.05), workbenchBack, 0, 1.08, -0.28); // backboard
  mk(g, new THREE.BoxGeometry(1.4, 0.03, 0.18), cabinetShelf, 0, 1.0, -0.2); // shelf
  mk(g, new THREE.BoxGeometry(0.22, 0.14, 0.2), new THREE.MeshStandardMaterial({ color: 0x2f7a52 }), -0.45, 0.88, -0.05); // instrument
  mk(g, new THREE.CylinderGeometry(0.012, 0.012, 0.18, 8), metal, -0.45, 1.0, 0.06); // probe
  mk(
    g,
    new THREE.BoxGeometry(0.34, 0.24, 0.16),
    new THREE.MeshStandardMaterial({ color: 0x111721, emissive: 0x123322, emissiveIntensity: 0.4 }),
    0.02,
    0.95,
    -0.12,
  ); // scope
  mk(g, new THREE.BoxGeometry(0.4, 0.26, 0.03), monitorScreen, 0.46, 0.95, -0.1); // monitor
  mk(g, new THREE.BoxGeometry(0.18, 0.02, 0.12), new THREE.MeshStandardMaterial({ color: 0x2f6b3a }), 0.18, 0.81, 0.12); // PCB
  placeChair(g, 0, 0.66, 0);
  return g;
}

function makeCabinet(): THREE.Group {
  const g = new THREE.Group();
  mk(g, new THREE.BoxGeometry(0.4, 0.95, 1.5), cabinetBody, 0, 0.475, 0);
  for (let i = 0; i < 6; i++) mk(g, new THREE.BoxGeometry(0.42, 0.02, 1.5), cabinetShelf, 0, 0.18 + i * 0.14, 0);
  return g;
}

/** The indoor ACU's cold-air glow volume. A factory, not a shared module-scope material
 * (as it was before Phase N), because `officeScene.ts`'s `applyState` now drives its
 * opacity from the real `acu_main` reading — mutating a module-scope singleton would
 * couple every future ACU instance to one device's state. Starts at `opacity: 0`
 * (was a static 0.16): the glow must be off until a fresh "on" reading arrives, same
 * "unknown ≠ on" rule the rest of the scene follows. */
export const acuGlowMaterial = () => new THREE.MeshBasicMaterial({ color: P.acuGlow, transparent: true, opacity: 0 });

/**
 * The room's own east wall being ACU-adjacent is a real detail — `shared/registry.mjs`
 * describes `mtr_lo_yellow` as "Outdoor ACU (separate unit, right side outside the room)".
 * `outdoor` builds a slightly larger, undetailed variant for that unit rather than a
 * second factory — same body, no interior display, sat on its own pad by the caller.
 */
function makeACU(outdoor = false): THREE.Group {
  const g = new THREE.Group();
  mk(g, new THREE.BoxGeometry(0.24, 0.34, 1.2), acuBody, 0, 0, 0);
  mk(g, new THREE.BoxGeometry(0.06, 0.05, 1.04), acuLouver, -0.12, -0.15, 0);
  if (!outdoor) {
    mk(g, new THREE.BoxGeometry(0.04, 0.1, 0.24), acuDisplay, -0.13, 0.08, 0.38);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 1.0), acuGlowMaterial());
    glow.name = 'acuGlow'; // officeScene.ts's buildFurniture() finds this to capture the material
    glow.position.set(-0.42, -0.3, 0);
    g.add(glow);
  }
  return g;
}

function makeWaterDispenser(): THREE.Group {
  const g = new THREE.Group();
  mk(g, new THREE.BoxGeometry(0.34, 1.0, 0.34), dispenserBody, 0, 0.5, 0);
  mk(g, new THREE.BoxGeometry(0.36, 0.03, 0.36), dispenserTray, 0, 1.0, 0);
  mk(g, new THREE.CylinderGeometry(0.05, 0.05, 0.08, 12), new THREE.MeshStandardMaterial({ color: 0xbfe6f5, transparent: true, opacity: 0.7 }), 0, 1.03, 0);
  const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.42, 18), dispenserBottle);
  bottle.position.y = 1.26;
  bottle.castShadow = true;
  g.add(bottle);
  mk(g, new THREE.BoxGeometry(0.06, 0.05, 0.05), dispenserHotTap, -0.07, 0.62, 0.18);
  mk(g, new THREE.BoxGeometry(0.06, 0.05, 0.05), dispenserColdTap, 0.07, 0.62, 0.18);
  mk(g, new THREE.BoxGeometry(0.26, 0.03, 0.12), new THREE.MeshStandardMaterial({ color: 0x8a98ad, metalness: 0.3, roughness: 0.4 }), 0, 0.5, 0.2);
  return g;
}

/** A shelving rack with procedurally scattered potted plants — width parametrized (`w`) since TEST2's 5.4m original doesn't fit CARE's narrower room. */
function makePlantRack(w: number): THREE.Group {
  const g = new THREE.Group();
  const d = 0.6;
  const frameMat = metal;
  const chanMat = new THREE.MeshStandardMaterial({ color: 0xd3dce6, roughness: 0.4 });
  [-w / 2, -w / 6, w / 6, w / 2].forEach((px) => {
    [-d / 2, d / 2].forEach((pz) => mk(g, new THREE.BoxGeometry(0.05, 1.12, 0.05), frameMat, px, 0.56, pz));
  });
  [0.32, 0.66, 1.0].forEach((ty) => {
    mk(g, new THREE.BoxGeometry(w, 0.03, d), frameMat, 0, ty, 0);
    [-0.19, 0, 0.19].forEach((cz) => {
      mk(g, new THREE.BoxGeometry(w - 0.18, 0.07, 0.13), chanMat, 0, ty + 0.055, cz);
      for (let x = -w / 2 + 0.28; x < w / 2 - 0.2; x += 0.26) {
        mk(g, new THREE.BoxGeometry(0.03, 0.05, 0.03), plantStem, x, ty + 0.1, cz);
        mk(g, new THREE.SphereGeometry(0.055, 8, 7), Math.random() < 0.5 ? plantLeafA : plantLeafB, x, ty + 0.15, cz);
      }
    });
  });
  return g;
}

function makeOutdoorPad(): THREE.Group {
  const g = new THREE.Group();
  mk(g, new THREE.BoxGeometry(1.3, 0.06, 1.1), padConcrete, 0, -0.03, 0);
  const acu = makeACU(true);
  acu.position.y = 0.4;
  g.add(acu);
  return g;
}

const FACTORIES: Record<FurnitureKind, (spec: FurnitureSpec) => THREE.Group> = {
  workstation: makeWorkstation,
  'table-oval': makeTableOval,
  'table-rect': (spec) => makeTableRect(spec.w ?? 1.5, spec.d ?? 0.8, spec.n ?? 6),
  workbench: makeWorkbench,
  cabinet: makeCabinet,
  'water-dispenser': makeWaterDispenser,
  'plant-rack': (spec) => makePlantRack(spec.w ?? 2.0),
  acu: () => makeACU(false),
  'acu-outdoor': makeOutdoorPad,
};

/** Builds and positions one furniture piece from a `FURNITURE` table entry. `spec.y`
 * defaults to 0 (floor-standing) — only the wall-mounted indoor ACU sets it. */
export function buildFurniturePiece(spec: FurnitureSpec): THREE.Group {
  const group = FACTORIES[spec.kind](spec);
  group.rotation.y = spec.ry;
  group.position.set(spec.x, spec.y ?? 0, spec.z);
  group.userData = { kind: 'furniture', furnitureKind: spec.kind };
  return group;
}

/**
 * Floor texture drawn on a canvas — a flat base with a grid of expansion-joint lines
 * (Phase M re-light, matching v4's care-office-3d.js floor exactly), replacing Phase L's
 * two-tone checker. A real photographic texture is an image asset neither side can
 * generate; procedural canvas is the same technique either way. Tiled at roughly 1 repeat
 * per meter so the grid reads as floor-tile scale, not a stretched single image.
 */
export function makeFloorTexture(width: number, depth: number): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = `#${P.floorBase.toString(16).padStart(6, '0')}`;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = `#${P.floorGrid.toString(16).padStart(6, '0')}`;
  ctx.lineWidth = 3;
  for (let i = 0; i <= size; i += 128) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, size);
    ctx.moveTo(0, i);
    ctx.lineTo(size, i);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(width / 1.1, depth / 1.1);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const wallMaterial = () => new THREE.MeshStandardMaterial({ color: P.wall, roughness: 0.96, transparent: true, opacity: 0.96 });
export const baseboardMaterial = () => new THREE.MeshStandardMaterial({ color: P.baseboard, roughness: 0.8 });

/** Door/window frame — brushed-metal-ish trim around glass. */
export const glassFrameMaterial = () => new THREE.MeshStandardMaterial({ color: P.glassFrame, roughness: 0.45, metalness: 0.25 });
/** The sliding entrance door's glass leaves — a faint blue emissive so it reads as glass, not a void, from any lighting angle. */
export const doorGlassMaterial = () =>
  new THREE.MeshStandardMaterial({ color: P.glassPane, transparent: true, opacity: 0.36, roughness: 0.05, metalness: 0.25, emissive: 0x29506a, emissiveIntensity: 0.18 });
/** Window glass — same technique, its own slightly cooler tint. */
export const windowGlassMaterial = () =>
  new THREE.MeshStandardMaterial({ color: P.windowGlass, transparent: true, opacity: 0.4, roughness: 0.08, metalness: 0.25, emissive: 0x3a6e8c, emissiveIntensity: 0.22 });
export const windowFrameMaterial = () => new THREE.MeshStandardMaterial({ color: P.windowFrame, roughness: 0.6 });

/**
 * Full-height office-partition glazing (Phase N). Deliberately much clearer (opacity 0.18)
 * than the window/door glass above: the partition is now full height, so this pane is the
 * ONLY way the compartment behind it — the workbench, the cabinets, and circuit l7's own
 * luminaires — stays visible from the main room. Murky or heavily gridded glass here would
 * make the whole point of re-centring row 7 (see geometry.ts's `LIGHT_PLAN`) unobservable.
 */
export const partitionGlassMaterial = () =>
  new THREE.MeshStandardMaterial({
    color: P.partitionGlass,
    transparent: true,
    opacity: 0.18,
    roughness: 0.04,
    metalness: 0.2,
    emissive: 0x24485e,
    emissiveIntensity: 0.1,
    depthWrite: false,
  });

/**
 * Radial white->transparent alpha ramp for the floor light pools under a lit luminaire
 * (Phase N — `officeScene.ts`'s per-circuit `poolMat`). Canvas-drawn for the same reason
 * `makeFloorTexture` is: a soft-edged glow is an image asset, and procedural canvas is the
 * technique already in use here. The soft edge matters beyond looks — a pool that overhangs
 * a nearby wall fades out before it gets there instead of showing a hard-clipped disc
 * through the wall's own 0.96-opacity glass.
 */
export function makePoolTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
