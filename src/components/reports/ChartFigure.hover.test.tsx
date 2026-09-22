import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ChartFigure } from './ChartFigure';
import { dailyEnergyChart } from './charts/dailyEnergyChart';
import { SCREEN_PALETTE } from './charts/palette';
import type { Scene } from './charts/types';

/**
 * RM-084 — reading a value off a report chart.
 *
 * Hover shows the value under the pointer; the keyboard steps through the same values from ONE tab
 * stop (a 744-cell heatmap is not 744 tab stops), and a live region says each one. The tooltip leads
 * with the value and follows with what it belongs to — the reader already knows the chart, and wants
 * the number. It enhances and never gates: every value is still in the table under the chart.
 */

const WIDTH = 300;
const HEIGHT = 150;

const scene = dailyEnergyChart(
  [
    { day: '2026-08-17', label: '17', kwh: 14.68, observed: true, complete: true },
    { day: '2026-08-18', label: '18', kwh: 0, observed: false, complete: false },
    { day: '2026-08-19', label: '19', kwh: 0.89, observed: true, complete: false },
  ],
  { width: WIDTH, height: HEIGHT, palette: SCREEN_PALETTE, idPrefix: 'hv', title: 'Energy per day', desc: '' }
);

const table = { headers: ['Day', 'Energy (kWh)'], rows: [['17', '14.68']] } as const;

beforeEach(() => {
  // jsdom lays nothing out. The plot is drawn at its own size here, so screen and scene coordinates agree.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, width: WIDTH, height: HEIGHT, right: WIDTH, bottom: HEIGHT, toJSON: () => ({}),
  } as DOMRect);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const explore = () => screen.getByRole('group', { name: /explore the values/i });
const centre = (i: number) => {
  const hit = scene.hits![i];
  return { clientX: hit.x + hit.w / 2, clientY: hit.y + hit.h / 2 };
};

describe('ChartFigure — hover and focus', () => {
  it('shows the value under the pointer, and hides it when the pointer leaves', () => {
    render(<ChartFigure scene={scene} table={table} />);
    fireEvent.pointerMove(explore(), centre(0));
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('14.68 kWh');
    expect(tip).toHaveTextContent('2026-08-17');

    fireEvent.pointerMove(explore(), centre(1));
    expect(screen.getByRole('tooltip')).toHaveTextContent('No data');

    fireEvent.pointerLeave(explore());
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('leads with the value, then what it belongs to, then any qualifier', () => {
    render(<ChartFigure scene={scene} table={table} />);
    fireEvent.pointerMove(explore(), centre(2));
    const parts = [...screen.getByRole('tooltip').children].map((c) => c.textContent);
    expect(parts[0]).toBe('0.89 kWh');
    expect(parts[1]).toBe('2026-08-19');
    expect(parts[2]).toMatch(/at least/i);
  });

  it('steps through every value from one tab stop, and says each one', () => {
    render(<ChartFigure scene={scene} table={table} />);
    const group = explore();
    expect(group).toHaveAttribute('tabindex', '0');

    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(screen.getByRole('tooltip')).toHaveTextContent('14.68 kWh');
    expect(screen.getByRole('status')).toHaveTextContent('14.68 kWh, 2026-08-17');

    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(screen.getByRole('status')).toHaveTextContent('No data, 2026-08-18');

    fireEvent.keyDown(group, { key: 'End' });
    expect(screen.getByRole('tooltip')).toHaveTextContent('0.89 kWh');
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(screen.getByRole('tooltip')).toHaveTextContent('0.89 kWh');

    fireEvent.keyDown(group, { key: 'Home' });
    expect(screen.getByRole('tooltip')).toHaveTextContent('14.68 kWh');

    fireEvent.keyDown(group, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('renders an operator-edited label as text, never as markup', () => {
    const hostile: Scene = { ...scene, hits: [{ ...scene.hits![0], label: '<img src=x onerror=alert(1)>' }] };
    const { container } = render(<ChartFigure scene={hostile} table={table} />);
    fireEvent.keyDown(explore(), { key: 'ArrowRight' });
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('tooltip')).toHaveTextContent('<img src=x onerror=alert(1)>');
  });

  it('offers nothing to explore on a chart with nothing drawn', () => {
    const empty: Scene = { ...scene, hits: [] };
    render(<ChartFigure scene={empty} table={table} />);
    expect(screen.queryByRole('group', { name: /explore the values/i })).toBeNull();
  });
});

describe('ChartFigure — where the tooltip lands, RM-141', () => {
  // The geometry is `placeBeside`'s, asserted edge by edge in `popoverPlacement.test.ts`. This asserts the
  // wiring: the tooltip is placed by it, inside the figure, beside the value — not by arithmetic of its own.
  it('sits beside the value read, a gap after it, capped to the room in the figure', () => {
    render(<ChartFigure scene={scene} table={table} />);
    const hit = scene.hits![0];
    fireEvent.pointerMove(explore(), centre(0));
    const tip = screen.getByRole('tooltip');
    expect(tip.style.maxWidth).toBe(`${Math.min(240, WIDTH - 16)}px`);
    expect(Number.parseFloat(tip.style.left)).toBe(hit.x + hit.w + 6);
    expect(Number.parseFloat(tip.style.top)).toBeGreaterThanOrEqual(8);
    // No side classes and no transforms left to fight the placement.
    expect(tip.className).toBe('chart-tooltip report-chart__tip');
  });
});
