import { describe, it, expect } from 'vitest';
import { REPORT_SECTIONS, normaliseSections } from './reportSections';

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
