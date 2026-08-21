import { useSyncExternalStore } from 'react';

/**
 * One wall-clock tick for the whole app.
 *
 * Five components independently ran their own `setInterval(…, 1000)` to notice that time
 * had passed — `OverviewPage`'s Clock, `LiveDemandCard`, `TopNav`, `AlertsPopover`, and
 * `StaleDataBadge`, the last of which is mounted once per device or socket it renders, so
 * the Control page alone carried a dozen or more. Four of the five carried a comment saying
 * "same pattern as X" without the pattern ever being shared.
 *
 * They are all correct — every interval is cleaned up — but they are all separate, so they
 * fire out of phase with each other and each schedules its own React render. On a kiosk that
 * runs unattended and is never restarted, that is a permanent floor of timer-driven renders
 * under a display nobody is looking at.
 *
 * One module-level interval, refcounted: it starts when the first component subscribes and
 * stops when the last unsubscribes, so nothing ticks on a page that needs no clock. Every
 * subscriber now updates on the SAME tick, which lets React batch them into one render pass
 * instead of a dozen staggered ones.
 *
 * `useSyncExternalStore` rather than a store or context because that is exactly what this
 * is: an external mutable source React needs a consistent read of. It also gets the
 * subscribe/unsubscribe lifecycle right without an effect.
 */

/** Staleness thresholds in this app are whole seconds (`staleness.ts`'s 30s), so a
 * one-second resolution is the coarsest tick that can still show a transition on time. */
const TICK_MS = 1000;

let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const subscribers = new Set<() => void>();

function subscribe(onStoreChange: () => void): () => void {
  subscribers.add(onStoreChange);
  if (timer === null) {
    timer = setInterval(() => {
      now = Date.now();
      for (const notify of subscribers) notify();
    }, TICK_MS);
  }
  return () => {
    subscribers.delete(onStoreChange);
    if (subscribers.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** `now` only changes on a tick, so this is a stable reference between renders — which is
 * what `useSyncExternalStore` requires to avoid an infinite re-render loop. */
const getSnapshot = () => now;

/**
 * Re-renders the calling component once a second and returns the current epoch milliseconds.
 *
 * Use it wherever a value depends on elapsed time rather than on a store write — staleness,
 * countdowns, clocks. A component that only reflects store data does not need it.
 */
export function useNowTick(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Test-only: drop every subscriber and stop the timer, so one test's mounted components
 * cannot leave a live interval running into the next. */
export function __resetNowTickForTests(): void {
  subscribers.clear();
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}
