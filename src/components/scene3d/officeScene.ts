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
 * State binding is id-keyed throughout: `lightMeshesByCircuit`/`outletMeshesById` are Maps
 * keyed by device id, and `applyState()` looks up each mesh group by the id in the reading
 * — never by iterating meshes in build order. That's what makes it safe for
 * `/api/devices`'s order to change without a light silently taking on the wrong circuit's
 * state.
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
import { LIGHT_FIXTURES, OUTLET_FIXTURES, FURNITURE, ROOM } from './geometry';
import { lightMaterialState, outletSocketMaterialState, type MaterialState } from './materials';
import { buildFurniturePiece, makeFloorTexture, wallMaterial, baseboardMaterial } from './furniture';
import type { Reading } from '@/lib/types';

export type PickResult = { kind: 'light'; circuit: string } | { kind: 'outlet'; id: string; socket: 1 | 2 } | null;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

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

/** A small dark LED body — realistic for the indicator itself; the faceplate around it (a
 * separate, larger, static mesh) is what makes the outlet plausible as a fixture and gives
 * pointer/raycast a target bigger than a 12mm cylinder. */
function ledMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x1b2129, roughness: 0.4, emissive: 0x000000, emissiveIntensity: 0, transparent: true });
}

export class OfficeScene {
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();

  private lightMeshesByCircuit = new Map<string, THREE.Mesh[]>();
  private outletMeshesById = new Map<string, { s1: THREE.Mesh; s2: THREE.Mesh }>();
  private pickables: THREE.Object3D[] = [];

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
    this.renderer.toneMappingExposure = 1.1;

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
   * Three-point rig ported from TEST2.html: a sky/ground hemisphere for ambient fill, a
   * warm key light (the sun through a window, effectively) casting the shadow map, and a
   * cool fill from the opposite side so shadowed faces don't go pure black. Shadow camera
   * frustum is sized off `boundingRadius`, not TEST2's fixed ±9 — CARE's room isn't the
   * same size as TEST2's, and a fixed frustum would either clip the room or waste shadow
   * map resolution on empty space.
   */
  private buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xe1edff, 0x111622, 0.6));

    const key = new THREE.DirectionalLight(0xfff4e0, 1.4);
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

    const fill = new THREE.DirectionalLight(0x9ab8ff, 0.4);
    fill.position.set(-this.boundingRadius * 0.8, this.boundingRadius * 1.2, -this.boundingRadius * 0.6);
    this.scene.add(fill);
  }

  /** Solid textured floor, solid walls with baseboards, and the half-height partition — replaces Phase H's wireframe-only shell now that the scene is lit and can shade solid faces. */
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

    addWall(ROOM.width + T, T, 0, ROOM.minZ);
    addWall(ROOM.width + T, T, 0, ROOM.maxZ);
    addWall(T, ROOM.depth + T, ROOM.minX, 0);
    addWall(T, ROOM.depth + T, ROOM.maxX, 0);

    // Half-height partition — the real detail that explains the room's two compartments
    // (and why circuit l7 lights a smaller, separate area from l1..l6).
    const partitionH = H * 0.5;
    const partition = new THREE.Mesh(new THREE.BoxGeometry(ROOM.width, partitionH, 0.06), wallMat);
    partition.position.set(0, partitionH / 2, ROOM.partitionZ);
    partition.receiveShadow = true;
    partition.castShadow = true;
    this.scene.add(partition);
  }

  /**
   * Placement here is plausible, not surveyed — see `geometry.ts`'s `FURNITURE` docblock
   * for what's real (the outlet-anchored positions, the ACU wall, the partition zoning)
   * versus filled in. Furniture is static: nothing here is id-keyed to a device reading.
   */
  private buildFurniture() {
    for (const spec of FURNITURE) this.scene.add(buildFurniturePiece(spec));
  }

  private buildLightFixtures() {
    const housingGeo = new THREE.BoxGeometry(0.32, 0.06, 0.32);
    const panelGeo = new THREE.BoxGeometry(0.26, 0.02, 0.26);
    const housingMat = new THREE.MeshStandardMaterial({ color: 0xd8dce2, roughness: 0.6 });

    for (const fixture of LIGHT_FIXTURES) {
      const group = new THREE.Group();
      const housing = new THREE.Mesh(housingGeo, housingMat);
      housing.castShadow = true;
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

      const list = this.lightMeshesByCircuit.get(fixture.circuit) ?? [];
      list.push(panel);
      this.lightMeshesByCircuit.set(fixture.circuit, list);
    }
  }

  /**
   * Each socket is its own small faceplate + LED, positioned exactly where Phase H's bare
   * indicator boxes were (unchanged tangent-offset math) — only the geometry each position
   * holds is upgraded, so the id-keyed Map and pick positions don't change shape.
   */
  private buildOutletFixtures() {
    const faceplateGeo = new THREE.BoxGeometry(0.1, 0.14, 0.02);
    const faceplateMat = new THREE.MeshStandardMaterial({ color: 0xdee3eb, roughness: 0.4 });
    const ledGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.012, 10);
    const OFFSET = 0.06;

    for (const fixture of OUTLET_FIXTURES) {
      const { tangent, normal } = fixture.mount;
      const faceAngle = Math.atan2(normal.x, normal.z);

      const build = (socket: 1 | 2, sign: 1 | -1): THREE.Mesh => {
        const group = new THREE.Group();
        const faceplate = new THREE.Mesh(faceplateGeo, faceplateMat);
        faceplate.castShadow = true;
        group.add(faceplate);
        const led = new THREE.Mesh(ledGeo, ledMaterial());
        led.rotation.x = Math.PI / 2;
        led.position.z = 0.014;
        group.add(led);
        group.rotation.y = faceAngle;
        group.position.set(
          fixture.world.x + tangent.x * OFFSET * sign + normal.x * 0.02,
          fixture.world.y,
          fixture.world.z + tangent.z * OFFSET * sign + normal.z * 0.02,
        );
        const data = { kind: 'outlet' as const, id: fixture.id, socket };
        faceplate.userData = data;
        led.userData = data;
        this.scene.add(group);
        this.pickables.push(faceplate, led);
        return led;
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
    for (const [circuit, meshes] of this.lightMeshesByCircuit) {
      const state = lightMaterialState(readings[circuit]);
      for (const mesh of meshes) applyMaterialState(mesh, state);
    }
    for (const [id, sockets] of this.outletMeshesById) {
      const reading = readings[id];
      applyMaterialState(sockets.s1, outletSocketMaterialState(reading, 1));
      applyMaterialState(sockets.s2, outletSocketMaterialState(reading, 2));
    }
    this.render();
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
      lightCircuits: [...this.lightMeshesByCircuit.keys()],
      lightMeshCount: [...this.lightMeshesByCircuit.values()].reduce((n, arr) => n + arr.length, 0),
      outletIds: [...this.outletMeshesById.keys()],
      outletMeshCount: this.outletMeshesById.size * 2,
      radius: this.radius,
      fitted: this.fitted,
    };
  }

  /** Reads back a light circuit's current emissive color as a hex string. */
  lightColorHex(circuit: string): string | null {
    const mesh = this.lightMeshesByCircuit.get(circuit)?.[0];
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
