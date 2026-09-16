import { useCallback, useRef, useState } from 'react';

/**
 * Running an export once, visibly, and saying what happened — RM-083b.
 *
 * TWO DEFECTS IN THE BUTTON THIS REPLACES. Its busy flag was React state, and two clicks in the same
 * tick both read it as "not busy" before either re-render landed; `download.ts` de-duplicated the
 * pdfmake call, but both clicks still built every scene. And the scenes were built synchronously
 * before its first `await`, so "Building PDF…" could not paint until the work it announced was done
 * — on the kiosk's Pi, a frozen button that looks like a button that did nothing.
 *
 * So the guard is a ref, set synchronously on the first press, and the work waits for the next paint
 * before it starts. The outcome comes back as words: what was saved, or what went wrong.
 */

export type ExportState =
  | { status: 'idle' }
  /** `progress` — RM-098: what a long export has done so far, in words ("12,400 readings…"). */
  | { status: 'working'; progress?: string }
  | { status: 'done'; message: string }
  | { status: 'error'; message: string };

export interface ExportActionOptions {
  /** Resolves once the working state has had a chance to paint. Replaced in tests. */
  yieldFrame?: () => Promise<void>;
}

/**
 * After a frame and a task, so the working state is on screen before the work begins. Races a short
 * timeout, because a hidden tab or a test environment may never deliver a frame at all — and an export
 * that waits forever for a paint nobody will see is worse than one that starts slightly early.
 */
export function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(finish, 0));
    setTimeout(finish, 50);
  });
}

/**
 * RM-098: an export that takes a while — every reading of a month is hundreds of requests — reports its
 * progress through `report` and stops when `signal` is aborted by `cancel`. A short export ignores both.
 */
export type ExportRun = (report: (progress: string) => void, signal: AbortSignal) => Promise<string>;

export function useExportAction(run: ExportRun, { yieldFrame = nextPaint }: ExportActionOptions = {}) {
  const [state, setState] = useState<ExportState>({ status: 'idle' });
  const busy = useRef(false);
  const controller = useRef<AbortController | null>(null);

  const start = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    const abort = new AbortController();
    controller.current = abort;
    setState({ status: 'working' });
    void (async () => {
      try {
        await yieldFrame();
        const message = await run((progress) => {
          if (!abort.signal.aborted) setState({ status: 'working', progress });
        }, abort.signal);
        setState({ status: 'done', message });
      } catch (err) {
        // Surfaced, never swallowed: a press that silently does nothing on a kiosk gets pressed again.
        setState(
          abort.signal.aborted
            ? { status: 'error', message: 'Cancelled — nothing was saved.' }
            : { status: 'error', message: err instanceof Error ? err.message : String(err) }
        );
      } finally {
        busy.current = false;
        controller.current = null;
      }
    })();
  }, [run, yieldFrame]);

  const cancel = useCallback(() => controller.current?.abort(), []);

  return { state, start, cancel };
}
