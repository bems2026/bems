import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRetrySchedule } from './retrySchedule';
import { nextPollDelayMs } from '@/lib/bridgeClient';

describe('createRetrySchedule', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('uses the shared backoff curve, growing with each consecutive failure', () => {
    // Asserted against nextPollDelayMs itself rather than hardcoded milliseconds, so this
    // test tracks the real curve instead of a snapshot of it.
    const schedule = createRetrySchedule();
    const fn = vi.fn();

    schedule.retryAfterFailure(fn);
    vi.advanceTimersByTime(nextPollDelayMs(1) - 1);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);

    // Second consecutive failure waits strictly longer than the first.
    const second = vi.fn();
    schedule.retryAfterFailure(second);
    vi.advanceTimersByTime(nextPollDelayMs(1));
    expect(second).not.toHaveBeenCalled();
    vi.advanceTimersByTime(nextPollDelayMs(2) - nextPollDelayMs(1));
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('resets the backoff after a success, so a later blip retries at the first delay again', () => {
    const schedule = createRetrySchedule();
    schedule.retryAfterFailure(vi.fn());
    schedule.retryAfterFailure(vi.fn());
    schedule.retryAfterFailure(vi.fn());
    schedule.succeeded();

    const fast = vi.fn();
    schedule.retryAfterFailure(fast);
    vi.advanceTimersByTime(nextPollDelayMs(1));
    expect(fast).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending retry, so a fresh load supersedes an in-flight backoff', () => {
    const schedule = createRetrySchedule();
    const fn = vi.fn();
    schedule.retryAfterFailure(fn);
    schedule.cancel();
    vi.advanceTimersByTime(300_000);
    expect(fn).not.toHaveBeenCalled();
  });

  it('never leaves two timers running for one schedule', () => {
    // Each store owns one schedule; a second call must replace the pending timer, not race
    // it. Two live timers would double the poll rate for as long as both survived.
    const schedule = createRetrySchedule();
    const fn = vi.fn();
    schedule.retryAfterFailure(fn);
    schedule.retryAfterFailure(fn);
    vi.advanceTimersByTime(300_000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('schedules a steady-state poll at a fixed delay, unaffected by past failures', () => {
    // anomaliesStore polls forever on success; that cadence is not a backoff.
    const schedule = createRetrySchedule();
    const fn = vi.fn();
    schedule.retryAfterFailure(vi.fn());
    schedule.succeeded();
    schedule.scheduleNext(fn, 60_000);

    vi.advanceTimersByTime(59_999);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives each store its own independent schedule', () => {
    // These were four sets of module-level variables; they must not become one shared one.
    const a = createRetrySchedule();
    const b = createRetrySchedule();
    const fnA = vi.fn();
    const fnB = vi.fn();

    a.retryAfterFailure(fnA);
    b.scheduleNext(fnB, 1_000);
    a.cancel();

    vi.advanceTimersByTime(300_000);
    expect(fnA).not.toHaveBeenCalled();
    expect(fnB).toHaveBeenCalledTimes(1);
  });
});
