import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ReportSkeleton } from './ReportSkeleton';

/**
 * RM-082b. While a report loads, the page said "Loading the hourly charts…" in a line of text and
 * then five charts arrived and pushed everything below them down the page. A placeholder shaped
 * like what it stands in for keeps the page still, and says once — to a screen reader — what is
 * coming.
 */

afterEach(cleanup);

describe('ReportSkeleton', () => {
  it('says what is loading once, to a screen reader, and hides its shapes', () => {
    const { container } = render(<ReportSkeleton label="August 2026" period="month" parts={['kpis', 'charts', 'table']} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading the August 2026 report');
    expect(container.firstElementChild).toHaveAttribute('aria-busy', 'true');
    const blocks = container.querySelectorAll('.skeleton');
    expect(blocks.length).toBeGreaterThan(0);
    blocks.forEach((block) => expect(block).toHaveAttribute('aria-hidden', 'true'));
  });

  it('holds a place for each chart, in the order the charts appear', () => {
    const { container } = render(<ReportSkeleton label="x" period="month" parts={['charts']} />);
    const charts = [...container.querySelectorAll<HTMLElement>('[data-chart]')].map((el) => el.dataset.chart);
    expect(charts).toEqual(['daily', 'hours', 'breakdown', 'heat', 'curve']);
  });

  it('shapes the table placeholder like the table: a label, then right-aligned figures', () => {
    const { container } = render(<ReportSkeleton label="x" period="month" parts={['table']} />);
    const rows = container.querySelectorAll('.report-skeleton__row');
    expect(rows).toHaveLength(6);
    expect(rows[0].querySelector('.report-skeleton__label')).not.toBeNull();
    expect(rows[0].querySelectorAll('.report-skeleton__num').length).toBeGreaterThan(0);
  });

  it('draws only the parts it is asked for', () => {
    const { container } = render(<ReportSkeleton label="x" period="week" parts={['table']} />);
    expect(container.querySelector('[data-chart]')).toBeNull();
    expect(container.querySelector('.report-skeleton__kpis')).toBeNull();
  });
});
