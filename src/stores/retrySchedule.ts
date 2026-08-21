import { nextPollDelayMs } from '@/lib/bridgeClient';

/**
 * The retry bookkeeping four stores were each keeping by hand.
 *
 * `contextStore`, `capabilitiesStore`, `deviceConfigStore` and `anomaliesStore` all held the
 * same two module-level variables and the same catch block:
 *
 *     let loadAttempt = 0;
 *     let loadRetryTimer: ReturnType<typeof setTimeout> | null = null;
 *     ...
 *     loadAttempt = 0;                                             // on success
 *     loadAttempt++;                                               // on failure
 *     loadRetryTimer = setTimeout(attempt, nextPollDelayMs(loadAttempt));
 *
 * Four hand-copies of one small state machine, each free to drift from the others.
 *
 * Deliberately NOT a "pollable Supabase resource" store factory. The four `load()` bodies
 * differ in what they fetch, what they set, whether an unconfigured Supabase is an error or
 * an empty success, and whether they keep polling afterwards — an abstraction covering all
 * of that would be about as long as the code it replaced and considerably harder to read.
 * What is genuinely identical is the timer and the attempt counter, so that is all this
 * takes over.
 */
export interface RetrySchedule {
  /** Cancel any pending retry. Called at the top of `load()` so a fresh call supersedes an
   * in-flight backoff rather than racing it. */
  cancel(): void;
  /** Reset the backoff after a successful fetch. */
  succeeded(): void;
  /** Schedule `fn` after the next backoff delay, growing with each consecutive failure. */
  retryAfterFailure(fn: () => void): void;
  /** Schedule `fn` at a fixed delay — a steady-state poll, not a retry. */
  scheduleNext(fn: () => void, delayMs: number): void;
}

export function createRetrySchedule(): RetrySchedule {
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    cancel: clear,
    succeeded() {
      attempt = 0;
    },
    retryAfterFailure(fn) {
      clear();
      attempt++;
      timer = setTimeout(fn, nextPollDelayMs(attempt));
    },
    scheduleNext(fn, delayMs) {
      clear();
      timer = setTimeout(fn, delayMs);
    },
  };
}
