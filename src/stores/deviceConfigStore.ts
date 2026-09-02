import { create } from 'zustand';
import type { PresetPlacement } from '@/lib/planPresets';
import { toggleFixture } from '@/lib/lightingGrid';
import { supabase } from '@/config/supabase';
import { fetchDeviceConfigs, writeDeviceConfig } from '@/lib/supabaseDeviceConfig';
import { coerceFunctions, type DeviceFunction } from '@/lib/deviceFunctions';
import { coerceCategory, coerceLoadShedGroup, effectiveConfig, emptyDeviceConfig, isSameConfig, normalizeDeviceConfig, type DeviceConfig, type DeviceConfigField } from '@/lib/deviceConfig';
import type { PlanPoint } from '@/lib/planLayout';
import { createRetrySchedule } from './retrySchedule';

const retry = createRetrySchedule();

function withoutKey<T>(map: Record<string, T>, key: string): Record<string, T> {
  const out = { ...map };
  delete out[key];
  return out;
}

interface DeviceConfigState {
  /** `device_config` as of the last successful `load()`/`save()` — architecture plan
   * Phase 7. Keyed by device id, same shape `deviceConfigsToMap` produces. */
  saved: Record<string, DeviceConfig>;
  /** Local edits not yet written, one entry per device currently being edited. A key here
   * overrides `saved` for display but has no effect anywhere until `save(deviceId)`
   * succeeds — same optimistic-but-separate pattern `contextStore` uses. */
  draft: Record<string, DeviceConfig>;
  status: 'idle' | 'loading' | 'ready';
  saveStatus: 'idle' | 'saving' | 'error';
  saveError: string | null;
  /** The last successful write, naming which device — there is no bulk "Arm all" fan-out
   * here, every save is one device, so the confirmation can and should say which one. */
  lastSave: { at: number; deviceId: string } | null;
  load: () => Promise<void>;
  setDraftField: (deviceId: string, field: DeviceConfigField, value: string) => void;
  /**
   * `functions` is the one field that is neither text nor a single-select, so it gets its own
   * action rather than widening `setDraftField`'s value type to `string | string[] | null` and
   * making every existing caller carry a union it never uses.
   */
  setDraftFunctions: (deviceId: string, functions: DeviceFunction[] | null) => void;
  /**
   * Where the device sits on its space's plan — RM-031. Its own action for the same reason
   * `functions` has one: a point is neither text nor a single-select, and widening
   * `setDraftField`'s value type would make every existing caller carry a union it never uses.
   */
  setDraftPosition: (deviceId: string, point: PlanPoint | null) => void;
  /**
   * Stage a position and write it in one step.
   *
   * SAVED ON DROP, NOT BEHIND A SAVE BUTTON, and that is a deliberate difference from every
   * other field here. Releasing a pin IS the confirmation — a plan still showing the pin where
   * it was dropped while the change sits unsaved is displaying a position the database does not
   * have, which is the same class of lie as a frozen power reading.
   */
  placeOnPlan: (deviceId: string, point: PlanPoint | null) => Promise<void>;
  /** Applies a whole layout — see `src/lib/planPresets.ts`. */
  applyPlacements: (placements: PresetPlacement[]) => Promise<void>;
  /** Adds or removes one lamp for a lighting circuit, snapped to the tapped grid cell. */
  toggleFixtureAt: (deviceId: string, at: PlanPoint, cols: number, rows: number) => Promise<void>;
  save: (deviceId: string) => Promise<void>;
}

/**
 * Supabase-backed `device_config` state for the Devices page's metadata editor — room,
 * category, load-shed group, display-name override, notes. Loaded once at app start
 * (`useLiveConnection.ts`), not lazily on the Devices page's mount, same reasoning
 * `contextStore` gives for its own load: another page could reasonably want this data later
 * without a second load path.
 */
export const useDeviceConfigStore = create<DeviceConfigState>((set, get) => ({
  saved: {},
  draft: {},
  status: 'idle',
  saveStatus: 'idle',
  saveError: null,
  lastSave: null,

  // Retries with backoff, same reasoning as contextStore.load(). Unconfigured Supabase (local
  // dev against the mock, no VITE_SUPABASE_* set) is NOT transient — it resolves straight to
  // an empty, ready store instead of retrying forever.
  load: async () => {
    set({ status: 'loading' });
    retry.cancel();
    if (!supabase) {
      set({ saved: {}, status: 'ready' });
      return;
    }
    const attempt = async (): Promise<void> => {
      try {
        const saved = await fetchDeviceConfigs();
        retry.succeeded();
        set({ saved, status: 'ready' });
      } catch {
        retry.retryAfterFailure(attempt);
      }
    };
    await attempt();
  },

  // Builds on top of the effective (draft-or-saved) config, not a blank one, so editing one
  // field doesn't discard the others already staged. category/loadShedGroup are coerced
  // immediately (a <select> only ever offers valid options, and '' — "nothing selected" —
  // must resolve to null right away since DeviceConfig's type has no room for a raw string
  // there); room/displayNameOverride/notes stay as typed and are normalized once at save time,
  // not per keystroke, so a trailing space mid-word doesn't get eaten while typing.
  setDraftField: (deviceId, field, value) =>
    set((s) => {
      const base = effectiveConfig(s.draft, s.saved, deviceId);
      const next: DeviceConfig =
        // Same reasoning as category/loadShedGroup below: a <select> only ever offers valid
        // options, and '' — "Not placed" — must resolve to null right away. Left as '' it would
        // read as an edit against an already-unplaced device, and would fail the foreign key.
        field === 'spaceNodeId'
          ? { ...base, spaceNodeId: value === '' ? null : value }
          : field === 'category'
          ? { ...base, category: coerceCategory(value) }
          : field === 'loadShedGroup'
            ? { ...base, loadShedGroup: coerceLoadShedGroup(value) }
            : { ...base, [field]: value };
      return { draft: { ...s.draft, [deviceId]: next } };
    }),

  setDraftFunctions: (deviceId, functions) =>
    set((s) => {
      const base = effectiveConfig(s.draft, s.saved, deviceId);
      return { draft: { ...s.draft, [deviceId]: { ...base, functions: coerceFunctions(functions) } } };
    }),

  setDraftPosition: (deviceId, point) =>
    set((s) => {
      // Built on the effective config, never on a blank one: the write is a whole-row upsert,
      // so placing a pin from an empty base would erase the notes, category and shed tier of
      // the very device being dragged.
      const base = effectiveConfig(s.draft, s.saved, deviceId);
      return { draft: { ...s.draft, [deviceId]: { ...base, planX: point?.x ?? null, planY: point?.y ?? null } } };
    }),

  /**
   * Toggles one lamp for a lighting circuit and saves — RM-037.
   *
   * Built on the effective config for the same reason  is: the write is a
   * whole-row upsert, so painting a ceiling from a blank base would erase the notes, category
   * and shed tier of the very circuit being drawn.
   *
   * Saves immediately, like . A ceiling on screen that the database does not have
   * is the same dishonesty a pin behind a Save button would be.
   */
  toggleFixtureAt: async (deviceId, at, cols, rows) => {
    set((s) => {
      const base = effectiveConfig(s.draft, s.saved, deviceId);
      const next = toggleFixture(base.planFixtures, at, cols, rows);
      return { draft: { ...s.draft, [deviceId]: { ...base, planFixtures: next } } };
    });
    await get().save(deviceId);
  },

  /**
   * Writes a whole layout at once — RM-044.
   *
   * Built on each device's EFFECTIVE config, the same reason `setDraftPosition` is: the write is
   * a whole-row upsert, so applying a layout from blank bases would erase the notes, category and
   * shed tier of every device it touched. A preset says where things are; it says nothing about
   * what they are for.
   *
   * ONE DEVICE AT A TIME, sequentially, and a failure stops rather than continuing. A layout that
   * applied to nine of fourteen devices and reported success would leave a room that looks drawn
   * and is wrong — worse than one that stopped and said where.
   */
  applyPlacements: async (placements) => {
    for (const p of placements) {
      set((s) => {
        const base = effectiveConfig(s.draft, s.saved, p.deviceId);
        return {
          draft: {
            ...s.draft,
            [p.deviceId]: {
              ...base,
              spaceNodeId: p.spaceNodeId,
              planX: p.planX,
              planY: p.planY,
              planFixtures: p.planFixtures,
            },
          },
        };
      });
      await get().save(p.deviceId);
      if (get().saveStatus === 'error') return;
    }
  },

  placeOnPlan: async (deviceId, point) => {
    get().setDraftPosition(deviceId, point);
    // `save` does the rest, including the case worth naming: a device with no space node
    // normalises the position straight back out (phase23's third invariant, applied in
    // `normalizeDeviceConfig`), so the draft matches what is saved and no write is attempted.
    await get().save(deviceId);
  },

  save: async (deviceId) => {
    const { draft, saved } = get();
    const pending = draft[deviceId];
    if (!pending) return;

    const normalized = normalizeDeviceConfig(pending);
    if (isSameConfig(normalized, saved[deviceId] ?? emptyDeviceConfig(deviceId))) {
      // Normalizes to what's already saved (e.g. typed then cleared, or just re-trimmed
      // whitespace) — drop the draft, no network call for a write that would change nothing.
      set((s) => ({ draft: withoutKey(s.draft, deviceId) }));
      return;
    }

    set({ saveStatus: 'saving', saveError: null });
    try {
      // supabase-js's getSession() reads the already-persisted local session, no network
      // round trip — null when unconfigured or when the caller is on a break-glass local
      // session (which never signs into the Supabase client itself), and writeDeviceConfig
      // then fails on the row-count check with a message telling the operator exactly that.
      const actorUserId = supabase ? ((await supabase.auth.getSession()).data.session?.user.id ?? null) : null;
      await writeDeviceConfig(normalized, actorUserId);
      set((s) => ({
        saved: { ...s.saved, [deviceId]: normalized },
        draft: withoutKey(s.draft, deviceId),
        saveStatus: 'idle',
        lastSave: { at: Date.now(), deviceId },
      }));
    } catch (err) {
      set({ saveStatus: 'error', saveError: err instanceof Error ? err.message : 'The write failed.' });
    }
  },
}));
