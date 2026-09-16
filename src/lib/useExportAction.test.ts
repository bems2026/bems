import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useExportAction } from './useExportAction';

/**
 * RM-083b. An export is the one action on the Reports page that takes long enough to be pressed
 * twice — the PDF renders on the kiosk's Pi — and the old button's busy state was React state, which
 * two clicks in the same tick can both read as "not busy". Its scenes were also built synchronously
 * before its first `await`, so "Building PDF…" could not paint until the work it announced was done.
 */

const noWait = { yieldFrame: () => Promise.resolve() };

describe('useExportAction', () => {
  it('runs once, however many times it is pressed while the first is still working', async () => {
    let finish!: (message: string) => void;
    const run = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useExportAction(run, noWait));

    await act(async () => {
      result.current.start();
      result.current.start();
      result.current.start();
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(result.current.state.status).toBe('working');

    await act(async () => finish('PDF saved'));
    expect(result.current.state).toEqual({ status: 'done', message: 'PDF saved' });
  });

  it('shows that it is working before the heavy work starts, so the state can paint', async () => {
    let release!: () => void;
    const yieldFrame = () => new Promise<void>((resolve) => { release = resolve; });
    const run = vi.fn(async () => 'done');
    const { result } = renderHook(() => useExportAction(run, { yieldFrame }));

    act(() => result.current.start());
    expect(result.current.state.status).toBe('working');
    expect(run).not.toHaveBeenCalled();

    await act(async () => release());
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('says what went wrong in words, and can be tried again', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('the PDF library could not be loaded')).mockResolvedValueOnce('PDF saved');
    const { result } = renderHook(() => useExportAction(run, noWait));

    await act(async () => result.current.start());
    expect(result.current.state).toEqual({ status: 'error', message: 'the PDF library could not be loaded' });

    await act(async () => result.current.start());
    expect(result.current.state).toEqual({ status: 'done', message: 'PDF saved' });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('can be run again once the last export has finished', async () => {
    const run = vi.fn(async () => 'CSV saved');
    const { result } = renderHook(() => useExportAction(run, noWait));
    await act(async () => result.current.start());
    await act(async () => result.current.start());
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('reports a long export’s progress while it works — RM-098', async () => {
    let finish!: (message: string) => void;
    let report!: (progress: string) => void;
    const run = vi.fn((r: (progress: string) => void) => {
      report = r;
      return new Promise<string>((resolve) => { finish = resolve; });
    });
    const { result } = renderHook(() => useExportAction(run, noWait));
    await act(async () => result.current.start());
    act(() => report('12,400 readings so far'));
    expect(result.current.state).toEqual({ status: 'working', progress: '12,400 readings so far' });
    await act(async () => finish('Saved'));
    expect(result.current.state).toEqual({ status: 'done', message: 'Saved' });
  });

  it('stops when cancelled, says nothing was saved, and can be run again', async () => {
    const run = vi.fn(
      (_report: (progress: string) => void, signal: AbortSignal) =>
        new Promise<string>((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    );
    const { result } = renderHook(() => useExportAction(run, noWait));
    await act(async () => result.current.start());
    await act(async () => result.current.cancel());
    expect(result.current.state).toEqual({ status: 'error', message: 'Cancelled — nothing was saved.' });
    await act(async () => result.current.start());
    expect(run).toHaveBeenCalledTimes(2);
  });
});
