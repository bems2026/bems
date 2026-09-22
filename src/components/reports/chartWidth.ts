import { createContext, useContext, useEffect, useState, type RefObject } from 'react';
import { REPORT_CHART_WIDTH } from '@/lib/reportChartSizes';

/**
 * How wide the page's charts are DRAWN — RM-142.
 *
 * Every report chart was drawn 640 units wide and stretched to its column. That was 1.1× on the 800 px kiosk
 * and 2.36× at 1920 px, where the charts' 9-unit labels stood 21 px tall beside 11 px captions and a week's
 * stacked bars filled half the screen's height (measured 2026-09-22, the operator's screenshots). A drawing's
 * text scales with its drawing, so the only way to keep a label one size on every screen is to draw at the
 * column's own width. The page measures its panel, and every on-screen chart is drawn at
 * `(panel − card chrome) / SCREEN_SCALE` units: a 9-unit label renders at 11 px (`--fs-xs`, the captions'
 * size), a chart's height stays the same however wide the screen, and the plot uses the width it has.
 *
 * THE PDF IS UNTOUCHED: it builds its own scenes at `REPORT_CHART_WIDTH`, and so does anything rendered
 * without this context — which is also what every test sees.
 */

/** Rendered px per drawing unit: a 9-unit label at 11 px. */
export const SCREEN_SCALE = 11 / 9;

/** A chart card's own padding and border, both sides: 16 + 1, twice. */
export const CARD_INSET = 34;

/** The drawing's floor — the same 460 the stylesheet gives the plot; below it the plot scrolls (RM-109). */
export const MIN_SCENE_WIDTH = 460;

/** Past this a week's bars are only getting wider, not easier to read. */
export const MAX_SCENE_WIDTH = 1440;

const STEP = 20;

/** Pure. The drawing width for a panel `panelPx` wide, or `REPORT_CHART_WIDTH` when nothing is measured. */
export function sceneWidthFor(panelPx: number): number {
  if (!(panelPx > 0)) return REPORT_CHART_WIDTH;
  const units = Math.floor((panelPx - CARD_INSET) / SCREEN_SCALE / STEP) * STEP;
  return Math.min(MAX_SCENE_WIDTH, Math.max(MIN_SCENE_WIDTH, units));
}

export const ChartWidthContext = createContext(REPORT_CHART_WIDTH);

/** The width to draw an on-screen report chart at. */
export function useChartWidth(): number {
  return useContext(ChartWidthContext);
}

/**
 * Measures `ref`'s width with a ResizeObserver and returns the drawing width for it. Nothing is set during
 * the effect itself: the observer reports once when it starts, before the report's data has arrived, so
 * the first chart is already drawn at the right width. Without a ResizeObserver it keeps the old width.
 */
export function useMeasuredChartWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(REPORT_CHART_WIDTH);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setWidth(sceneWidthFor(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
