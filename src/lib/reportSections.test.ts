import { describe, it, expect } from 'vitest';
import { REPORT_SECTIONS, normaliseSections, sectionsFor } from './reportSections';

/**
 * RM-083. A reader chooses which parts of a report to export — except two. Coverage and "what this
 * report does not say" are the qualifiers every other figure in the document leans on, and a PDF is
 * the rendering nobody can ask a follow-up question of (operator decision, 2026-09-15).
 */

describe('report sections', () => {
  it('runs from coverage to the refusals, in the order the document reads', () => {
    const ids = REPORT_SECTIONS.map((s) => s.id);
    expect(ids[0]).toBe('coverage');
    expect(ids[ids.length - 1]).toBe('notSaid');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('locks exactly coverage and the refusals, and gives the reason each is locked', () => {
    const locked = REPORT_SECTIONS.filter((s) => s.locked);
    expect(locked.map((s) => s.id)).toEqual(['coverage', 'notSaid']);
    for (const s of locked) expect((s.locked ?? '').length).toBeGreaterThan(20);
  });

  it('puts the locked sections back even when asked to leave everything out', () => {
    expect(normaliseSections([])).toEqual(['coverage', 'notSaid']);
  });

  it('returns sections in document order, however they were chosen, each once', () => {
    expect(normaliseSections(['devices', 'dailyEnergy', 'devices', 'keyFigures'])).toEqual([
      'coverage',
      'keyFigures',
      'dailyEnergy',
      'devices',
      'notSaid',
    ]);
  });

  it('drops an id it does not know, such as a choice remembered from an older build', () => {
    expect(normaliseSections(['coverage', 'sankey'])).toEqual(['coverage', 'notSaid']);
  });
});

describe('the sections of a day — RM-124', () => {
  it('reads hour by hour: the per-day charts and the typical day give way to the hourly ones', () => {
    const ids = sectionsFor('detailed', 'day').map((s) => s.id);
    expect(ids).toContain('hourlyEnergy');
    expect(ids).toContain('circuitHourly');
    expect(ids).not.toContain('dailyEnergy');
    expect(ids).not.toContain('circuitEnergy');
    expect(ids).not.toContain('hourProfile');
    expect(ids.indexOf('hourlyEnergy')).toBeLessThan(ids.indexOf('useShare'));
  });

  it('keeps a week and a month exactly as they were', () => {
    const ids = sectionsFor('detailed', 'month').map((s) => s.id);
    expect(ids).toEqual(sectionsFor('detailed').map((s) => s.id));
    expect(ids).not.toContain('hourlyEnergy');
  });

  it('puts a day\'s locked sections back and drops the per-day ids a day cannot hold', () => {
    expect(normaliseSections(['dailyEnergy', 'hourlyEnergy'], 'detailed', 'day')).toEqual(['coverage', 'hourlyEnergy', 'notSaid']);
  });
});
