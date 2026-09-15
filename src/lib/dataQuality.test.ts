import { describe, it, expect } from 'vitest';
import { formatAge, qualityTag, staleNote, syncSummary, tooltipTime, type SyncStatus } from './dataQuality';

/*
 * RM-076 — the words a chart uses about a point and about its data.
 *
 * Operator request, 2026-09-15, on the live page: remove "Average of 11 of 11 samples" and make it
 * "simple and understandable. Minimalist." So a point gets a tag of a word or two, and only when it
 * is not a plain reading; the same words are used on the badge above the chart.
 */

const NOW = Date.parse('2026-09-14T16:31:30+08:00');
const fresh: SyncStatus = { settled: true, fetchedAt: NOW - 30_000, failures: 0, lastError: null, refetchMs: 60_000, source: 'bridge' };

describe('qualityTag', () => {
  it('says nothing about a plain reading, whether or not it is an average', () => {
    expect(qualityTag({ quality: 'measured' })).toBeNull();
    expect(qualityTag({ quality: 'measured', samples: 11, of: 11 })).toBeNull();
  });

  it('names everything else in a word or two', () => {
    expect(qualityTag({ quality: 'interpolated' })).toBe('Estimated');
    expect(qualityTag({ quality: 'frozen' })).toBe('Frozen');
    expect(qualityTag({ quality: 'offline' })).toBe('Offline');
    expect(qualityTag({ quality: 'missing' })).toBe('No data');
    expect(qualityTag({ quality: 'outlier' })).toBe('Bad reading');
    expect(qualityTag({ quality: 'live' })).toBe('Live');
  });
});

describe('tooltipTime', () => {
  const t = Date.parse('2026-09-14T22:40:00+08:00');

  it('gives the day and the minute for a one-minute point', () => {
    expect(tooltipTime(t, 60_000)).toBe('Sep 14 · 22:40');
  });

  it('gives the span when a point stands for more than a minute', () => {
    expect(tooltipTime(t, 11 * 60_000)).toBe('Sep 14 · 22:40–22:51');
  });
});

describe('staleNote', () => {
  it('says nothing while the history is current', () => {
    expect(staleNote(fresh, NOW)).toBeNull();
  });

  it('says how old the data is once it has stopped arriving', () => {
    expect(staleNote({ ...fresh, fetchedAt: NOW - 300_000, failures: 2 }, NOW)).toBe('Cached · 5 min old');
  });

  it('says nothing when nothing has arrived yet — the badge already says that', () => {
    expect(staleNote({ ...fresh, fetchedAt: null, settled: false }, NOW)).toBeNull();
  });
});

describe('formatAge', () => {
  it('reads naturally at every scale a sync age reaches', () => {
    expect(formatAge(45_000)).toBe('45 s');
    expect(formatAge(180_000)).toBe('3 min');
    expect(formatAge(150_000)).toBe('2 min');
    expect(formatAge(3_900_000)).toBe('1 h 5 min');
  });
});

describe('syncSummary', () => {
  it('says syncing before the first answer for this range has arrived', () => {
    expect(syncSummary({ ...fresh, settled: false, fetchedAt: null }, 'connected', NOW)).toMatchObject({ tone: 'accent', text: 'Syncing…' });
  });

  it('says live while the last fetch is recent and the live feed is open', () => {
    expect(syncSummary(fresh, 'connected', NOW)).toMatchObject({ tone: 'good', text: 'Live' });
  });

  it('says cached, with its age, once fetches have been failing — and says why', () => {
    const summary = syncSummary({ ...fresh, fetchedAt: NOW - 180_000, failures: 2, lastError: 'bridge unreachable' }, 'connected', NOW);
    expect(summary).toMatchObject({ tone: 'warn', text: 'Cached · 3 min old' });
    expect(summary.detail).toContain('bridge unreachable');
  });

  it('says cached once the last fetch is older than two intervals, even with no failure recorded', () => {
    expect(syncSummary({ ...fresh, fetchedAt: NOW - 150_000 }, 'connected', NOW)).toMatchObject({ tone: 'warn', text: 'Cached · 2 min old' });
  });

  it('says history is unavailable when nothing has ever arrived', () => {
    expect(syncSummary({ ...fresh, fetchedAt: null, failures: 3, lastError: 'timed out' }, 'connected', NOW)).toMatchObject({ tone: 'bad', text: 'History unavailable' });
  });

  it('calls a stored range up to date without needing the live feed', () => {
    expect(syncSummary({ ...fresh, source: 'stored', refetchMs: 300_000, fetchedAt: NOW - 60_000 }, 'offline', NOW)).toMatchObject({ tone: 'good', text: 'Up to date' });
  });

  it('flags fresh bridge history whose live feed is down, since the chart tail cannot follow it', () => {
    expect(syncSummary(fresh, 'reconnecting', NOW)).toMatchObject({ tone: 'warn', text: 'Live feed reconnecting' });
  });
});
