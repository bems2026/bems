import { create } from 'zustand';
import { nextPollDelayMs } from '@/lib/bridgeClient';
import { supabase } from '@/config/supabase';
import { fetchDeviceConfigs, writeDeviceConfig } from '@/lib/supabaseDeviceConfig';
import { coerceCategory, coerceLoadShedGroup, effectiveConfig, emptyDeviceConfig, isSameConfig, normalizeDeviceConfig, type DeviceConfig, type DeviceConfigField } from '@/lib/deviceConfig';

let loadAttempt = 0;
let loadRetryTimer: ReturnType<typeof setTimeout> | null = null;

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
    if (loadRetryTimer) {
      clearTimeout(loadRetryTimer);
      loadRetryTimer = null;
    }
    if (!supabase) {
      set({ saved: {}, status: 'ready' });
      return;
    }
    const attempt = async (): Promise<void> => {
      try {
        const saved = await fetchDeviceConfigs();
        loadAttempt = 0;
        set({ saved, status: 'ready' });
      } catch {
        loadAttempt++;
        loadRetryTimer = setTimeout(attempt, nextPollDelayMs(loadAttempt));
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
        field === 'category'
          ? { ...base, category: coerceCategory(value) }
          : field === 'loadShedGroup'
            ? { ...base, loadShedGroup: coerceLoadShedGroup(value) }
            : { ...base, [field]: value };
      return { draft: { ...s.draft, [deviceId]: next } };
    }),

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
