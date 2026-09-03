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

/**
 * How many commands may be on the wire at once — FI-024.
 *
 * WHAT THIS IS NOT FOR. The original suspicion was device socket contention: the outlet master
 * actions fire both sockets of one physical device in the same instant, and a Tuya device accepts
 * one inbound session. That turns out to be handled a layer down — `tuyapi` serialises per device
 * already (`index.js:410`, *"Queue this request and limit concurrent set requests to one"*), so
 * there was never a race at the socket.
 *
 * WHAT IT IS FOR. The cost is on the proxy side and in the browser. Every command independently
 * writes an audit row BEFORE anything is dispatched — record-then-act, `auditedDispatch.mjs` —
 * with a 5 s timeout against Supabase, and the browser abandons its own request after
 * `COMMAND_TIMEOUT_MS`, also 5 s. Fourteen at once against a Pi makes a client-side timeout
 * likely, and a timed-out command is shown to the operator as FAILED while the relay may well
 * have moved. This project has twice been burned by a command that worked being reported as one
 * that did not; a burst that manufactures that report is worth bounding.
 *
 * Four, not one: fourteen commands still drain in four rounds, so all-off stays a prompt action
 * rather than a visibly serial one. A single click never waits — it acquires immediately.
 */
export const MAX_COMMANDS_IN_FLIGHT = 4;

let inFlight = 0;
const waiting: Array<() => void> = [];

function releaseSlot(): void {
  inFlight -= 1;
  waiting.shift()?.();
}

/**
 * Clears the queue between tests.
 *
 * The counter is module state and outlives `useCommandStore.setState`, so one test that leaves a
 * command in flight otherwise shrinks the cap for every test after it — which is exactly how this
 * was found: nine unrelated tests began timing out at once.
 */
export function resetCommandQueueForTests(): void {
  inFlight = 0;
  waiting.length = 0;
}

function newCommandId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Readable reason for a rejected command.
 *
 * WHAT WAS WRONG WITH THE PREVIOUS VERSION. It branched on `err.status` alone and ignored the
 * `code` the proxy already sent, so every 502 rendered as "The bridge did not accept the command
 * (502)." A refusal meaning "the bridge has no connection to THIS DEVICE" — a fact about one
 * socket, with a remedy at that socket — was therefore indistinguishable from the bridge being
 * down. A physical test on 2026-08-31 reported it as "bridge not reachable" while the bridge was
 * serving readings throughout, and the diagnosis went the wrong way for a fortnight.
 *
 * Naming the failure is the entire value of the message. A sentence that describes the wrong
 * subsystem is worse than no sentence, because it gets acted on.
 *
 * These are the proxy's own codes (`server/proxy.mjs`'s `handleCommand`), which come in turn
 * from `dispatchCommand`'s `reason`. Codes that are diagnostics rather than device facts —
 * `invalid_socket` and friends from the 400/404 validation path — are still summarised rather
 * than shown raw: those are bugs in this UI, and the operator can do nothing with the string.
 */
const FAILURE_COPY: Record<string, string> = {
  device_offline: 'This device is offline — the bridge has no connection to it, so the command could not reach it. It was still logged.',
  bridge_unreachable: 'The bridge could not be reached, so the command was not delivered. It was still logged.',
  bridge_rejected: 'The bridge refused the command. It was logged; check the bridge token and the flow.',
  no_dispatch_route: 'This deployment cannot command a device of this kind.',
  audit_log_unreachable: 'Nothing was sent: the audit trail could not be written, and this system will not move a relay it cannot record.',
  break_glass_cannot_command: 'Local sign-in is view-only. Sign in with your account to send commands.',
};

export function describeFailure(err: unknown): string {
  if (err instanceof BridgeFetchError) {
    if (err.code && FAILURE_COPY[err.code]) return FAILURE_COPY[err.code];
    const misconfigured = err.status === 400 || err.status === 404;
    if (misconfigured) return 'This control is misconfigured — the bridge rejected it.';
    // No code, or one this build has not heard of. Say only what is actually known — that the
    // command was refused — rather than naming a subsystem on no evidence.
    return `The command was not accepted (${err.status ?? 'no response'}).`;
  }
  return 'The command could not be sent.';
}

interface CommandState {
  pending: Record<string, PendingCommand>;
  /**
   * device id -> when a command for it last succeeded ONLY through the vendor cloud.
   *
   * A cloud recovery is a success the operator reads as unremarkable, while meaning the device
   * has stopped answering on the LAN — the earliest warning this system has that a device is
   * going bad. Kept here rather than in the session command log because a store must not
   * import upwards from `components/control`, and because the alerts bell already reads
   * stores and owns acknowledgement.
   */
  cloudRecoveries: Record<string, number>;
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
  cloudRecoveries: {},

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

    const dispatch = async (): Promise<void> => {
      try {
      // Superseded while it sat in the queue — all-off then all-on, say. Before there was a queue
      // this could not happen, because everything was already on the wire. Sending it now would
      // put a command the operator has replaced onto the hardware, behind the one they meant.
      if (get().pending[key]?.command_id !== command_id) return;

      // `issuedAt` is re-stamped HERE rather than left at queue time, and that is load-bearing:
      // `reconcile`'s 30 s leak guard measures from it to decide a command never reached the
      // bridge, and `reportedSince` compares a reading's timestamp against it. Both mean "when
      // this was dispatched". Stamping at queue time would let the queue manufacture the very
      // false failure this cap exists to prevent.
      set((s) => (s.pending[key]?.command_id === command_id
        ? { pending: { ...s.pending, [key]: { ...s.pending[key], issuedAt: Date.now() } } }
        : s));

      const ack = await sendCommand({ device_id: deviceId, socket, action: desired, command_id, ...(targetC === undefined ? {} : { target_c: targetC }) });
      // Only 'cloud' is recorded. 'local' is the ordinary case and would be noise; null is a
      // dry run, where no path was attempted at all; a missing field is an older bridge.
      if (ack?.via === 'cloud') {
        set((s) => ({ cloudRecoveries: { ...s.cloudRecoveries, [deviceId]: Date.now() } }));
      }
      // A newer command for this same target superseded us while this one was in flight —
      // let that one own the pending entry instead of clobbering it with a stale ack.
      if (get().pending[key]?.command_id !== command_id) return;
      set((s) => ({ pending: { ...s.pending, [key]: { ...s.pending[key], phase: 'confirming', ackedAt: Date.now() } } }));
    } catch (err) {
      if (get().pending[key]?.command_id !== command_id) return;
      set((s) => ({ pending: { ...s.pending, [key]: { ...s.pending[key], phase: 'failed', error: describeFailure(err) } } }));
      } finally {
        // In `finally` so a superseded early-return, a rejection and a success all give the slot
        // back. Leaking one would shrink the cap permanently, and leaking four would wedge every
        // later command in this tab until a reload.
        releaseSlot();
      }
    };

    // THE UNCONTENDED PATH MUST NOT DEFER. A single click has to reach `sendCommand` in the same
    // tick it always did: awaiting even an already-resolved promise costs a microtask, and nine
    // ControlPage tests assert the call happens synchronously on click — which is not test
    // pedantry, it is the guarantee that one command behaves exactly as it did before this cap
    // existed. Only a genuinely contended command waits.
    if (inFlight < MAX_COMMANDS_IN_FLIGHT) {
      inFlight += 1;
      return dispatch();
    }
    await new Promise<void>((resolve) => {
      waiting.push(() => { inFlight += 1; resolve(); });
    });
    return dispatch();
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
        //
        // Two different facts used to share one message. "The device did not report the new
        // state" claims the device ANSWERED and contradicted the command — a claim only
        // available when the reading actually postdates the command. When the row is older
        // than `issuedAt`, nothing has been heard either way and the relay may well have
        // moved; saying otherwise sends someone to check hardware that is fine. This is the
        // ordinary case for a device polled once a minute, so it was not a rare wording nit.
        const reportedSince = Date.parse(row.ts) >= p.issuedAt;
        next[key] = {
          ...p,
          phase: 'failed',
          error: reportedSince
            ? 'The device did not report the new state.'
            : 'The device has not reported since the command was sent, so whether it landed is unknown.',
        };
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
