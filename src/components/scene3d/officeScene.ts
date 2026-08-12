/**
 * Imperative Three.js scene controller for the CARE office 3D view.
 *
 * Render-on-demand, not a continuous `requestAnimationFrame` loop — a deliberate choice,
 * not just a workaround. Two independent reasons converge on it:
 *   1. This scene is static geometry with occasional material changes (a 2s reading tick,
 *      an orbit drag) — there's nothing to animate between those events, so a 60fps loop
 *      running 24/7 on a kiosk Pi would burn cycles for zero visual benefit.
 *   2. This project's headless browser pane never runs the rendering lifecycle at all —
 *      `requestAnimationFrame`, `scroll`, `IntersectionObserver`, and `ResizeObserver` each
 *      fire exactly zero times here (confirmed in Phase G), even observing `document.body`
 *      with no margin. A loop-based scene would be unverifiable in this environment;
 *      render-on-demand calls `render()` synchronously and is fully testable here.
 *
 * State binding is id-keyed throughout: `circuitRigs`/`outletMeshesById` are Maps keyed by
 * device id, and `applyState()` looks up each mesh group by the id in the reading — never
 * by iterating meshes in build order. That's what makes it safe for `/api/devices`'s order
 * to change without a light silently taking on the wrong circuit's state.
 *
 * Stage L2 rewrite — lit, not unlit. Phase H shipped an unlit scene (every material
 * `color:#000` + `emissive`, no light rig, `LineBasicMaterial` wireframe shell) because it
 * needed zero light rig to read correctly; that's also why it looked like 24 boxes rather
 * than a room. This version adds a real three-point rig (hemisphere + warm key + cool
 * fill, ported from TEST2.html — see the Phase L research report), PCF soft shadows, ACES
 * tone mapping, a solid textured floor/walls/partition, and the furniture library from
 * `furniture.ts`. `materials.ts`'s pure state functions are UNCHANGED — they still return
 * `{color, emissiveIntensity, opacity}` for a device's emissive channel; what changed is
 * which mesh receives it (a dedicated LED/panel sub-mesh now, not the fixture's whole
 * body — see `buildLightFixtures`/`buildOutletFixtures`) and that the fixture bodies
 * themselves now carry real lit materials instead of being invisible without emissive.
 */

import * as THREE from 'three';
import { LIGHT_FIXTURES, LIGHT_ROWS, OUTLET_FIXTURES, FURNITURE, ROOM, type WallId } from './geometry';
import { lightMaterialState, outletSocketMaterialState, isOn, type MaterialState } from './materials';
import {
  buildFurniturePiece,
  makeFloorTexture,
  makePoolTexture,
  wallMaterial,
  baseboardMaterial,
  glassFrameMaterial,
  doorGlassMaterial,
  windowGlassMaterial,
  windowFrameMaterial,
  partitionGlassMaterial,
} from './furniture';
import { SCENE_PALETTE } from './tokens';
import type { Reading } from '@/lib/types';

export type PickResult = { kind: 'light'; circuit: string } | { kind: 'outlet'; id: string; socket: 1 | 2 } | null;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Candela, not the pre-r155 unitless scale — see `buildLightFixtures`'s comment. Tuned
 * against the existing hemisphere(0.62)/key(0.95) rig, not derived from first principles. */
const LAMP_ON = 10;
const POOL_ON = 0.55;
const ACU_GLOW_ON = 0.22;

function applyMaterialState(mesh: THREE.Mesh, state: MaterialState) {
  const mat = mesh.material as THREE.MeshStandardMaterial;
  mat.emissive.set(state.color);
  mat.emissiveIntensity = state.emissiveIntensity;
  mat.opacity = state.opacity;
}

/** A light ceiling-panel base color (not black) so an "off" panel reads as an unlit white
 * tile under the new light rig, rather than a black square — materials.ts only ever
 * touches `emissive`, deliberately (see this file's header), so the believable "off" look
 * has to come from the base material each fixture is built with. */
function lightPanelMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0xf5f0e0, roughness: 0.5, emissive: 0x000000, emissiveIntensity: 0, transparent: true });
}

/** A dark-plastic socket body — realistic for the indicator itself; the faceplate around it
 * (a separate, larger, static mesh) is what makes the outlet plausible as a fixture and
 * gives pointer/raycast a target bigger than the socket block alone. Renamed from the old
 * `ledMaterial()` (Phase N: the indicator grew from a 12mm LED disc to a 0.16m emissive
 * block, v4's own outlet size) — "socket", not "LED", is what it now reads as. */
function socketMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: SCENE_PALETTE.outletSocketBase, roughness: 0.4, emissive: 0x000000, emissiveIntensity: 0, transparent: true });
}

/**
 * A wall the shell can set an opening into. `axis` is the axis the wall RUNS ALONG; `at` is
 * its fixed coordinate on the other axis; `inward` is +1/-1 on that other axis, pointing
 * into the room the opening should face. `inward` is explicit rather than derived from
 * `sign(at)` because the partition is interior — both of its faces are "inside", and only
 * the caller knows which room a given opening actually serves.
 */
interface WallPlane {
  axis: 'x' | 'z';
  at: number;
  inward: 1 | -1;
}

const WALLS = {
  north: { axis: 'x', at: ROOM.minZ, inward: 1 },
  south: { axis: 'x', at: ROOM.maxZ, inward: -1 },
  west: { axis: 'z', at: ROOM.minX, inward: 1 },
  east: { axis: 'z', at: ROOM.maxX, inward: -1 },
  /** Faces the main room (south of the partition) — the side the door/windows serve. */
  partition: { axis: 'x', at: ROOM.partitionZ, inward: 1 },
} as const satisfies Record<string, WallPlane>;

/** Half-thickness of the surface an outlet is mounted on — outer walls are 0.12m boxes
 * centred on their coordinate (half 0.06), the partition's knee wall is a thinner 0.06m
 * box (half 0.03). Without this, an outlet built at a flat `normal * 0.02` offset sits
 * INSIDE the wall solid rather than proud of its face — half of why outlets read as
 * invisible before Phase N, not just a size problem. */
const OUTLET_WALL_HALF: Record<WallId, number> = { left: 0.06, right: 0.06, top: 0.06, bottom: 0.06, partition: 0.03 };

export class OfficeScene {
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();

  /**
   * Everything one lighting circuit owns. Replaces the pre-Phase-N `Map<string, Mesh[]>` of
   * panels alone: "circuit on" now also has to reach a floor light-pool and a room-filling
   * point light, and three parallel Maps keyed by the same circuit id is exactly the drift
   * the id-keyed design (see this file's header) exists to prevent.
   */
  private circuitRigs = new Map<string, { panels: THREE.Mesh[]; poolMat: THREE.MeshBasicMaterial; lamp: THREE.PointLight }>();
  private outletMeshesById = new Map<string, { s1: THREE.Mesh; s2: THREE.Mesh }>();
  private pickables: THREE.Object3D[] = [];
  /** Captured from the FURNITURE-built ACU group (see `buildFurniture`) — `applyState`
   * drives its opacity from the real `acu_main` reading. `null` until `buildFurniture` runs. */
  private acuGlowMat: THREE.MeshBasicMaterial | null = null;
  private poolTex: THREE.CanvasTexture | null = null;

  /** Fixtures currently "on" and their steady (non-pulsing) emissive intensity — populated
   * by `applyState()`, read by the auto-rotate loop's pulse. Kept as a live set rather
   * than re-deriving from `readings` each animation frame, since the loop must stay cheap
   * enough to run at 60fps without re-walking every device. */
  private onMeshes = new Set<THREE.Mesh>();
  private baseIntensity = new Map<THREE.Mesh, number>();
  private autoRotateId: number | null = null;

  private theta = Math.PI / 4;
  private phi = Math.PI / 3.2;
  private readonly target = new THREE.Vector3(0, ROOM.ceilingHeight * 0.35, 0);

  /** Room's own half-diagonal — the basis for the zoom clamp and the fit-to-bounds distance. */
  private readonly boundingRadius = Math.sqrt(ROOM.width ** 2 + ROOM.depth ** 2 + ROOM.ceilingHeight ** 2) / 2;
  private radius: number;
  private readonly minRadius: number;
  private readonly maxRadius: number;
  /** Set once the first real container size arrives — see `resize()`'s header comment. */
  private fitted = false;

  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06; // Phase M re-light: v4's care-office-3d.js exposure

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    this.radius = Math.max(ROOM.width, ROOM.depth) * 1.6; // sane default before the first resize() fits it properly
    this.minRadius = this.boundingRadius * 1.3;
    this.maxRadius = this.boundingRadius * 6;

    this.scene.fog = new THREE.Fog(0x121210, this.boundingRadius * 3, this.boundingRadius * 8);

    this.buildLights();
    this.buildShell();
    this.buildFurniture();
    this.buildLightFixtures();
    this.buildOutletFixtures();
    this.updateCameraPosition();
  }

  // -------------------------------------------------------------------------
  // Build
  // -------------------------------------------------------------------------

  /**
   * Three-point rig, re-lit for Phase M against v4's care-office-3d.js values (a softer key
   * and fill than Phase L's TEST2-ported rig, appropriate now that the scene sits inside a
   * light page instead of a dark one): a sky/ground hemisphere for ambient fill, a warm key
   * light (the sun through a window, effectively) casting the shadow map, and a cool fill
   * from the opposite side so shadowed faces don't go pure black. Shadow camera frustum is
   * sized off `boundingRadius`, not a fixed constant — CARE's room isn't TEST2's or v4's
   * reference room, and a fixed frustum would either clip the room or waste shadow map
   * resolution on empty space.
   */
  private buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xdbe8ff, 0x232a35, 0.62));

    const key = new THREE.DirectionalLight(0xfff4e0, 0.95);
    key.position.set(this.boundingRadius * 0.9, this.boundingRadius * 1.8, this.boundingRadius * 0.7);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = this.boundingRadius * 6;
    key.shadow.camera.left = -this.boundingRadius;
    key.shadow.camera.right = this.boundingRadius;
    key.shadow.camera.top = this.boundingRadius;
    key.shadow.camera.bottom = -this.boundingRadius;
    key.shadow.bias = -0.0004;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x9ab8ff, 0.26);
    fill.position.set(-this.boundingRadius * 0.8, this.boundingRadius * 1.2, -this.boundingRadius * 0.6);
    this.scene.add(fill);
  }

  /**
   * Solid textured floor, solid walls with baseboards, a pair of windows on the short wall
   * farthest from the entrance, and a glazed partition carrying the room's real entrance
   * (see `addGlazedPartition`). The window/door glasswork is ported from v4's
   * care-office-3d.js shell, sized to CARE's actual room (6.0m x 10.6m) rather than that
   * file's 9.0m x 6.6m reference room — same caveat as `geometry.ts`'s `FURNITURE` table:
   * plausible placement, not a surveyed position, since nothing in the live flow records
   * where CARE's actual openings are.
   */
  private buildShell() {
    const floorTex = makeFloorTexture(ROOM.width, ROOM.depth);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(ROOM.width, 0.08, ROOM.depth), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.7, metalness: 0.1 }));
    floor.position.set(0, -0.04, 0);
    floor.receiveShadow = true;
    this.scene.add(floor);

    const wallMat = wallMaterial();
    const baseMat = baseboardMaterial();
    const T = 0.12;
    const H = ROOM.ceilingHeight;

    const addWall = (w: number, d: number, x: number, z: number) => {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, H, d), wallMat);
      wall.position.set(x, H / 2, z);
      wall.receiveShadow = true;
      wall.castShadow = true;
      this.scene.add(wall);
      const base = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.12, d + 0.02), baseMat);
      base.position.set(x, 0.06, z);
      base.receiveShadow = true;
      this.scene.add(base);
    };

    // North short wall (the lobby's own exterior wall) is plain.
    addWall(ROOM.width + T, T, 0, ROOM.minZ);

    // South short wall (z = maxZ) is the room's real entrance's OPPOSITE wall — the short
    // wall farthest from the glazed partition/sliding door. Windows + the wall-mounted ACU
    // (placed via FURNITURE, not here) both live here per an explicit requirement: keep
    // them far from the entrance. along=+-1.7 flanks the ACU (1.2m wide, centred at x=0,
    // FURNITURE's `acu` row) with 0.3m clear on each side.
    addWall(ROOM.width + T, T, 0, ROOM.maxZ);
    this.addWindow(WALLS.south, -1.7, H);
    this.addWindow(WALLS.south, 1.7, H);

    addWall(T, ROOM.depth + T, ROOM.minX, 0);
    addWall(T, ROOM.depth + T, ROOM.maxX, 0);

    // The partition is the room's real entrance now — a full-height glazed office
    // partition with a 2-leaf sliding glass door filling its 1.6m centre gap. See
    // `addGlazedPartition`'s own docblock for why (co5/co6, and keeping l7 visible).
    this.addGlazedPartition(H, wallMat);
  }

  /**
   * A wall-local placement frame: an empty `Group` at `along` metres along `plane`, whose
   * local +X runs along the wall, +Y is up, and +Z points into the room `plane.inward`
   * names. Every opening below is authored in that local frame, so the same geometry code
   * serves a wall running along x (north/south/partition) and one running along z
   * (east/west) without a `sign(wallZ)`-style special case — which couldn't express the
   * partition anyway, since both of its faces are "inside".
   */
  private wallGroup(plane: WallPlane, along: number): THREE.Group {
    const g = new THREE.Group();
    if (plane.axis === 'x') {
      g.position.set(along, 0, plane.at);
      g.rotation.y = plane.inward > 0 ? 0 : Math.PI;
    } else {
      g.position.set(plane.at, 0, along);
      g.rotation.y = plane.inward > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    this.scene.add(g);
    return g;
  }

  /** A window: glass pane + surrounding frame, set into `plane` at `along` metres along it.
   * Frame depth 0.16 is deliberately deeper than the wall's own 0.12 thickness — at the
   * old flat 0.07 the entire frame sat inside the wall solid and was invisible from both
   * faces, a real defect fixed here, not a sizing choice. */
  private addWindow(plane: WallPlane, along: number, h: number, w = 1.6) {
    const g = this.wallGroup(plane, along);
    const y = h * 0.62;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, h * 0.3, 0.16), windowFrameMaterial());
    frame.position.set(0, y, 0);
    frame.castShadow = true;
    g.add(frame);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.26, 0.1), windowGlassMaterial());
    glass.position.set(0, y, 0);
    g.add(glass);
  }

  /** A 2-leaf sliding glass door centred on `plane` at `along`, filling an opening `w`
   * wide and running the full wall height. `w` is a parameter (was a hardcoded 2.0)
   * because the door now fills the glazed partition's own gap exactly — the jambs must
   * land on the panel edges, not float inside them. */
  private addSlidingDoor(plane: WallPlane, along: number, h: number, w: number) {
    const g = this.wallGroup(plane, along);
    const frameMat = glassFrameMaterial();

    const head = new THREE.Mesh(new THREE.BoxGeometry(w + 0.14, 0.1, 0.14), frameMat);
    head.position.set(0, h - 0.05, 0);
    g.add(head);
    for (const jx of [-w / 2, w / 2]) {
      const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.14, h, 0.14), frameMat);
      jamb.position.set(jx, h / 2, 0);
      jamb.castShadow = true;
      g.add(jamb);
    }

    const leafH = h - 0.16;
    const leafW = w * 0.48;
    for (const lx of [-w * 0.24, w * 0.24]) {
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(leafW, leafH, 0.04), doorGlassMaterial());
      leaf.position.set(lx, 0.06 + leafH / 2, 0.02);
      g.add(leaf);
    }
  }

  /**
   * The partition is now the room's real entrance: a full-height glazed office partition —
   * a solid knee wall to 0.9m, glass from there to the ceiling — in two panels flanking a
   * 1.6m centre gap that a 2-leaf sliding glass door fills. The knee-wall height is NOT
   * cosmetic: `co5` (x=-1.9) and `co6` (x=+1.5) are mounted ON this partition at y=0.35, so
   * the bottom 0.9m has to stay solid material for them to sit on — both x's verified
   * inside the panels ([-3.0,-0.8] and [0.8,3.0], `geometry.test.ts`'s door-gap-clearance
   * test) and clear of the door gap. No mid-mullions and glass at opacity 0.18 (see
   * `partitionGlassMaterial`'s own docblock) — the partition is full height now, so this
   * pane is the ONLY sightline left into the compartment circuit l7 alone lights.
   */
  private addGlazedPartition(h: number, wallMat: THREE.Material) {
    const GAP = 1.6;
    const BASE_H = 0.9;
    const T = 0.06;
    const segW = (ROOM.width - GAP) / 2; // 2.2
    const z = ROOM.partitionZ;
    const glassMat = partitionGlassMaterial();
    const frameMat = glassFrameMaterial();
    const glassH = h - BASE_H - 0.08;

    for (const cx of [-(GAP / 2 + segW / 2), GAP / 2 + segW / 2]) {
      // -1.9 / +1.9
      const knee = new THREE.Mesh(new THREE.BoxGeometry(segW, BASE_H, T), wallMat);
      knee.position.set(cx, BASE_H / 2, z);
      knee.receiveShadow = true;
      knee.castShadow = true;
      this.scene.add(knee);

      const glass = new THREE.Mesh(new THREE.BoxGeometry(segW - 0.06, glassH, 0.02), glassMat);
      glass.position.set(cx, BASE_H + 0.04 + glassH / 2, z);
      this.scene.add(glass);

      // Transom rail capping the knee wall + head rail at the ceiling.
      for (const ry of [BASE_H + 0.02, h - 0.03]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(segW, 0.06, 0.09), frameMat);
        rail.position.set(cx, ry, z);
        this.scene.add(rail);
      }
    }
    this.addSlidingDoor(WALLS.partition, 0, h, GAP);
  }

  /**
   * Placement here is plausible, not surveyed — see `geometry.ts`'s `FURNITURE` docblock
   * for what's real (the outlet-anchored positions, the ACU wall, the partition zoning)
   * versus filled in. Furniture is static and NOT id-keyed to a device reading — except the
   * indoor ACU's glow volume, whose material this loop captures by name so `applyState` can
   * drive its opacity from the real `acu_main` reading (see `furniture.ts`'s `makeACU`).
   */
  private buildFurniture() {
    for (const spec of FURNITURE) {
      const group = buildFurniturePiece(spec);
      if (spec.kind === 'acu') {
        const glow = group.getObjectByName('acuGlow') as THREE.Mesh | undefined;
        if (glow) this.acuGlowMat = glow.material as THREE.MeshBasicMaterial;
      }
      this.scene.add(group);
    }
  }

  /**
   * Builds the 21 ceiling fixtures, 7 floor light-pools (one shared material per circuit —
   * the 3 fixtures on one circuit are always in lockstep, so fading them is a single
   * property write, not 3), and 7 per-row point lights. This is what makes a lit circuit
   * actually light the room: before Phase N, `applyState` only ever changed a panel's own
   * emissive glow, so the scene rendered identically whether 0 or 21 circuits were on.
   */
  private buildLightFixtures() {
    const housingGeo = new THREE.BoxGeometry(0.32, 0.06, 0.32);
    const panelGeo = new THREE.BoxGeometry(0.26, 0.02, 0.26);
    const housingMat = new THREE.MeshStandardMaterial({ color: 0xd8dce2, roughness: 0.6 });
    const poolGeo = new THREE.PlaneGeometry(2.4, 2.4);
    this.poolTex = makePoolTexture();

    for (const row of LIGHT_ROWS) {
      const poolMat = new THREE.MeshBasicMaterial({
        map: this.poolTex,
        color: SCENE_PALETTE.lightPool,
        transparent: true,
        opacity: 0, // "unknown" starts dark — same rule every fixture follows
        depthWrite: false, // coplanar pools must not fight each other
        blending: THREE.AdditiveBlending, // a light pool adds light, it doesn't paint over the floor
        toneMapped: false,
      });
      const lamp = new THREE.PointLight(SCENE_PALETTE.lampWhite, 0, 9, 2);
      lamp.position.set(row.world.x, row.world.y, row.world.z);
      lamp.castShadow = false; // 7 shadow-casting point lights = 42 cube-face passes/frame — this kiosk scene can't afford it and doesn't need it
      this.scene.add(lamp);
      this.circuitRigs.set(row.circuit, { panels: [], poolMat, lamp });
    }

    for (const fixture of LIGHT_FIXTURES) {
      const group = new THREE.Group();
      const housing = new THREE.Mesh(housingGeo, housingMat);
      // A recessed ceiling luminaire emits light; it doesn't cast its own housing as a
      // shadow onto the floor below it. `castShadow = true` here was the cause of the
      // dark square offset from every fixture in a top-down render — a real bug, not a
      // stylistic choice. The room doesn't read flatter without it: the key light still
      // shadows walls/furniture/frames, and each circuit's own PointLight + additive
      // floor pool already carry the "this circuit is lit" read.
      housing.castShadow = false;
      group.add(housing);
      const panel = new THREE.Mesh(panelGeo, lightPanelMaterial());
      panel.position.y = -0.02;
      group.add(panel);
      group.position.set(fixture.world.x, fixture.world.y, fixture.world.z);
      group.userData = { kind: 'light', circuit: fixture.circuit };
      housing.userData = group.userData;
      panel.userData = group.userData;
      this.scene.add(group);
      this.pickables.push(housing, panel);

      const rig = this.circuitRigs.get(fixture.circuit)!;
      rig.panels.push(panel);

      const pool = new THREE.Mesh(poolGeo, rig.poolMat);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(fixture.world.x, 0.02, fixture.world.z); // floor top is y=0
      this.scene.add(pool);
      // NOT pushed to `pickables` — a 2.4m invisible plane over the floor would swallow
      // every click meant for the furniture under it.
    }
  }

  /**
   * Each socket is its own faceplate + emissive block, at the same tangent-offset anchor
   * Phase H's bare indicator boxes used — only the geometry, size, and wall standoff are
   * upgraded (Phase N), so the id-keyed Map and pick positions don't change shape.
   *
   * The standoff is the real fix, not just the size: the old flat `normal * 0.02` offset
   * built the whole assembly INSIDE the wall's 0.12m-thick box (only visible at all
   * because the wall material is 96% opaque). `OUTLET_WALL_HALF[wall] + DEPTH/2` instead
   * clears the actual surface each mount type sits on — 0.06 for an outer wall, 0.03 for
   * the partition's thinner knee wall (co5/co6).
   */
  private buildOutletFixtures() {
    const PLATE = 0.2;
    const BLOCK = 0.16;
    const DEPTH = 0.06;
    const OFFSET = 0.11; // socket spread — two 0.16-wide blocks at the old 0.06 would overlap
    const plateGeo = new THREE.BoxGeometry(PLATE, PLATE, 0.02);
    const blockGeo = new THREE.BoxGeometry(BLOCK, BLOCK, DEPTH);
    const plateMat = new THREE.MeshStandardMaterial({ color: SCENE_PALETTE.outletFaceplate, roughness: 0.4 });

    for (const fixture of OUTLET_FIXTURES) {
      const { tangent, normal, wall } = fixture.mount;
      const faceAngle = Math.atan2(normal.x, normal.z);
      const standoff = OUTLET_WALL_HALF[wall] + DEPTH / 2;

      const build = (socket: 1 | 2, sign: 1 | -1): THREE.Mesh => {
        const group = new THREE.Group();
        const plate = new THREE.Mesh(plateGeo, plateMat);
        plate.position.z = -0.02;
        plate.castShadow = true;
        group.add(plate);
        const block = new THREE.Mesh(blockGeo, socketMaterial());
        group.add(block);
        group.rotation.y = faceAngle;
        group.position.set(
          fixture.world.x + tangent.x * OFFSET * sign + normal.x * standoff,
          fixture.world.y,
          fixture.world.z + tangent.z * OFFSET * sign + normal.z * standoff,
        );
        const data = { kind: 'outlet' as const, id: fixture.id, socket };
        plate.userData = data;
        block.userData = data;
        this.scene.add(group);
        this.pickables.push(plate, block);
        return block; // s1/s2 are the emissive block, not the static plate
      };

      this.outletMeshesById.set(fixture.id, { s1: build(1, -1), s2: build(2, 1) });
    }
  }

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  /**
   * The one entry point live data flows through. Looks up each mesh group by device id in
   * `readings` — a circuit or outlet absent from `readings` (device not yet loaded, or a
   * key that doesn't exist) simply renders as "no reading" via the same
   * `lightMaterialState(undefined)` path a genuinely offline device takes.
   */
  applyState(readings: Record<string, Reading>) {
    for (const [circuit, rig] of this.circuitRigs) {
      const state = lightMaterialState(readings[circuit]);
      const on = isOn(state);
      for (const panel of rig.panels) {
        applyMaterialState(panel, state);
        this.trackOnState(panel, state);
      }
      // The room's actual response to the circuit. Driven by the same `state`, but
      // deliberately NOT registered with `trackOnState()`: that set feeds the auto-rotate
      // pulse, which writes `emissiveIntensity` — a property a MeshBasicMaterial pool
      // doesn't have and a PointLight isn't. Only the panels breathe; a pulsing room light
      // would read as a fault, not ambience.
      rig.poolMat.opacity = on ? POOL_ON : 0;
      // NB: never `lamp.visible = on` — changing a scene's light COUNT invalidates every
      // MeshStandardMaterial's shader program, so a 2s reading tick would recompile the
      // whole scene. Intensity 0 is free.
      rig.lamp.intensity = on ? LAMP_ON : 0;
    }
    for (const [id, sockets] of this.outletMeshesById) {
      const reading = readings[id];
      const s1 = outletSocketMaterialState(reading, 1);
      const s2 = outletSocketMaterialState(reading, 2);
      applyMaterialState(sockets.s1, s1);
      applyMaterialState(sockets.s2, s2);
      this.trackOnState(sockets.s1, s1);
      this.trackOnState(sockets.s2, s2);
    }
    // The ACU has no emissive channel of its own — its only state expression is the
    // cold-air glow volume. `lightMaterialState` is reused rather than a fourth on/stale/off
    // mapping: "fresh and commanded on" is exactly the same rule, applied to a different
    // device class.
    if (this.acuGlowMat) this.acuGlowMat.opacity = isOn(lightMaterialState(readings['acu_main'])) ? ACU_GLOW_ON : 0;
    this.render();
  }

  /** `isOn(state)` is materials.ts's own "on" signal for a lit circuit or a live socket —
   * reused here rather than re-deriving "on-ness" from the reading a second time. Feeds the
   * auto-rotate loop's device-pin pulse. */
  private trackOnState(mesh: THREE.Mesh, state: MaterialState) {
    if (isOn(state)) {
      this.onMeshes.add(mesh);
      this.baseIntensity.set(mesh, state.emissiveIntensity);
    } else {
      this.onMeshes.delete(mesh);
      this.baseIntensity.delete(mesh);
    }
  }

  // -------------------------------------------------------------------------
  // Camera
  // -------------------------------------------------------------------------

  private updateCameraPosition() {
    const x = this.target.x + this.radius * Math.sin(this.phi) * Math.sin(this.theta);
    const y = this.target.y + this.radius * Math.cos(this.phi);
    const z = this.target.z + this.radius * Math.sin(this.phi) * Math.cos(this.theta);
    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.target);
  }

  /** Manual spherical orbit — ported from `Bems.html`'s theta/phi scheme rather than adding OrbitControls as a dependency. */
  orbit(dTheta: number, dPhi: number) {
    this.theta += dTheta;
    // Never let the camera go under the floor; do allow a near-top-down view (TEST2's own
    // floor is 0.06, not the old 0.15 — the room reads fine from nearly overhead, and the
    // fit-to-bounds distance keeps it framed either way).
    this.phi = clamp(this.phi + dPhi, 0.06, Math.PI / 2 - 0.02);
    this.updateCameraPosition();
    this.render();
  }

  /** Perspective "zoom" is camera distance (dolly), not frustum scale — the opposite of the old orthographic camera's `camera.zoom`. */
  zoom(factor: number) {
    this.radius = clamp(this.radius / factor, this.minRadius, this.maxRadius);
    this.updateCameraPosition();
    this.render();
  }

  get isAutoRotating(): boolean {
    return this.autoRotateId !== null;
  }

  /**
   * The one place this scene runs a continuous `requestAnimationFrame` loop — opt-in,
   * user-toggled, and stopped the instant it's turned off. This doesn't contradict
   * render-on-demand's rationale (see this file's header): the point was never "never
   * animate," it was "don't burn a 24/7 kiosk's cycles on a static scene by default." A
   * user who explicitly asks for motion is a different case, and the loop costs nothing
   * once they turn it back off.
   *
   * While running, it also pulses every currently-"on" fixture's emissive intensity — a
   * cheap side effect of a loop that's already re-rendering every frame regardless, not a
   * second animation system. `onMeshes`/`baseIntensity` are kept current by `applyState()`.
   * Each mesh's own `.id` seeds a phase offset so fixtures don't all breathe in lockstep.
   *
   * NOT exercised by this project's verification pane, which never fires
   * `requestAnimationFrame` (see the header comment) — `setAutoRotate(true)` schedules a
   * frame that this pane simply never calls back. Correct behavior in a real browser;
   * verify the on/off *state* here (`isAutoRotating`), not visible motion.
   */
  setAutoRotate(enabled: boolean) {
    if (enabled === this.isAutoRotating) return;

    if (!enabled) {
      if (this.autoRotateId !== null) cancelAnimationFrame(this.autoRotateId);
      this.autoRotateId = null;
      // Settle every pulsing fixture back to its steady intensity rather than leaving it
      // wherever the sine wave happened to land when the loop stopped.
      for (const [mesh, base] of this.baseIntensity) (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = base;
      this.render();
      return;
    }

    const start = performance.now();
    const loop = (now: number) => {
      if (this.disposed) return;
      this.theta += 0.0015;
      this.updateCameraPosition();
      const t = now - start;
      for (const mesh of this.onMeshes) {
        const base = this.baseIntensity.get(mesh) ?? 1;
        const phase = (mesh.id % 7) * 0.9;
        (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = base * (0.85 + 0.15 * Math.sin(t / 600 + phase));
      }
      this.render();
      this.autoRotateId = requestAnimationFrame(loop);
    };
    this.autoRotateId = requestAnimationFrame(loop);
  }

  /**
   * Distance at which the room's bounding sphere fits inside the current field of view on
   * both axes, with a little padding so it isn't touching the frustum edges. This is the
   * fix for the Phase H defect where the model rendered tiny inside a wide, empty
   * container: that camera held a fixed *vertical* extent and let the *horizontal* extent
   * scale with aspect, so a wide container made the room shrink instead of the frame
   * adapting to it. Recomputing distance from both the vertical and horizontal FOV (the
   * horizontal one derived from aspect) and taking the larger requirement fits the room on
   * whichever axis is actually tighter, at any container shape.
   */
  private fitDistance(aspect: number): number {
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const padding = 1.2;
    const dv = this.boundingRadius / Math.sin(vFov / 2);
    const dh = this.boundingRadius / Math.sin(hFov / 2);
    return Math.max(dv, dh) * padding;
  }

  /**
   * Runs the fit-to-bounds pass exactly once, on the first call — subsequent resizes (the
   * sidebar collapsing, a window resize) only update the projection matrix and renderer
   * size, not the user's current zoom/orbit. Fitting on every resize would fight a user
   * who'd already zoomed in.
   */
  resize(width: number, height: number) {
    if (width <= 0 || height <= 0) return;
    const aspect = width / height;
    this.camera.aspect = aspect;
    if (!this.fitted) {
      this.radius = clamp(this.fitDistance(aspect), this.minRadius, this.maxRadius);
      this.fitted = true;
      this.updateCameraPosition();
    }
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // kiosk runs 24/7 — cap DPR
    this.renderer.setSize(width, height, false);
    this.render();
  }

  // -------------------------------------------------------------------------
  // Interaction (view-only — this identifies a device, it never toggles one)
  // -------------------------------------------------------------------------

  pick(canvasX: number, canvasY: number, canvasWidth: number, canvasHeight: number): PickResult {
    this.pointer.set((canvasX / canvasWidth) * 2 - 1, -(canvasY / canvasHeight) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.pickables, false)[0];
    if (!hit) return null;
    const data = hit.object.userData;
    return data.kind === 'light' ? { kind: 'light', circuit: data.circuit } : { kind: 'outlet', id: data.id, socket: data.socket };
  }

  render() {
    if (this.disposed) return;
    this.renderer.render(this.scene, this.camera);
  }

  // -------------------------------------------------------------------------
  // Introspection — for verification/debugging, not used by the render path itself.
  // -------------------------------------------------------------------------

  get debugInfo() {
    return {
      lightCircuits: [...this.circuitRigs.keys()],
      lightMeshCount: [...this.circuitRigs.values()].reduce((n, rig) => n + rig.panels.length, 0),
      outletIds: [...this.outletMeshesById.keys()],
      outletMeshCount: this.outletMeshesById.size * 2,
      radius: this.radius,
      fitted: this.fitted,
      autoRotating: this.isAutoRotating,
      onCount: this.onMeshes.size,
      /** One per circuit (7), not one per fixture (21) — see `buildLightFixtures`. */
      pointLightCount: this.circuitRigs.size,
      /** How many circuits are actually lighting the room right now — the only way to
       * assert §1.3's "lit circuits change the room" from a headless browser pane without
       * pixels (see this file's header on why there's no requestAnimationFrame here). */
      lampsOn: [...this.circuitRigs.values()].filter((rig) => rig.lamp.intensity > 0).length,
    };
  }

  /** Reads back a light circuit's current emissive color as a hex string. */
  lightColorHex(circuit: string): string | null {
    const mesh = this.circuitRigs.get(circuit)?.panels[0];
    if (!mesh) return null;
    return '#' + (mesh.material as THREE.MeshStandardMaterial).emissive.getHexString();
  }

  /** Reads back one outlet socket's current emissive color as a hex string. */
  outletSocketColorHex(id: string, socket: 1 | 2): string | null {
    const sockets = this.outletMeshesById.get(id);
    if (!sockets) return null;
    const mesh = socket === 1 ? sockets.s1 : sockets.s2;
    return '#' + (mesh.material as THREE.MeshStandardMaterial).emissive.getHexString();
  }

  dispose() {
    this.disposed = true;
    if (this.autoRotateId !== null) cancelAnimationFrame(this.autoRotateId);
    this.autoRotateId = null;
    this.poolTex?.dispose(); // Material.dispose() does not dispose its own .map
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh | THREE.LineSegments;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    this.renderer.dispose();
  }
}
