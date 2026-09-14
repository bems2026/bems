import { describe, it, expect } from 'vitest';
import { describeSlot, formatAge, formatRawValue, sourceLabel, syncSummary, type SyncStatus } from './dataQuality';

/*
 * RM-076 — the words a chart uses to say what a point is. Pure, so the tooltip and the badge can
 * stay thin components and these sentences are pinned in one place.
 */

const NOW = Date.parse('2026-09-14T16:31:30+08:00');

describe('formatRawValue', () => {
  it('shows what the device carried at full precision, with its unit', () => {
    expect(formatRawValue(15.7, 'power')).toBe('15.7 W');
    expect(formatRawValue(228.25, 'voltage')).toBe('228.25 V');
    expect(formatRawValue(0.576, 'current')).toBe('0.576 A');
    expect(formatRawValue(1_000_000_000, 'power')).toBe('1000000000 W');
  });
});

describe('describeSlot', () => {
  it('says a bridged minute was bridged, and what the device itself carried', () => {
    expect(describeSlot({ quality: 'interpolated', imputedFrom: 'offline', raw: 15.7 }, 'power')).toBe(
      'Interpolated across a brief offline flicker (the device carried 15.7 W)',
    );
    expect(describeSlot({ quality: 'interpolated', imputedFrom: 'missing' }, 'power')).toBe('Interpolated across a missed sample');
  });

  it('names a rejected reading with the value it was rejected for', () => {
    expect(describeSlot({ quality: 'interpolated', imputedFrom: 'outlier', raw: 1e9 }, 'power')).toBe('Interpolated over a rejected reading of 1000000000 W');
    expect(describeSlot({ quality: 'outlier', raw: -5 }, 'power')).toBe('Rejected: -5 W is outside what this site can measure');
  });

  it('calls a frozen reading frozen, never measured', () => {
    expect(describeSlot({ quality: 'frozen', raw: 19.1 }, 'power')).toBe('Frozen: the meter repeated 19.1 W unchanged, so this is not a measurement');
  });

  it('says how much of an averaged point was measured', () => {
    expect(describeSlot({ quality: 'measured', samples: 22, of: 24 }, 'power')).toBe('Average of 22 of 24 samples');
    expect(describeSlot({ quality: 'measured', raw: 402.1 }, 'power')).toBe('Measured');
  });

  it('says how much of a stored bucket was online', () => {
    expect(describeSlot({ quality: 'measured', raw: 120, coverage: { online: 12, samples: 15 } }, 'power')).toBe('Stored average of 12 of 15 samples online');
  });

  it('names offline, missing and live for what they are', () => {
    expect(describeSlot({ quality: 'offline', raw: 513.9 }, 'power')).toBe('Offline: the bridge reported this device unreachable (its last value, 513.9 W, is not plotted)');
    expect(describeSlot({ quality: 'missing' }, 'power')).toBe('No data recorded for this time');
    expect(describeSlot({ quality: 'live', raw: 140 }, 'power')).toBe('Live reading');
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
  const fresh: SyncStatus = { settled: true, fetchedAt: NOW - 30_000, failures: 0, lastError: null, refetchMs: 60_000, source: 'bridge' };

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

describe('sourceLabel', () => {
  const fresh: SyncStatus = { settled: true, fetchedAt: NOW - 30_000, failures: 0, lastError: null, refetchMs: 60_000, source: 'bridge' };

  it('names where a point came from and when that was fetched', () => {
    expect(sourceLabel(fresh, 'measured', NOW)).toMatch(/^Bridge buffer · fetched \d{2}:\d{2}:\d{2}$/);
    expect(sourceLabel({ ...fresh, source: 'stored' }, 'measured', NOW)).toMatch(/^Stored history · fetched \d{2}:\d{2}:\d{2}$/);
  });

  it('calls a point from a stale fetch cached, and a live tail live', () => {
    expect(sourceLabel({ ...fresh, fetchedAt: NOW - 300_000, failures: 4 }, 'measured', NOW)).toMatch(/^Cached · as of \d{2}:\d{2}:\d{2}$/);
    expect(sourceLabel(fresh, 'live', NOW)).toBe('Live feed');
  });
});
