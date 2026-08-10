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
 * `/api/devices`'s order to change (as the Phase 4.5 onboarding wizard will eventually
 * cause) without a light silently taking on the wrong circuit's state.
 *
 * Unlit by design: every material is `MeshStandardMaterial` with `color:#000` and all
 * brightness carried by `emissive`/`emissiveIntensity`, and the shell is `LineBasicMaterial`
 * — both ignore scene lighting entirely, so no light rig is needed for the wireframe/
 * emissive look. This matches the approved reference (thin glowing edges on near-black,
 * fixtures reading as real emissive geometry), and it's also just fewer moving parts.
 */

import * as THREE from 'three';
import { LIGHT_FIXTURES, OUTLET_FIXTURES, ROOM } from './geometry';
import { lightMaterialState, outletSocketMaterialState, SHELL_LINE_COLOR, type MaterialState } from './materials';
import type { Reading } from '@/lib/types';

export type PickResult = { kind: 'light'; circuit: string } | { kind: 'outlet'; id: string; socket: 1 | 2 } | null;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function applyMaterialState(mesh: THREE.Mesh, state: MaterialState) {
  const mat = mesh.material as THREE.MeshStandardMaterial;
  mat.emissive.set(state.color);
  mat.emissiveIntensity = state.emissiveIntensity;
  mat.opacity = state.opacity;
}

function indicatorMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x000000, transparent: true, roughness: 1 });
}

export class OfficeScene {
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private renderer: THREE.WebGLRenderer;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();

  private lightMeshesByCircuit = new Map<string, THREE.Mesh[]>();
  private outletMeshesById = new Map<string, { s1: THREE.Mesh; s2: THREE.Mesh }>();
  private pickables: THREE.Object3D[] = [];

  private theta = Math.PI / 4;
  private phi = Math.PI / 3.2;
  private readonly radius = Math.max(ROOM.width, ROOM.depth) * 1.6;
  private readonly target = new THREE.Vector3(0, ROOM.ceilingHeight * 0.35, 0);
  private readonly frustum = Math.max(ROOM.width, ROOM.depth) * 0.85;

  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.OrthographicCamera(-this.frustum, this.frustum, this.frustum, -this.frustum, 0.1, 100);

    this.buildShell();
    this.buildLightFixtures();
    this.buildOutletFixtures();
    this.updateCameraPosition();
  }

  // -------------------------------------------------------------------------
  // Build
  // -------------------------------------------------------------------------

  /**
   * Room shell as line art only — floor grid, the 4-wall box, and the partition. A solid
   * box would need a "cutaway" (drawing only 2 of 4 walls) so the camera could see inside;
   * wireframe edges never occlude, so the full box reads as open from any angle without one.
   *
   * Furniture and the ACU are NOT placed here. Nothing in the live flow records where
   * CARE's furniture actually is or where the ACU is mounted — inventing a position would
   * make the model look surveyed when it isn't, which is exactly what this project's
   * "never fabricate a reading" rule extends to for geometry too. Extension point, not an
   * oversight: add fixtures here once someone measures the real room.
   */
  private buildShell() {
    const lineMat = new THREE.LineBasicMaterial({ color: SHELL_LINE_COLOR, transparent: true, opacity: 0.55 });

    const grid = new THREE.GridHelper(Math.max(ROOM.width, ROOM.depth), 20, SHELL_LINE_COLOR, SHELL_LINE_COLOR);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.18;
    this.scene.add(grid);

    const box = new THREE.BoxGeometry(ROOM.width, ROOM.ceilingHeight, ROOM.depth);
    const boxEdges = new THREE.LineSegments(new THREE.EdgesGeometry(box), lineMat);
    boxEdges.position.set(0, ROOM.ceilingHeight / 2, 0);
    this.scene.add(boxEdges);

    // Half-height partition — the real detail that explains the room's two compartments
    // (and why circuit l7 lights a smaller, separate area from l1..l6).
    const partitionHeight = ROOM.ceilingHeight * 0.5;
    const partition = new THREE.BoxGeometry(ROOM.width, partitionHeight, 0.02);
    const partitionEdges = new THREE.LineSegments(new THREE.EdgesGeometry(partition), lineMat);
    partitionEdges.position.set(0, partitionHeight / 2, ROOM.partitionZ);
    this.scene.add(partitionEdges);
  }

  private buildLightFixtures() {
    const geo = new THREE.BoxGeometry(0.18, 0.03, 0.18);
    for (const fixture of LIGHT_FIXTURES) {
      const mesh = new THREE.Mesh(geo, indicatorMaterial());
      mesh.position.set(fixture.world.x, fixture.world.y, fixture.world.z);
      mesh.userData = { kind: 'light', circuit: fixture.circuit };
      this.scene.add(mesh);
      this.pickables.push(mesh);

      const group = this.lightMeshesByCircuit.get(fixture.circuit) ?? [];
      group.push(mesh);
      this.lightMeshesByCircuit.set(fixture.circuit, group);
    }
  }

  /** Each outlet is dual-socket: two small meshes side by side along the wall's tangent. */
  private buildOutletFixtures() {
    const geo = new THREE.BoxGeometry(0.06, 0.1, 0.03);
    const OFFSET = 0.06;

    for (const fixture of OUTLET_FIXTURES) {
      const { tangent, normal } = fixture.mount;
      const mk = (socket: 1 | 2, sign: 1 | -1) => {
        const mesh = new THREE.Mesh(geo, indicatorMaterial());
        mesh.position.set(
          fixture.world.x + tangent.x * OFFSET * sign + normal.x * 0.02,
          fixture.world.y,
          fixture.world.z + tangent.z * OFFSET * sign + normal.z * 0.02,
        );
        mesh.userData = { kind: 'outlet', id: fixture.id, socket };
        this.scene.add(mesh);
        this.pickables.push(mesh);
        return mesh;
      };
      this.outletMeshesById.set(fixture.id, { s1: mk(1, -1), s2: mk(2, 1) });
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
    // Never let the camera go under the floor or snap to a flat top-down view.
    this.phi = clamp(this.phi + dPhi, 0.15, Math.PI / 2 - 0.02);
    this.updateCameraPosition();
    this.render();
  }

  /** Ortho "zoom" is the frustum scale, not camera distance — moving an ortho camera doesn't change apparent size. */
  zoom(factor: number) {
    this.camera.zoom = clamp(this.camera.zoom * factor, 0.5, 3);
    this.camera.updateProjectionMatrix();
    this.render();
  }

  resize(width: number, height: number) {
    if (width <= 0 || height <= 0) return;
    const aspect = width / height;
    this.camera.left = -this.frustum * aspect;
    this.camera.right = this.frustum * aspect;
    this.camera.top = this.frustum;
    this.camera.bottom = -this.frustum;
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
