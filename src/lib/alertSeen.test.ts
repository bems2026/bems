import { describe, it, expect, afterEach, vi } from 'vitest';
import { readSeen, writeSeen, isSeen, SEEN_KEEP_MS, LIVE_SEEN_MS } from './alertSeen';

/**
 * RM-152. "Ack" was forgotten on every reload, so on the kiosk nothing marked ever stayed marked.
 * What is remembered is per browser, by the operator's choice, and it must never break the bell.
 */

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

const NOW = Date.parse('2026-09-30T05:38:00Z');

describe('alertSeen', () => {
  it('remembers a mark across reads, which is across reloads', () => {
    writeSeen({ 'trouble:power_warn:mtr_co_yellow': { stamp: '2026-09-23T00:01:00Z', at: NOW } });
    expect(readSeen(NOW)).toEqual({ 'trouble:power_warn:mtr_co_yellow': { stamp: '2026-09-23T00:01:00Z', at: NOW } });
  });

  it('holds only for the episode it was given: a new episode is news again', () => {
    const map = { 'trouble:power_warn:mtr_co_yellow': { stamp: '2026-09-23T00:01:00Z', at: NOW } };
    expect(isSeen(map, 'trouble:power_warn:mtr_co_yellow', '2026-09-23T00:01:00Z', NOW)).toBe(true);
    expect(isSeen(map, 'trouble:power_warn:mtr_co_yellow', '2026-09-30T01:00:00Z', NOW)).toBe(false);
  });

  it('a live-state mark expires, so a problem that lasts comes back', () => {
    const map = { co3: { stamp: 'live', at: NOW } };
    expect(isSeen(map, 'co3', 'live', NOW + LIVE_SEEN_MS - 1, LIVE_SEEN_MS)).toBe(true);
    expect(isSeen(map, 'co3', 'live', NOW + LIVE_SEEN_MS, LIVE_SEEN_MS)).toBe(false);
  });

  it('forgets marks older than it could ever need', () => {
    writeSeen({ old: { stamp: 'x', at: NOW - SEEN_KEEP_MS - 1 }, fresh: { stamp: 'y', at: NOW } });
    expect(Object.keys(readSeen(NOW))).toEqual(['fresh']);
  });

  it('storage that refuses, or holds rubbish, costs the memory and never the bell', () => {
    window.localStorage.setItem('ibems.alerts.seen.v1', '{not json');
    expect(readSeen(NOW)).toEqual({});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => writeSeen({ a: { stamp: 's', at: NOW } })).not.toThrow();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(readSeen(NOW)).toEqual({});
  });
});
