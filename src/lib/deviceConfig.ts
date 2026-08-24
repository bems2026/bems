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
import { coerceFunctions } from './deviceFunctions';
import type { Device } from './types';

export type DeviceCategory = 'lighting' | 'aircon' | 'outlet' | 'branch_circuit' | 'critical' | 'other';
export type LoadShedGroup = 'group_1' | 'group_2' | 'group_3' | 'never';

export interface DeviceConfig {
  deviceId: string;
  room: string | null;
  category: DeviceCategory | null;
  loadShedGroup: LoadShedGroup | null;
  displayNameOverride: string | null;
  notes: string | null;
  /** Which roles this device serves here; `null` means "not configured", so the class default applies. */
  functions: DeviceFunction[] | null;
}

export type DeviceConfigField = 'room' | 'category' | 'loadShedGroup' | 'displayNameOverride' | 'notes' | 'functions';

/** The `value`s are exactly what supabase/phase7_device_config.sql's CHECK constraint
 * accepts — the option list and the constraint are one fact in two places, and this comment
 * is the reminder to change both. */
export const CATEGORY_OPTIONS: ReadonlyArray<{ value: DeviceCategory; label: string }> = [
  { value: 'lighting', label: 'Lighting' },
  { value: 'aircon', label: 'Aircon' },
  { value: 'outlet', label: 'Outlet' },
  { value: 'branch_circuit', label: 'Branch Circuit' },
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
  return { deviceId, room: null, category: null, loadShedGroup: null, displayNameOverride: null, notes: null, functions: null };
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
  return {
    deviceId: config.deviceId,
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

/** Every distinct recorded room, sorted — feeds a future room filter/autocomplete without
 * requiring a fixed room list anywhere in the schema. */
export function knownRooms(saved: Record<string, DeviceConfig>): string[] {
  const rooms = new Set<string>();
  for (const config of Object.values(saved)) {
    if (config.room) rooms.add(config.room);
  }
  return Array.from(rooms).sort((a, b) => a.localeCompare(b));
}
