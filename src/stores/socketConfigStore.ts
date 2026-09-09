import { create } from 'zustand';
import { supabase } from '@/config/supabase';
import { fetchSocketConfigs, writeSocketConfig, type SocketConfig, type SocketConfigMap } from '@/lib/supabaseSocketConfig';
import { coerceLoadShedGroup } from '@/lib/deviceConfig';
import { createRetrySchedule } from './retrySchedule';
import type { SocketIndex } from '@/lib/types';

const retry = createRetrySchedule();

/** Row identity for per-socket busy/error state. Matches `shedTiers`' `ShedRow.key`. */
export const socketKey = (deviceId: string, socket: SocketIndex) => `${deviceId}:${socket}`;

interface SocketConfigState {
  saved: SocketConfigMap;
  status: 'idle' | 'loading' | 'ready';
  busy: Record<string, boolean>;
  rowError: Record<string, string | null>;
  load: () => Promise<void>;
  /** Sets one socket's shed tier and writes it. */
  setTier: (deviceId: string, socket: SocketIndex, value: string) => Promise<void>;
}

/**
 * `socket_config` — one tier per relay rather than per outlet, RM-067.
 *
 * SAVES ON CHANGE, no staged draft. `deviceConfigStore`'s load-shed editor already worked this
 * way and the reasoning carries: choosing a tier from a select IS the confirmation, and a panel
 * showing a tier the database does not hold is the same class of lie as a frozen power reading.
 *
 * Failures are filed per row, so a refused write reports itself next to the select that caused
 * it and leaves `saved` untouched — the row then snaps back to what the database actually has,
 * rather than displaying a tier that never landed.
 */
export const useSocketConfigStore = create<SocketConfigState>((set, get) => ({
  saved: {},
  status: 'idle',
  busy: {},
  rowError: {},

  load: async () => {
    set({ status: 'loading' });
    retry.cancel();
    if (!supabase) {
      set({ saved: {}, status: 'ready' });
      return;
    }
    const attempt = async (): Promise<void> => {
      try {
        const saved = await fetchSocketConfigs();
        retry.succeeded();
        set({ saved, status: 'ready' });
      } catch {
        retry.retryAfterFailure(attempt);
      }
    };
    await attempt();
  },

  setTier: async (deviceId, socket, value) => {
    const key = socketKey(deviceId, socket);
    const existing = get().saved[deviceId]?.[socket];
    const next: SocketConfig = {
      deviceId,
      socket,
      loadShedGroup: coerceLoadShedGroup(value),
      label: existing?.label ?? null,
    };

    set((s) => ({ busy: { ...s.busy, [key]: true }, rowError: { ...s.rowError, [key]: null } }));
    try {
      const actorUserId = supabase ? (await supabase.auth.getSession()).data.session?.user.id ?? null : null;
      await writeSocketConfig(next, actorUserId);
      set((s) => ({
        saved: { ...s.saved, [deviceId]: { ...(s.saved[deviceId] ?? {}), [socket]: next } },
        busy: { ...s.busy, [key]: false },
      }));
    } catch (err) {
      set((s) => ({
        busy: { ...s.busy, [key]: false },
        rowError: { ...s.rowError, [key]: err instanceof Error ? err.message : 'The write failed.' },
      }));
    }
  },
}));
