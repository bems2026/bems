import { describe, it, expect } from 'vitest';
import { nextPollDelayMs, isStale } from './bridgeClient';
import { TIMING } from './timing';

describe('nextPollDelayMs', () => {
  it('polls every 15s while healthy', () => {
    expect(nextPollDelayMs(0)).toBe(15_000);
  });

  it('doubles per consecutive failure: 30, 60, 120s', () => {
    expect(nextPollDelayMs(1)).toBe(30_000);
    expect(nextPollDelayMs(2)).toBe(60_000);
    expect(nextPollDelayMs(3)).toBe(120_000);
  });

  it('caps at 120s and stays there beyond 4 failures', () => {
    expect(nextPollDelayMs(4)).toBe(120_000);
    expect(nextPollDelayMs(5)).toBe(120_000);
    expect(nextPollDelayMs(100)).toBe(TIMING.BACKOFF_CAP_MS);
  });

  it('treats negative input the same as healthy (defensive, should never occur)', () => {
    expect(nextPollDelayMs(-1)).toBe(15_000);
  });
});

describe('isStale', () => {
  const now = 1_786_000_000_000;

  it('is stale with no prior update', () => {
    expect(isStale(null, now)).toBe(true);
  });

  it('is not stale just under the 30s threshold', () => {
    expect(isStale(now - 29_999, now)).toBe(false);
  });

  it('is stale exactly at and beyond the 30s threshold', () => {
    expect(isStale(now - 30_000, now)).toBe(false); // strictly greater-than, not >=
    expect(isStale(now - 30_001, now)).toBe(true);
  });

  it('is not stale for a reading from the future (clock skew tolerance)', () => {
    expect(isStale(now + 5_000, now)).toBe(false);
  });
});
