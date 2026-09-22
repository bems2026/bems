import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { SceneSvg } from './sceneToJsx';
import { PRINT_PALETTE } from './palette';
import type { Scene } from './types';

/**
 * FI-039. The scene's attributes are SVG's own names — `stroke-width`, `text-anchor` — because the PDF's
 * serializer writes them verbatim, and `SceneSvg` handed the same names to React, which logged "Invalid DOM
 * property" for each: 51 errors on one visit to the Reports page (measured 2026-09-22), burying any real
 * error in the console. React wants the camelCase prop and writes the same attribute to the DOM, which
 * `serializers.test.tsx` still checks node for node against the PDF's string.
 *
 * Its own file on purpose: React warns about each name once per module lifetime, so a test that ran after
 * any other render would pass without proving anything.
 */

afterEach(cleanup);

const SCENE: Scene = {
  width: 300,
  height: 120,
  idPrefix: 'j',
  title: 'Every attribute a scene can carry',
  desc: 'A gradient, a dashed line, a dashed path and text in every style.',
  defs: [
    { kind: 'hatch', id: 'j-gap', stroke: PRINT_PALETTE.gap },
    { kind: 'linearGradient', id: 'j-area', from: PRINT_PALETTE.series[0], to: PRINT_PALETTE.series[0], fromOpacity: 0.35, toOpacity: 0 },
  ],
  marks: [
    { kind: 'rect', x: 10, y: 20, w: 30, h: 80, fill: 'url(#j-gap)', stroke: PRINT_PALETTE.ink, strokeWidth: 1 },
    { kind: 'line', x1: 0, y1: 40, x2: 300, y2: 40, stroke: PRINT_PALETTE.threshold, width: 1.5, dash: '5 3' },
    { kind: 'path', d: 'M 0 10 L 300 10', stroke: PRINT_PALETTE.ink, width: 2, dash: '8 3' },
    { kind: 'text', x: 150, y: 60, text: 'no data', fill: PRINT_PALETTE.textMuted, size: 8, anchor: 'middle', weight: 600, dy: 3 },
  ],
};

describe('SceneSvg speaks React’s attribute names — FI-039', () => {
  it('renders without a single warning', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<SceneSvg scene={SCENE} palette={PRINT_PALETTE} />);
    const said = errors.mock.calls.map((call) => call.map(String).join(' '));
    errors.mockRestore();
    expect(said).toEqual([]);
  });

  it('still writes SVG’s own attribute names to the page', () => {
    const { container } = render(<SceneSvg scene={SCENE} palette={PRINT_PALETTE} />);
    expect(container.querySelector('line[y1="40"]')?.getAttribute('stroke-dasharray')).toBe('5 3');
    expect(container.querySelector('path[d="M 0 10 L 300 10"]')?.getAttribute('stroke-width')).toBe('2');
    const text = container.querySelector('text');
    expect(text?.getAttribute('text-anchor')).toBe('middle');
    expect(text?.getAttribute('font-size')).toBe('8');
    expect(container.querySelector('stop')?.getAttribute('stop-color')).toBe(PRINT_PALETTE.series[0]);
    expect(container.querySelector('svg')?.getAttribute('aria-labelledby')).toBeTruthy();
  });
});
