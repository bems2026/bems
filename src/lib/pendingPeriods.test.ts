import { describe, it, expect } from 'vitest';
import { nextChangeAt, OVERDUE_SLACK_MS, pendingPeriods } from './pendingPeriods';
import { REPORT_CHECK_MS } from '@shared/reportSchedule.mjs';

/**
 * RM-138. "The Sept 14 weekly report isn't available even though the week of Sept 21 has started" —
 * the operator, 2026-09-22, 20:30 Manila. It was not late: it settles at 08:00 on the 23rd. But a week
 * that has ended and is not yet made was simply absent from the picker, which reads exactly like a
 * broken pipeline. These entries are what the page says instead.
 */

const OFFSET = 480;
const at = (iso: string) => Date.parse(iso);
const entry = (list: ReturnType<typeof pendingPeriods>, start: string) => list.find((p) => p.start === start);

describe('a week', () => {
  const stored = ['2026-09-07', '2026-08-31'];

  it('names the ended week as due at 08:00 on Wednesday, and the running week as in progress — the operator’s evening', () => {
    const list = pendingPeriods('week', stored, at('2026-09-22T12:30:00Z'), { offsetMinutes: OFFSET });
    expect(list.map((p) => [p.start, p.state])).toEqual([
      ['2026-09-14', 'settling'],
      ['2026-09-21', 'in-progress'],
    ]);
    const ended = entry(list, '2026-09-14')!;
    expect(new Date(ended.dueAt).toISOString()).toBe('2026-09-23T00:00:00.000Z');
    expect(ended.byAt).toBe(ended.dueAt + REPORT_CHECK_MS);
    expect(ended.name).toMatch(/^Week of /);
    expect(ended.label).toContain(ended.name);
    expect(ended.label).toMatch(/ready after 08:00/);
    expect(ended.label).toMatch(/23/);
    expect(entry(list, '2026-09-21')!.label).toMatch(/in progress/);
  });

  it('turns from "ready after" to "being made" at the settle minute exactly, not before', () => {
    const due = at('2026-09-23T00:00:00Z');
    expect(entry(pendingPeriods('week', stored, due - 1, { offsetMinutes: OFFSET }), '2026-09-14')!.state).toBe('settling');
    const made = entry(pendingPeriods('week', stored, due, { offsetMinutes: OFFSET }), '2026-09-14')!;
    expect(made.state).toBe('due');
    // Derived from the pass interval, never written out: 6 hours today.
    expect(made.label).toMatch(/every 6 hours/);
    expect(made.label).toMatch(/by 14:00/);
  });

  it('says overdue only once a list read AFTER the expected time still lacks the report', () => {
    const due = at('2026-09-23T00:00:00Z');
    const late = due + REPORT_CHECK_MS + OVERDUE_SLACK_MS;
    // The page has been open since before; its list says nothing about now.
    expect(entry(pendingPeriods('week', stored, late + 60_000, { offsetMinutes: OFFSET, listReadAt: due - 3_600_000 }), '2026-09-14')!.state).toBe('due');
    const overdue = entry(pendingPeriods('week', stored, late + 60_000, { offsetMinutes: OFFSET, listReadAt: late }), '2026-09-14')!;
    expect(overdue.state).toBe('overdue');
    // RM-143: on 2026-09-23 the service was running and could not reach the database — say both.
    expect(overdue.label).toMatch(/the report service may be stopped, or unable to reach the database/);
  });

  it('drops the entry once the report exists', () => {
    const list = pendingPeriods('week', ['2026-09-14', ...stored], at('2026-09-23T03:30:00Z'), { offsetMinutes: OFFSET });
    expect(list.map((p) => p.start)).toEqual(['2026-09-21']);
  });

  it('finds the running week across a year boundary, Monday first', () => {
    const list = pendingPeriods('week', ['2026-12-21'], at('2027-01-01T04:00:00Z'), { offsetMinutes: OFFSET });
    expect(list.map((p) => p.start)).toEqual(['2026-12-28']);
  });
});

describe('a day', () => {
  it('is in progress until local midnight, then ready after 01:00', () => {
    const evening = pendingPeriods('day', ['2026-09-21'], at('2026-09-22T12:30:00Z'), { offsetMinutes: OFFSET });
    expect(evening.map((p) => [p.start, p.state])).toEqual([['2026-09-22', 'in-progress']]);
    expect(new Date(evening[0].dueAt).toISOString()).toBe('2026-09-22T17:00:00.000Z');

    const pastMidnight = pendingPeriods('day', ['2026-09-21'], at('2026-09-22T16:30:00Z'), { offsetMinutes: OFFSET });
    expect(pastMidnight.map((p) => [p.start, p.state])).toEqual([
      ['2026-09-22', 'settling'],
      ['2026-09-23', 'in-progress'],
    ]);
    expect(pastMidnight[0].label).toMatch(/ready after 01:00/);
  });
});

describe('a month', () => {
  it('settles at 08:00 on the 3rd — the UTC 1st plus the two-day grace', () => {
    const list = pendingPeriods('month', ['2026-08-01'], at('2026-10-01T12:00:00Z'), { offsetMinutes: OFFSET });
    expect(list.map((p) => [p.start, p.state])).toEqual([
      ['2026-09-01', 'settling'],
      ['2026-10-01', 'in-progress'],
    ]);
    expect(new Date(list[0].dueAt).toISOString()).toBe('2026-10-03T00:00:00.000Z');
  });
});

describe('nextChangeAt', () => {
  it('is the next moment any entry changes what it says — so the page wakes three times, not every second', () => {
    const now = at('2026-09-22T12:30:00Z');
    const list = pendingPeriods('week', ['2026-09-07'], now, { offsetMinutes: OFFSET });
    expect(new Date(nextChangeAt(list, now)!).toISOString()).toBe('2026-09-23T00:00:00.000Z');
    const due = at('2026-09-23T00:00:00Z');
    expect(nextChangeAt(pendingPeriods('week', ['2026-09-07'], due, { offsetMinutes: OFFSET }), due)).toBe(due + REPORT_CHECK_MS + OVERDUE_SLACK_MS);
  });

  it('is null when nothing will change', () => {
    expect(nextChangeAt([], Date.now())).toBeNull();
  });
});
