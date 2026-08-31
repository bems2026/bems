import { create } from 'zustand';

export type LogTag = 'RELAY' | 'IR' | 'FAULT';

export interface LogEntry {
  id: string;
  tag: LogTag;
  text: string;
  time: string;
}

interface ControlLogState {
  entries: LogEntry[];
  log: (tag: LogTag, text: string) => void;
}

const MAX_ENTRIES = 20;

/**
 * A session-local record of what Control actually sent — real dispatches only, never
 * v4's sample rows. Resets on reload by design, same as v4's own "No commands sent this
 * session" empty state: nothing server-side persists a command history (the mock bridge
 * doesn't either), so pretending this survives a refresh would be its own kind of
 * fabrication.
 */
export const useControlLog = create<ControlLogState>((set) => ({
  entries: [],
  log: (tag, text) =>
    set((s) => ({
      entries: [
        // The reader's own clock, deliberately: a control-log line records when THEY pressed
        // the button, not something observed in the building. `src/lib/siteTime.ts` has the rule.
        { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, tag, text, time: new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) },
        ...s.entries,
      ].slice(0, MAX_ENTRIES),
    })),
}));
