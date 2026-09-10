import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import { ChartFigure } from './ChartFigure';
import { dailyEnergyChart } from './charts/dailyEnergyChart';
import { SCREEN_PALETTE } from './charts/palette';

const scene = dailyEnergyChart(
  [
    { day: '2026-08-17', label: '17', kwh: 14.68, observed: true, complete: false },
    { day: '2026-08-18', label: '18', kwh: 0, observed: false, complete: false },
  ],
  { width: 400, height: 180, palette: SCREEN_PALETTE, idPrefix: 'cf', title: 'Energy per day', desc: '' }
);

const table = {
  headers: ['Day', 'Energy (kWh)', 'Peak (W)'],
  rows: [
    ['17 Aug', '14.68', '1768'],
    ['18 Aug', null, null],
  ],
} as const;

// Explicit, because this project runs vitest without globals, so testing-library's automatic
// cleanup never registers. Omitting it leaves every render in the document and the fourth test
// fails with "found multiple elements" — which reads as a component bug and is not one.
afterEach(cleanup);

describe('ChartFigure', () => {
  it('presents the chart as an image that names itself', () => {
    // Not aria-hidden. Sparkline is, because a numeric stat sits beside it; a report chart has
    // no such number, so hiding it removes the finding rather than de-duplicating it.
    const { container } = render(<ChartFigure scene={scene} table={table} />);
    const svg = container.querySelector('svg') as SVGElement;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-hidden')).toBeNull();

    const ids = (svg.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
    expect(ids).toHaveLength(2);
    ids.forEach((id) => expect(container.querySelector(`#${id}`)).not.toBeNull());
    expect(container.querySelector('#cf-title')?.textContent).toBe('Energy per day');
  });

  it('captions the chart with its own finding, but says it to a screen reader only once', () => {
    // The image is already labelled by the scene's <desc>. A visible caption repeating it word
    // for word is read out twice in a row, so it is hidden from assistive technology — the
    // sighted reader still sees it.
    const { container } = render(<ChartFigure scene={scene} table={table} />);
    const cap = container.querySelector('figcaption') as HTMLElement;
    expect(cap.textContent).toBe(scene.desc);
    expect(cap.getAttribute('aria-hidden')).toBe('true');
  });

  it('exposes a caller-supplied caption, which says something the chart cannot know', () => {
    const { container } = render(<ChartFigure scene={scene} table={table} caption="Coverage was 27%." />);
    const cap = container.querySelector('figcaption') as HTMLElement;
    expect(cap.textContent).toBe('Coverage was 27%.');
    expect(cap.getAttribute('aria-hidden')).toBeNull();
  });

  it('carries the same numbers as a real table', () => {
    render(<ChartFigure scene={scene} table={table} />);
    const grid = screen.getByRole('table');
    expect(within(grid).getByText('14.68')).toBeInTheDocument();
    expect(within(grid).getByRole('columnheader', { name: 'Energy (kWh)' })).toBeInTheDocument();
    // Row headers, so a screen reader can say which day a figure belongs to.
    expect(within(grid).getByRole('rowheader', { name: '17 Aug' })).toBeInTheDocument();
  });

  it('renders a missing figure as an em dash and never as zero', () => {
    render(<ChartFigure scene={scene} table={table} />);
    const row = screen.getByRole('rowheader', { name: '18 Aug' }).closest('tr') as HTMLElement;
    expect(within(row).getAllByText('—')).toHaveLength(2);
    expect(within(row).queryByText('0')).toBeNull();
  });

  it('collapses the table by default, so it costs a sighted reader nothing', () => {
    const { container } = render(<ChartFigure scene={scene} table={table} />);
    const details = container.querySelector('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(within(details).getByText('Show the numbers')).toBeInTheDocument();
  });

  it('renders an operator-edited device name as text, never as markup', () => {
    // Device names reach chart labels, and the DOM serializer escapes by construction because
    // it emits real elements. This is that guarantee asserted at the component boundary.
    const hostile = dailyEnergyChart(
      [{ day: '2026-08-17', label: '</svg><script>alert(1)</script>', kwh: 1, observed: true, complete: true }],
      { width: 300, height: 150, palette: SCREEN_PALETTE, idPrefix: 'x', title: 'T', desc: 'D' }
    );
    const { container } = render(<ChartFigure scene={hostile} table={table} />);
    expect(container.querySelector('script')).toBeNull();
  });
});
