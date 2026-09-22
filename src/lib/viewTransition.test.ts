import { describe, it, expect, vi } from 'vitest';
import { withViewTransition } from './viewTransition';

/**
 * RM-140. Changing the period or the reading swapped the page in one frame. Where the browser has View
 * Transitions it now crossfades; everywhere else, and for a reader who asked for less motion, the change
 * happens exactly as it did — once, synchronously, with nothing in between.
 */

const still = (reduce: boolean) => (query: string) => ({ matches: reduce && query.includes('reduce') }) as MediaQueryList;

describe('withViewTransition', () => {
  it('crossfades where the browser can', () => {
    const update = vi.fn();
    const start = vi.fn((cb: () => void) => {
      cb();
      return { ready: Promise.resolve(), finished: Promise.resolve(), updateCallbackDone: Promise.resolve() };
    });
    withViewTransition(update, { startViewTransition: start }, still(false));
    expect(start).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('just makes the change where the browser cannot', () => {
    const update = vi.fn();
    withViewTransition(update, {}, still(false));
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('just makes the change for a reader who asked for less motion', () => {
    const update = vi.fn();
    const start = vi.fn();
    withViewTransition(update, { startViewTransition: start }, still(true));
    expect(start).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('does not leave a skipped transition rejecting where nobody listens', async () => {
    // A hidden tab skips the transition and rejects `ready`: unheard, that is an error in the console of
    // a kiosk nobody is watching.
    const ready = Promise.reject(new DOMException('Skipped', 'InvalidStateError'));
    const start = vi.fn((cb: () => void) => {
      cb();
      return { ready, finished: Promise.resolve(), updateCallbackDone: Promise.resolve() };
    });
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    withViewTransition(() => {}, { startViewTransition: start }, still(false));
    await new Promise((r) => setTimeout(r, 0));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
