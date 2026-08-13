/**
 * Pure data model for the 3D card's "Edit layout" tool — the user-placed desks/tables an
 * operator adds on top of the fixed scene (the room shell, the real light/outlet fixtures,
 * and the ACU units), which stay exactly where `geometry.ts`'s `FURNITURE` table put them
 * and are never edited from here.
 *
 * Kept dependency-free of `three` and the DOM (same reasoning `geometry.ts`'s own header
 * gives for staying three-free): everything here is plain data and pure functions, so it's
 * testable without a WebGL context, and it's the single place layout validation logic lives
 * — `officeScene.ts` and `OfficeScene3D.tsx` both call into this rather than each carrying
 * their own copy of "what makes a layout item valid."
 */

import { ROOM } from './geometry';

/** What the "Edit layout" toolbar can add. Each maps to one of `furniture.ts`'s existing
 * factories via `officeScene.ts`'s `EDITABLE_FACTORY_KIND` — nothing new was built for this,
 * the factories already covered a desk, a table, a dispenser, and a shelving unit before
 * this tool existed; this just exposes four of them as placeable pieces instead of one fixed
 * spot each in `geometry.ts`'s `FURNITURE` table. */
export type EditableKind = 'desk' | 'table' | 'dispenser' | 'shelf' | 'bench';

export interface EditableItem {
  /** Stable per-item id, from `newItemId()` below. Never reused, never derived from
   * position, so two items can occupy the same spot without colliding identities. */
  id: string;
  kind: EditableKind;
  x: number;
  z: number;
  /** Y-axis rotation, radians — same convention `geometry.ts`'s `FurnitureSpec.ry` uses. */
  ry: number;
}

/**
 * Same fallback `commandStore.ts`'s `newCommandId()` uses: `crypto.randomUUID()` requires a
 * secure context, and this kiosk/LAN dashboard's own `vite.config.ts` explicitly serves over
 * plain HTTP for LAN reachability (`host: true`) — an environment where `randomUUID` isn't
 * guaranteed to exist. The fallback only needs to be locally unique among items placed in one
 * session, not cryptographically unpredictable, so a timestamp + random suffix is enough.
 */
export function newItemId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const LAYOUT_STORAGE_KEY = 'ibems.layout.v1';

/** Margin kept clear of every wall — half the room's largest placeable piece (a desk's
 * ~1.0m span) rounded up, so a placed item's own footprint can't clip through a wall even
 * before its factory-specific bounding box is known here. */
const WALL_MARGIN = 0.6;

/** Keeps a placed or pasted point inside the room and off every wall face — the one rule
 * this tool enforces on placement, everything else about where a piece sits is the
 * operator's call. */
export function clampToRoom(x: number, z: number): { x: number; z: number } {
  return {
    x: Math.min(ROOM.maxX - WALL_MARGIN, Math.max(ROOM.minX + WALL_MARGIN, x)),
    z: Math.min(ROOM.maxZ - WALL_MARGIN, Math.max(ROOM.minZ + WALL_MARGIN, z)),
  };
}

/** Paste offset — enough to visibly separate the copy from its source without it being a
 * search to find (0.5m reads clearly at this scene's usual zoom, not so far it lands outside
 * the room from a source already near a wall — `clampToRoom` is the actual backstop for
 * that case regardless). */
const PASTE_OFFSET = 0.5;

/** Where a pasted item lands: offset from `from` (the current selection, or the clipboard's
 * own last-known position if nothing is selected) and always clamped back into the room. */
export function pastePosition(from: { x: number; z: number }): { x: number; z: number } {
  return clampToRoom(from.x + PASTE_OFFSET, from.z + PASTE_OFFSET);
}

const EDITABLE_KINDS: readonly EditableKind[] = ['desk', 'table', 'dispenser', 'shelf', 'bench'];

function isEditableKind(v: unknown): v is EditableKind {
  return (EDITABLE_KINDS as readonly unknown[]).includes(v);
}

/** 45° — eight facings per full turn. Coarse enough that "Rotate" is one predictable button
 * (click until it faces the right way) rather than needing a numeric input or drag-to-turn
 * for what's usually just "make it face the room, not the wall." */
const ROTATE_STEP = Math.PI / 4;

/** Next rotation after one click of "Rotate" — wrapped into `[0, 2π)` so `ry` never
 * accumulates into an ever-growing number over repeated clicks (harmless for rendering,
 * since Three.js normalises rotation anyway, but it keeps saved/exported values small and
 * readable instead of drifting to things like `37.7`). */
export function nextRotation(ry: number): number {
  const TWO_PI = Math.PI * 2;
  return ((ry + ROTATE_STEP) % TWO_PI + TWO_PI) % TWO_PI;
}

/** Structural validation for one item — used by both the localStorage load path and file
 * import, so a hand-edited or corrupted JSON file is rejected the same way stale/corrupted
 * localStorage is: dropped, never partially trusted. */
export function isValidEditableItem(v: unknown): v is EditableItem {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === 'string' && o.id.length > 0 && isEditableKind(o.kind) && typeof o.x === 'number' && typeof o.z === 'number' && typeof o.ry === 'number' && Number.isFinite(o.x) && Number.isFinite(o.z) && Number.isFinite(o.ry);
}

/** Parses a layout export/import payload. Returns `null` for anything that isn't an array
 * of valid items — never a partially-accepted list, since a half-imported layout (some rows
 * silently dropped) is a worse failure mode than the whole import being refused with a
 * clear error. */
export function parseLayoutJson(text: string): EditableItem[] | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(data) || !data.every(isValidEditableItem)) return null;
  return data;
}

/** `localStorage` can throw (private browsing, quota, disabled storage) — every call here
 * is wrapped so a storage failure degrades to "nothing saved," never an uncaught exception
 * from what's otherwise a routine UI action. */
export function loadLayout(): EditableItem[] {
  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return [];
    return parseLayoutJson(raw) ?? [];
  } catch {
    return [];
  }
}

/** Returns whether the write actually succeeded — callers use this to decide whether to
 * show a confirmation or an error, rather than assuming a save always lands. */
export function saveLayout(items: EditableItem[]): boolean {
  try {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(items));
    return true;
  } catch {
    return false;
  }
}

export function clearSavedLayout(): void {
  try {
    window.localStorage.removeItem(LAYOUT_STORAGE_KEY);
  } catch {
    // Nothing to recover into — a failed removal just leaves stale storage that the next
    // successful save() will overwrite anyway.
  }
}

export function exportLayoutFilename(now = new Date()): string {
  return `ibems-layout-${now.toISOString().slice(0, 10)}.json`;
}
