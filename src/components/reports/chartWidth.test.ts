import { describe, it, expect } from 'vitest';
import { CARD_INSET, MAX_SCENE_WIDTH, MIN_SCENE_WIDTH, SCREEN_SCALE, sceneWidthFor } from './chartWidth';
import { REPORT_CHART_WIDTH } from '@/lib/reportChartSizes';

/**
 * RM-142. Every report chart was drawn 640 units wide and stretched to its column: 1.1× on the kiosk,
 * 2.36× at 1920 px, where its 9-unit labels stood 21 px tall beside 11 px captions (measured 2026-09-22).
 * Drawn at the column's own width instead, a label is the same size on every screen.
 */

describe('sceneWidthFor', () => {
  const rendered = (panel: number) => (panel - CARD_INSET) / sceneWidthFor(panel);

  it('draws so that a 9-unit label renders at the captions’ 11 px, wherever the width allows', () => {
    expect(SCREEN_SCALE * 9).toBeCloseTo(11, 6);
    for (const panel of [800, 1024, 1366, 1440, 1600]) {
      expect(rendered(panel), `panel ${panel}`).toBeGreaterThanOrEqual(SCREEN_SCALE);
      expect(rendered(panel), `panel ${panel}`).toBeLessThan(SCREEN_SCALE * 1.05);
    }
  });

  it('never draws narrower than the drawing’s floor — on a phone the plot scrolls, as it did', () => {
    expect(sceneWidthFor(304)).toBe(MIN_SCENE_WIDTH);
    expect(sceneWidthFor(360)).toBe(MIN_SCENE_WIDTH);
  });

  it('stops widening past a sane ceiling on a very wide screen', () => {
    expect(sceneWidthFor(4000)).toBe(MAX_SCENE_WIDTH);
  });

  it('steps in 20-unit strides, so resizing by a pixel does not redraw every chart', () => {
    expect(sceneWidthFor(1200) % 20).toBe(0);
    expect(sceneWidthFor(1200)).toBe(sceneWidthFor(1201));
  });

  it('keeps the old width when there is nothing measured yet', () => {
    expect(sceneWidthFor(0)).toBe(REPORT_CHART_WIDTH);
    expect(sceneWidthFor(Number.NaN)).toBe(REPORT_CHART_WIDTH);
  });
});
