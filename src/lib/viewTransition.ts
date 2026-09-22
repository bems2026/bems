import { flushSync } from 'react-dom';

/**
 * A change the reader asked for, drawn as a short crossfade where the browser can — RM-140.
 *
 * Choosing another period or another reading of it swapped the page in one frame: the heading, the
 * figures and the charts all changed at once, with nothing to say they had. The native View Transitions
 * API crossfades the old page into the new while the control bar, which has its own
 * `view-transition-name`, stays put. No library: the browser draws it, and one without the API simply
 * makes the change as before.
 *
 * NOT FOR A READER WHO ASKED FOR LESS MOTION. The stylesheet's global `prefers-reduced-motion` rule zeroes
 * animations on `*`, and `*` does not reach the `::view-transition-*` pseudo-elements — so this checks the
 * preference itself, and `index.css` names those pseudo-elements in the same block as well.
 *
 * `flushSync`, because the browser snapshots the new page when the callback returns: a React update left
 * to its own schedule would be snapshotted before it rendered, and the crossfade would be from the old
 * page to itself.
 */

interface ViewTransitionLike {
  ready?: Promise<unknown>;
  finished?: Promise<unknown>;
  updateCallbackDone?: Promise<unknown>;
}

interface TransitionDocument {
  startViewTransition?: (update: () => void) => ViewTransitionLike | void;
}

const ignore = () => {};

/**
 * The browser runs a transition's update at its next frame. Shown but not painting — measured in the app's
 * own browser pane, 2026-09-22 — that frame came seconds later, and a tab click did nothing until it did.
 * Past the 180 ms fade, the change is made directly; the transition's own call, if it comes, finds it done.
 */
const FALLBACK_MS = 300;

export function withViewTransition(
  update: () => void,
  doc: TransitionDocument = document as unknown as TransitionDocument,
  media: ((query: string) => MediaQueryList) | undefined = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia.bind(window) : undefined
): void {
  const start = doc.startViewTransition;
  const lessMotion = media?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (typeof start !== 'function' || lessMotion) {
    update();
    return;
  }
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    update();
  };
  const transition = start.call(doc, () => flushSync(once));
  setTimeout(once, FALLBACK_MS);
  // A hidden tab skips the transition and rejects these; unheard, each is an error in the console of a
  // kiosk nobody is watching. The update itself has still run.
  transition?.ready?.catch(ignore);
  transition?.finished?.catch(ignore);
  transition?.updateCallbackDone?.catch(ignore);
}
