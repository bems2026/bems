import { create } from 'zustand';

/**
 * Whether the alerts bell's panel is open — RM-165. A store rather than the bell's own state so a card can
 * open it: the meter rows' "held" tag points at the notice the bell now carries instead of printing it.
 */
interface AlertsPanelState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const useAlertsPanelStore = create<AlertsPanelState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}));
