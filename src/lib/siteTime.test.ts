import { describe, it, expect, vi, afterEach } from 'vitest';
import { siteTime, siteTimeShort, siteDate, siteDateTime, isSiteToday } from './siteTime';

/**
 * Every assertion here uses an ABSOLUTE instant and a site pinned to `Asia/Manila` (+08), so the
 * expected string is the same on this +08 workstation and on a UTC runner. A test written in
 * local time would pass in one and fail in the other — which is RM-022's scar, and is precisely
 * how the bug these helpers exist for stayed invisible: the old tests set the clock with a bare
 * local string, so the test and the code under it shifted together.
 */
vi.mock('@shared/siteConfig.mjs', () => ({
  SITE: { id: 'test', display_name: 'Test', timezone: 'Asia/Manila', utc_offset_minutes: 480, scene_pack: null, location: null, policy: {} },
}));

afterEach(() => vi.useRealTimers());

/** 2026-08-12T14:00:00Z is 22:00 on the 12th in Manila — a different clock time AND, for a
 * reader far enough west, a different date. Both halves matter. */
const INSTANT = Date.parse('2026-08-12T14:00:00Z');

describe('a moment that belongs to the building', () => {
  it('renders the building clock, not the runtime one', () => {
    expect(siteTime(INSTANT)).toBe('22:00:00');
  });

  it('renders the short form charts and logs use', () => {
    expect(siteTimeShort(INSTANT)).toBe('22:00');
  });

  it('renders the building calendar day', () => {
    // 14:00Z is the 12th in Manila and still the 12th in London — but the 12th at 10:00 in New
    // York, and the 13th at 02:00 in Auckland. The site is the only frame that is stable.
    expect(siteDate(INSTANT, { month: 'short', day: 'numeric' })).toBe('Aug 12');
  });

  it('renders date and time together', () => {
    expect(siteDateTime(INSTANT)).toContain('22:00:00');
  });

  it('accepts the shapes the call sites actually hold', () => {
    // Readings carry an ISO string, charts carry epoch ms, and a few places already have a Date.
    expect(siteTime(new Date(INSTANT))).toBe('22:00:00');
    expect(siteTime('2026-08-12T14:00:00Z')).toBe('22:00:00');
  });
});

describe('isSiteToday', () => {
  it('compares against the building day, not the reader day', () => {
    // 2026-08-12T20:00Z is already the 13th in Manila (04:00). A reader in London would call it
    // the 12th, and a forecast strip would then label the building's tomorrow "Today".
    const lateInLondon = Date.parse('2026-08-12T20:00:00Z');
    expect(isSiteToday(Date.parse('2026-08-13T00:00:00Z'), lateInLondon)).toBe(true);
    expect(isSiteToday(Date.parse('2026-08-12T02:00:00Z'), lateInLondon)).toBe(false);
  });

  it('defaults to now', () => {
    vi.useFakeTimers();
    vi.setSystemTime(INSTANT);
    expect(isSiteToday(INSTANT)).toBe(true);
  });
});
