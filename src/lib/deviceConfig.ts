/**
 * The device-metadata model and its pure helpers — architecture plan Phase 7, the data-model
 * half of the deferred Phase 4.5 onboarding wizard.
 *
 * Deliberately imports no Supabase client: `supabaseDeviceConfig.ts` owns the row shape and
 * the network, this file owns the shape the UI thinks in. Same split `deviceClass.ts` has from
 * `bridgeClient.ts`, and it is what lets every rule below be tested with plain objects and no
 * mocks (`supabaseConfig.test.ts`'s pattern).
 *
 * `category` is NOT a second `Device.class`. `class` is flow-critical and immutable from the
 * UI — command validation, state shape, icons and filters all key off it. `category` is the
 * operator's own functional grouping and means nothing to the bridge.
 */
import type { DeviceFunction } from './deviceFunctions';
import { parseFixtures } from './lightingGrid';
import type { PlanPoint } from './planLayout';
import { coerceFunctions } from './deviceFunctions';
import type { Device } from './types';
import { pathLabel, type SpaceNode } from './spaceTree';
import { planPointOf } from './planLayout';

export type DeviceCategory = 'lighting' | 'aircon' | 'outlet' | 'branch_circuit' | 'sensor' | 'critical' | 'other';
export type LoadShedGroup = 'group_1' | 'group_2' | 'group_3' | 'never';

export interface DeviceConfig {
  deviceId: string;
  /**
   * Where this device sits in the space tree (RM-028), or null if unplaced.
   *
   * `room` below is NOT superseded by this — it is kept as the label a site still shows before
   * anyone has built a tree, and as the fallback when a placement points at a node this client
   * no longer has. `placementLabel` decides the precedence once, so no call site re-derives it.
   */
  spaceNodeId: string | null;
  /**
   * Where this device sits INSIDE that node — normalised 0..1, RM-031. Null means placed in a
   * room but not yet positioned on its plan, which is a different state from unplaced entirely
   * and is why these are not folded into `spaceNodeId`.
   *
   * Both or neither, always. `planLayout.ts` decides that once; nothing else re-derives it.
   */
  planX: number | null;
  planY: number | null;
  /**
   * Where the several things this device controls are — today, a lighting circuit and its
   * lamps. Empty for everything else. Separate from planX/planY because a device HAS a
   * position while a circuit has a SET of them, and folding both into one array would make
   * every consumer ask which it was looking at. See src/lib/lightingGrid.ts.
   */
  planFixtures: PlanPoint[];
  room: string | null;
  category: DeviceCategory | null;
  loadShedGroup: LoadShedGroup | null;
  displayNameOverride: string | null;
  notes: string | null;
  /** Which roles this device serves here; `null` means "not configured", so the class default applies. */
  functions: DeviceFunction[] | null;
}

export type DeviceConfigField = 'spaceNodeId' | 'room' | 'category' | 'loadShedGroup' | 'displayNameOverride' | 'notes' | 'functions';

/** The `value`s are exactly what supabase/phase7_device_config.sql's CHECK constraint
 * accepts — the option list and the constraint are one fact in two places, and this comment
 * is the reminder to change both. */
export const CATEGORY_OPTIONS: ReadonlyArray<{ value: DeviceCategory; label: string }> = [
  { value: 'lighting', label: 'Lighting' },
  { value: 'aircon', label: 'Aircon' },
  { value: 'outlet', label: 'Outlet' },
  { value: 'branch_circuit', label: 'Branch Circuit' },
  { value: 'sensor', label: 'Sensors' },
  { value: 'critical', label: 'Critical' },
  { value: 'other', label: 'Others' },
];

/** Order is the shed order: group_1 sheds first, `never` is protected. */
export const LOAD_SHED_OPTIONS: ReadonlyArray<{ value: LoadShedGroup; label: string }> = [
  { value: 'group_1', label: 'Group 1 — shed first' },
  { value: 'group_2', label: 'Group 2' },
  { value: 'group_3', label: 'Group 3 — shed last' },
  { value: 'never', label: 'Never shed (protected)' },
];

const CATEGORY_LABEL = Object.fromEntries(CATEGORY_OPTIONS.map((o) => [o.value, o.label])) as Record<DeviceCategory, string>;

/** Short forms for the table row, where the full "Group 1 — shed first" would not fit. */
const LOAD_SHED_SHORT: Record<LoadShedGroup, string> = { group_1: 'Shed 1', group_2: 'Shed 2', group_3: 'Shed 3', never: 'Protected' };

export function emptyDeviceConfig(deviceId: string): DeviceConfig {
  return { deviceId, spaceNodeId: null, planX: null, planY: null, planFixtures: [], room: null, category: null, loadShedGroup: null, displayNameOverride: null, notes: null, functions: null };
}

/** Unknown values become null rather than throwing or passing through. The only ways one can
 * arrive are a stale draft or a hand-edited row; a dropped bad value beats a 400 from the
 * column's CHECK constraint, and beats a <select> silently rendering blank-but-set. */
export function coerceCategory(value: string | null): DeviceCategory | null {
  return CATEGORY_OPTIONS.some((o) => o.value === value) ? (value as DeviceCategory) : null;
}

export function coerceLoadShedGroup(value: string | null): LoadShedGroup | null {
  return LOAD_SHED_OPTIONS.some((o) => o.value === value) ? (value as LoadShedGroup) : null;
}

/** Trims every text field and collapses '' to null, so "cleared the box" and "never set it"
 * are the same row state. Without this, a cleared field would save as '' and read back as a
 * value, and the pending-edit diff would report a phantom edit that never clears.
 *
 * Applied once at save time, NOT per keystroke — trimming on every change makes a space
 * un-typable mid-word. */
export function normalizeDeviceConfig(config: DeviceConfig): DeviceConfig {
  const text = (v: string | null) => {
    const t = (v ?? '').trim();
    return t === '' ? null : t;
  };
  const spaceNodeId = text(config.spaceNodeId);
  /**
   * A position is dropped unless it is complete, in range, AND has a room to be a position in —
   * phase23's three invariants, applied before the write rather than after the 400 comes back.
   * The database is the backstop, not the first line: a rejected upsert surfaces as a raw
   * Postgres constraint name, which tells an operator nothing they can act on.
   *
   * Note what is NOT decided here: whether a MOVE should discard the old room's coordinates.
   * That needs the previous row, which this function does not have, so the trigger in phase23
   * owns it. Client owns validity, database owns the move.
   */
  const point = spaceNodeId === null ? null : planPointOf(config);

  return {
    deviceId: config.deviceId,
    // A cleared <select> yields '', which must become null: "unplaced" and "placed at the empty
    // string" are not two states, and '' would fail the foreign key on write.
    spaceNodeId,
    planX: point?.x ?? null,
    planY: point?.y ?? null,
    planFixtures: parseFixtures(config.planFixtures),
    room: text(config.room),
    category: coerceCategory(config.category),
    loadShedGroup: coerceLoadShedGroup(config.loadShedGroup),
    displayNameOverride: text(config.displayNameOverride),
    notes: text(config.notes),
    functions: coerceFunctions(config.functions),
  };
}

/** Compares the editable fields only — `deviceId` is the key, not part of the value.
 * `functions` is an array, so it is compared by value: reference equality would report a
 * phantom edit every render and never clear. */
/** `null` (unconfigured) and `[]` (configured as none) are different values, so a plain
 * length-and-contents check has to keep them apart rather than treating both as empty. */
function sameFunctions(a: DeviceFunction[] | null, b: DeviceFunction[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((f, i) => f === b[i]);
}

export function isSameConfig(a: DeviceConfig, b: DeviceConfig): boolean {
  return (
    a.spaceNodeId === b.spaceNodeId &&
    a.planX === b.planX &&
    JSON.stringify(a.planFixtures) === JSON.stringify(b.planFixtures) &&
    a.planY === b.planY &&
    a.room === b.room &&
    a.category === b.category &&
    a.loadShedGroup === b.loadShedGroup &&
    a.displayNameOverride === b.displayNameOverride &&
    a.notes === b.notes &&
    sameFunctions(a.functions, b.functions)
  );
}

/** The name this dashboard shows. Callers must keep the registry name visible alongside it
 * (see DevicesView's meta line): an override relabels the UI, it does not rename the device
 * anywhere the bridge or Node-RED can see. */
export function resolveDisplayName(device: Device, config: DeviceConfig | undefined): string {
  return config?.displayNameOverride ?? device.display_name;
}

/** The operator-recorded room wins over the registry's own (always-null-today) `room` field —
 * deciding this once here means no other call site has to re-derive the precedence. */
export function resolveRoom(device: Device, config: DeviceConfig | undefined): string | null {
  return config?.room ?? device.room ?? null;
}

/** Prefers an in-progress draft, then the last-saved row, then an empty config — the same
 * draft-over-saved precedence `contextStore.ts`'s components read through. */
export function effectiveConfig(draft: Record<string, DeviceConfig>, saved: Record<string, DeviceConfig>, deviceId: string): DeviceConfig {
  return draft[deviceId] ?? saved[deviceId] ?? emptyDeviceConfig(deviceId);
}

/** A short "Room · Category" / "Protected" line for the fleet table row. Joins only the parts
 * that are actually recorded, so a freshly-migrated device with nothing set renders nothing —
 * not a row of em-dashes repeated 21 times. */
export function metaSummary(config: DeviceConfig | undefined): string {
  if (!config) return '';
  const parts: string[] = [];
  if (config.room) parts.push(config.room);
  if (config.category) parts.push(CATEGORY_LABEL[config.category]);
  if (config.loadShedGroup) parts.push(LOAD_SHED_SHORT[config.loadShedGroup]);
  return parts.join(' · ');
}

/**
 * Rooms operators have already typed, deduplicated and sorted.
 *
 * TRANSITIONAL. This is the old `knownRooms()` under a name that admits what it is: a list
 * inferred from strings other devices happen to carry, which can only ever offer places already
 * in use. The declared tree (`knownSpaceLabels`) is the replacement.
 *
 * It survives the cut because deleting it would have been a regression in exactly the window it
 * matters: a live site has `device_config.room` text and no tree yet, so sourcing suggestions
 * from the tree alone takes away every existing one until somebody finishes building the tree.
 * The editor offers both, tree first. Retire this once sites are placed.
 */
export function recordedRoomLabels(saved: Record<string, DeviceConfig>): string[] {
  const rooms = new Set<string>();
  for (const config of Object.values(saved)) {
    if (config.room) rooms.add(config.room);
  }
  return Array.from(rooms).sort((a, b) => a.localeCompare(b));
}

/**
 * The one place that decides how a device's location is described — RM-028.
 *
 * Precedence, and each step exists for a reason:
 *   1. the space tree, when the device is placed AND that node is known here;
 *   2. the operator's typed `room`, which is what a site shows before a tree exists;
 *   3. the registry's own `room`, always null today;
 *   4. nothing, rendered as nothing rather than as an em-dash.
 *
 * Step 1 checks the node RESOLVES, not merely that an id is set. `on delete set null` clears a
 * placement server-side, but a stale draft or a delete racing this render can leave an id
 * pointing at a node this client no longer holds — and falling through to the typed room is
 * strictly better than showing an empty label for a device that has one.
 *
 * This replaces `knownRooms()`, which derived the room list from whatever strings operators had
 * already typed. That could only ever offer places already in use, so a room with nothing in it
 * yet was unofferable and a typo became a permanent second room. The tree is declared, not
 * inferred, which is the whole point of RM-028 — see `knownSpaceLabels` in `spaceTree.ts`.
 */
export function placementLabel(device: Device, config: DeviceConfig | undefined, nodes: readonly SpaceNode[]): string {
  const fromTree = pathLabel(nodes, config?.spaceNodeId);
  if (fromTree) return fromTree;
  return config?.room ?? device.room ?? '';
}
