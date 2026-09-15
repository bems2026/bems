import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import { ReportTable, type ReportColumn } from './ReportTable';

/**
 * RM-082. The report's tables were `.devices-table` borrowed from the fleet grid: a
 * `min-width: 860px` meant for eight columns forced a five-column table to scroll on the kiosk,
 * units were repeated in every cell, and the `is-numeric` class the chart tables set had no CSS
 * rule at all — so every number was left-aligned, which is the one alignment a column of figures
 * cannot be scanned in.
 */

afterEach(cleanup);

interface Row {
  name: string;
  kwh: number | null;
  peak: number | null;
}

const columns: ReportColumn<Row>[] = [
  { id: 'name', header: 'Device', cell: (r) => r.name },
  { id: 'kwh', header: 'Energy', unit: 'kWh', numeric: true, cell: (r) => (r.kwh === null ? null : r.kwh.toFixed(2)) },
  { id: 'peak', header: 'Peak', unit: 'W', numeric: true, cell: (r) => (r.peak === null ? null : String(r.peak)) },
];

const rows: Row[] = [
  { name: 'C.O Yellow', kwh: 51.1, peak: 0 },
  { name: 'Lighting', kwh: null, peak: null },
];

const draw = (extra: Partial<Parameters<typeof ReportTable<Row>>[0]> = {}) =>
  render(<ReportTable columns={columns} rows={rows} rowKey={(r) => r.name} label="Per-device report for August 2026" {...extra} />);

describe('ReportTable', () => {
  it('names itself, and says each column’s unit once in its header rather than in every cell', () => {
    draw();
    const table = screen.getByRole('table', { name: 'Per-device report for August 2026' });
    expect(within(table).getByRole('columnheader', { name: 'Energy (kWh)' })).toBeInTheDocument();
    expect(within(table).getByText('51.10')).toBeInTheDocument();
    expect(within(table).queryByText(/51\.10 kWh/)).toBeNull();
  });

  it('right-aligns every numeric column, header and cells alike, and nothing else', () => {
    draw();
    const header = screen.getByRole('columnheader', { name: 'Energy (kWh)' });
    expect(header).toHaveClass('report-table__num');
    expect(screen.getByText('51.10').closest('td')).toHaveClass('report-table__num');
    expect(screen.getByRole('columnheader', { name: 'Device' })).not.toHaveClass('report-table__num');
  });

  it('uses the first column as each row’s header, so a figure can be traced to its row', () => {
    draw();
    expect(screen.getByRole('rowheader', { name: 'C.O Yellow' })).toBeInTheDocument();
  });

  it('shows a missing figure as an em dash — and a real zero as a zero', () => {
    // Both halves matter. An em dash for 0 hides a measurement; a 0 for null invents one.
    draw();
    const missing = screen.getByRole('rowheader', { name: 'Lighting' }).closest('tr') as HTMLElement;
    expect(within(missing).getAllByText('—')).toHaveLength(2);
    const zero = screen.getByRole('rowheader', { name: 'C.O Yellow' }).closest('tr') as HTMLElement;
    expect(within(zero).getByText('0')).toBeInTheDocument();
  });

  it('carries a visible caption when it is given one', () => {
    draw({ caption: 'Branch circuits' });
    expect(screen.getByText('Branch circuits').tagName).toBe('CAPTION');
  });

  it('renders an operator-edited device name as text, never as markup', () => {
    const { container } = render(
      <ReportTable
        columns={columns}
        rows={[{ name: '<img src=x onerror=alert(1)><script>alert(1)</script>', kwh: 1, peak: 1 }]}
        rowKey={(r) => r.name}
        label="t"
      />
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });
});
