import { create } from 'zustand';
import type { ConnStatus } from '@/lib/bridgeClient';

/** Shape matches `ibems-dashboard-stage1-plan.md` §4 exactly. */
export interface ConnectionState {
  wsStatus: ConnStatus;
  lastMessageAt: string | null;
  setWsStatus: (status: ConnStatus) => void;
  markMessage: (atIso?: string) => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  wsStatus: 'reconnecting',
  lastMessageAt: null,
  setWsStatus: (wsStatus) => set({ wsStatus }),
  markMessage: (atIso) => set({ lastMessageAt: atIso ?? new Date().toISOString() }),
}));
