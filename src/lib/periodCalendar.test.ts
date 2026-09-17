import { describe, it, expect } from 'vitest';
import { monthCells, weekCells, yearsOf } from './periodCalendar';

/**
 * RM-103. The period picker's list of every stored report was a column of names grouped by year —
 * right when there were three, a scroll of 240 when there are twenty years of months. A calendar
 * reads the same list at a glance: twelve cells a year, and a month with no report is a cell that
 * cannot be chosen, not a month that silently is not there. Still stored reports, never the
 * calendar's own idea of what exists.
 */

const MONTHS = ['2026-08-01', '2026-06-01', '2025-12-01'];

describe('yearsOf', () => {
  it('lists each year with a report once, newest first', () => {
    expect(yearsOf(MONTHS)).toEqual(['2026', '2025']);
    expect(yearsOf([])).toEqual([]);
  });
});

describe('monthCells', () => {
  it('is always twelve cells, January to December, with a start only where a report exists', () => {
    const cells = monthCells('2026', MONTHS);
    expect(cells).toHaveLength(12);
    expect(cells.map((c) => c.label)).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
    expect(cells.map((c) => c.start)).toEqual([null, null, null, null, null, '2026-06-01', null, '2026-08-01', null, null, null, null]);
  });

  it('names every cell in full, so a cell with no report can say which month has none', () => {
    const cells = monthCells('2026', MONTHS);
    expect(cells[2].name).toBe('March 2026');
    expect(cells[7].name).toBe('August 2026');
  });
});

describe('weekCells', () => {
  const WEEKS = ['2026-08-31', '2026-08-24'];

  it('lays out every week of the year on the weekday the stored weeks start, grouped by month', () => {
    const rows = weekCells('2026', WEEKS);
    expect(rows.map((r) => r.month)).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
    const august = rows[7];
    expect(august.cells.map((c) => c.label)).toEqual(['3', '10', '17', '24', '31']);
    expect(august.cells.map((c) => c.start)).toEqual([null, null, null, '2026-08-24', '2026-08-31']);
    // Every cell is a Monday, because the stored weeks are.
    for (const row of rows) for (const c of row.cells) expect(new Date(`${c.date}T00:00:00Z`).getUTCDay()).toBe(1);
  });

  it('names a week the way the stepper does, so the reason for an empty cell reads the same', () => {
    const august = weekCells('2026', WEEKS)[7];
    expect(august.cells[0].name).toMatch(/^Week of /);
    expect(august.cells[0].name).toContain('2026');
  });

  it('falls back to Monday when no week is stored at all', () => {
    const rows = weekCells('2026', []);
    expect(rows.flatMap((r) => r.cells).every((c) => c.start === null)).toBe(true);
    expect(new Date(`${rows[0].cells[0].date}T00:00:00Z`).getUTCDay()).toBe(1);
  });
});
