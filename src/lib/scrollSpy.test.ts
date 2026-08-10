import { describe, it, expect } from 'vitest';
import { pickActiveSection, type SectionRect } from './scrollSpy';

const VH = 720; // focus line at 108

/** Mirrors the real layout: a tall Overview, a short Devices, a tall Trends. */
const at = (scrollY: number): SectionRect[] => {
  const doc = [
    { id: 'overview', top: 72, height: 826 },
    { id: 'devices', top: 926, height: 84 },
    { id: 'trends', top: 1037, height: 584 },
  ];
  return doc.map((d) => ({ id: d.id, top: d.top - scrollY, bottom: d.top + d.height - scrollY }));
};

describe('pickActiveSection', () => {
  it('returns null with no sections', () => {
    expect(pickActiveSection([], VH)).toBe(null);
  });

  it('picks the first section at the top of the page', () => {
    expect(pickActiveSection(at(0), VH)).toBe('overview');
  });

  it('stays on overview while scrolling through it', () => {
    expect(pickActiveSection(at(400), VH)).toBe('overview');
  });

  it('switches to devices once its top crosses the focus line', () => {
    // devices top = 926 - 850 = 76, which is above the 108 focus line
    expect(pickActiveSection(at(850), VH)).toBe('devices');
  });

  it('switches to trends once its top crosses the focus line', () => {
    // trends top = 1037 - 950 = 87 (past focus line); devices top = -24 (also past),
    // but trends is later in document order so it wins.
    expect(pickActiveSection(at(950), VH)).toBe('trends');
  });

  it('prefers the last section when the page is scrolled to the bottom', () => {
    // A short trailing section might never cross the focus line; it should still win
    // once fully visible, otherwise the nav would be stuck on the previous item.
    const rects: SectionRect[] = [
      { id: 'overview', top: -900, bottom: -100 },
      { id: 'devices', top: -80, bottom: 40 },
      { id: 'trends', top: 300, bottom: 700 },
    ];
    expect(pickActiveSection(rects, VH)).toBe('trends');
  });
});
