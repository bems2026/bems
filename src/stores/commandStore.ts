import { create } from 'zustand';
import { sendCommand, BridgeFetchError } from '@/lib/bridgeClient';
import { TIMING } from '@/lib/timing';
import { useDeviceStore } from './deviceStore';
import { isTotals } from '@/lib/types';
import { isReadingStale } from '@/lib/staleness';
import type { ReadingsLatestRow, SocketIndex, SwitchState } from '@/lib/types';

export type PendingPhase = 'sending' | 'confirming' | 'failed';

export interface PendingCommand {
  command_id: string;
  device_id: string;
  /** Undefined for a whole-device target (a `switch`/`acu_ir`). */
  socket?: SocketIndex;
  /** What was asked for — what the UI shows while pending. */
  desired: SwitchState;
  /** What the feed showed when the command was issued — for "reverted to off" messaging. */
  observedBefore: SwitchState | null;
  phase: PendingPhase;
  issuedAt: number;
  /** Set once the bridge acks. Confirmation grace is counted from here, not `issuedAt`. */
  ackedAt: number | null;
  /** Set only when `phase === 'failed'`. */
  error: string | null;
}

/** One in-flight command per target; a second click on the same socket replaces the first
 * rather than queuing behind it. */
export const targetKey = (deviceId: string, socket?: SocketIndex): string => (socket === undefined ? deviceId : `${deviceId}:${socket}`);

function newCommandId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Readable reason for a rejected command — distinguishes "this app sent something the
 * bridge doesn't understand" (a 400/404 validation rejection — a bug in this UI, not a
 * device problem) from "the bridge said no" (a 5xx-class rejection), without surfacing raw
 * `code` strings like `invalid_socket` to the user. */
function describeFailure(err: unknown): string {
  if (err instanceof BridgeFetchError) {
    const misconfigured = err.status === 400 || err.status === 404;
    if (misconfigured) return 'This control is misconfigured — the bridge rejected it.';
    return `The bridge did not accept the command (${err.status ?? 'no response'}).`;
  }
  return 'The command could not be sent.';
}

interface CommandState {
  pending: Record<string, PendingCommand>;
  send: (deviceId: string, socket: SocketIndex | undefined, desired: SwitchState, targetC?: number) => Promise<void>;
  /** Runs after `ingestReadings` on every live frame — reconciles pending commands against
   * what the feed actually reports. */
  reconcile: (rows: ReadingsLatestRow[], nowMs?: number) => void;
  dismiss: (key: string) => void;
}

/**
 * Optimistic command state, deliberately kept OUT of `deviceStore.latestReadings` — that
 * store stays a faithful record of what the bridge said, nothing else. An optimistic value
 * is exactly the kind of fabricated reading this app's own hard rule forbids in the
 * readings store, so it lives here instead, and the UI composes the two at render time via
 * `lib/socketView.ts`'s `controlView()`. That split is what makes rollback trivial — on
 * failure this store just drops the pending entry; the truth underneath was never touched.
 */
export const useCommandStore = create<CommandState>((set, get) => ({
  pending: {},

  send: async (deviceId, socket, desired, targetC) => {
    const key = targetKey(deviceId, socket);
    const command_id = newCommandId();
    const reading = useDeviceStore.getState().latestReadings[deviceId];
    const observedBefore = socket !== undefined ? (reading?.socket_states?.[socket] ?? null) : (reading?.state ?? null);

    set((s) => ({
      pending: {
        ...s.pending,
        [key]: { command_id, device_id: deviceId, socket, desired, observedBefore, phase: 'sending', issuedAt: Date.now(), ackedAt: null, error: null },
      },
    }));

    try {
      await sendCommand({ device_id: deviceId, socket, action: desired, command_id, ...(targetC === undefined ? {} : { target_c: targetC }) });
      // A newer command for this same target superseded us while this one was in flight —
      // let that one own the pending entry instead of clobbering it with a stale ack.
      if (get().pending[key]?.command_id !== command_id) return;
      set((s) => ({ pending: { ...s.pending, [key]: { ...s.pending[key], phase: 'confirming', ackedAt: Date.now() } } }));
    } catch (err) {
      if (get().pending[key]?.command_id !== command_id) return;
      set((s) => ({ pending: { ...s.pending, [key]: { ...s.pending[key], phase: 'failed', error: describeFailure(err) } } }));
    }
  },

  reconcile: (rows, nowMs = Date.now()) => {
    if (Object.keys(get().pending).length === 0) return; // the common case — skip the work

    const byId: Record<string, ReadingsLatestRow> = {};
    for (const row of rows) byId[row.device_id] = row;

    set((s) => {
      let changed = false;
      const next = { ...s.pending };

      for (const [key, p] of Object.entries(s.pending)) {
        const row = byId[p.device_id];
        if (!row || isTotals(row)) continue; // device absent from this frame — leave pending as-is

        const observed = p.socket !== undefined ? row.socket_states?.[p.socket] : row.state;
        if (observed === undefined) continue;

        if (p.phase === 'failed') {
          // A red pill is a user-facing error awaiting dismissal, not a live command —
          // but sweep it eventually so a forgotten one can't sit forever.
          if (nowMs - p.issuedAt > 15_000) {
            delete next[key];
            changed = true;
          }
          continue;
        }

        if (observed === p.desired && !isReadingStale(row, nowMs)) {
          // The feed agrees, AND it's a live reading, not a frozen one from before this
          // device went offline. This is the success path, and it needs no separate
          // "confirmed" state — dropping the pending entry lets the real reading show
          // through as-is. Without the staleness check, a command sent to an already-
          // disconnected device could resolve as "confirmed" purely by coincidence — the
          // bridge keeps echoing whatever stale state happened to already match what was
          // commanded, never having actually reached the device.
          delete next[key];
          changed = true;
          continue;
        }

        if (p.ackedAt === null) {
          // Leak guard: the bridge never even acked (a dropped request whose client abort
          // somehow didn't fire). 30s is generous — COMMAND_TIMEOUT_MS is 5s.
          if (nowMs - p.issuedAt > 30_000) {
            next[key] = { ...p, phase: 'failed', error: 'The command never reached the bridge.' };
            changed = true;
          }
          continue;
        }

        if (nowMs - p.ackedAt < TIMING.COMMAND_CONFIRM_MS) continue; // still inside a normal dispatch+push window

        // Because nothing reads relay state back, the feed on a working path will simply
        // echo whatever was commanded (via the mock's override map). This branch fires
        // only when the command genuinely never reached that state — correct to flag, but
        // NOT hardware confirmation the other branch's silence isn't either. See
        // relayCorroboration.ts for the one place a real measurement can corroborate this.
        next[key] = { ...p, phase: 'failed', error: 'The device did not report the new state.' };
        changed = true;
      }

      return changed ? { pending: next } : s;
    });
  },

  dismiss: (key) =>
    set((s) => {
      const next = { ...s.pending };
      delete next[key];
      return { pending: next };
    }),
}));
