import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { PeriodPicker } from './PeriodPicker';

/**
 * RM-082b. Choosing which report to read was a row of pill buttons up to fourteen and a select past
 * that, on its own line below two other rows of controls. It is a stepper now — the period being
 * read, the one before and after it, and a list of every stored report behind the label — plus the
 * two jumps a reader actually makes: back to the latest, and to the same period a year earlier.
 *
 * WHAT IT STEPS THROUGH IS THE STORED REPORTS, not the calendar. The list can have holes (a month
 * generated late, a week before reporting was switched on), and "previous" landing on a period with
 * no report would render an empty page that looks like a period with no consumption.
 */

afterEach(cleanup);

const MONTHS = ['2026-08-01', '2026-07-01', '2026-06-01'];
/** The stepper's label opens the calendar; the presets live inside it since RM-103. */
const openCalendar = (label: string) => fireEvent.click(screen.getByRole('button', { name: label }));

describe('PeriodPicker', () => {
  it('is a group named for the kind of period it picks', () => {
    const { rerender } = render(<PeriodPicker period="month" starts={MONTHS} selected="2026-07-01" onSelect={() => {}} />);
    expect(screen.getByRole('group', { name: 'Report month' })).toBeInTheDocument();
    rerender(<PeriodPicker period="week" starts={['2026-08-31']} selected="2026-08-31" onSelect={() => {}} />);
    expect(screen.getByRole('group', { name: 'Report week' })).toBeInTheDocument();
  });

  it('names the period being read, and steps to the report before and after it', () => {
    const onSelect = vi.fn();
    render(<PeriodPicker period="month" starts={MONTHS} selected="2026-07-01" onSelect={onSelect} />);
    expect(screen.getByRole('button', { name: 'July 2026' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(onSelect).toHaveBeenLastCalledWith('2026-06-01');
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(onSelect).toHaveBeenLastCalledWith('2026-08-01');
  });

  it('cannot step past the oldest or the newest report', () => {
    const { rerender } = render(<PeriodPicker period="month" starts={MONTHS} selected="2026-06-01" onSelect={() => {}} />);
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeDisabled();
    rerender(<PeriodPicker period="month" starts={MONTHS} selected="2026-08-01" onSelect={() => {}} />);
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled();
  });

  it('steps to the previous stored report across a gap, never to a month that has none', () => {
    const onSelect = vi.fn();
    render(<PeriodPicker period="month" starts={['2026-08-01', '2026-05-01']} selected="2026-08-01" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(onSelect).toHaveBeenCalledWith('2026-05-01');
  });

  it('jumps to the latest report, and does not offer to when it is already showing', () => {
    const onSelect = vi.fn();
    const { rerender } = render(<PeriodPicker period="month" starts={MONTHS} selected="2026-06-01" onSelect={onSelect} />);
    openCalendar('June 2026');
    fireEvent.click(screen.getByRole('button', { name: 'Latest' }));
    expect(onSelect).toHaveBeenCalledWith('2026-08-01');
    rerender(<PeriodPicker period="month" starts={MONTHS} selected="2026-08-01" onSelect={onSelect} />);
    openCalendar('August 2026');
    expect(screen.getByRole('button', { name: 'Latest' })).toBeDisabled();
  });

  it('offers the same month last year only when that report exists, and says why when it does not', () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <PeriodPicker period="month" starts={[...MONTHS, '2025-08-01']} selected="2026-08-01" onSelect={onSelect} />
    );
    openCalendar('August 2026');
    fireEvent.click(screen.getByRole('button', { name: 'Same month last year' }));
    expect(onSelect).toHaveBeenCalledWith('2025-08-01');

    rerender(<PeriodPicker period="month" starts={MONTHS} selected="2026-08-01" onSelect={onSelect} />);
    openCalendar('August 2026');
    const unavailable = screen.getByRole('button', { name: 'Same month last year' });
    expect(unavailable).toBeDisabled();
    expect(unavailable).toHaveAccessibleDescription(/No report for August 2025/);
  });

  it('finds the same week last year by its Monday, 52 weeks back', () => {
    // 364 days keeps the weekday. 365 would land on a Tuesday and match no stored week.
    const onSelect = vi.fn();
    render(<PeriodPicker period="week" starts={['2026-08-31', '2026-08-24', '2025-09-01']} selected="2026-08-31" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /^Week of / }));
    fireEvent.click(screen.getByRole('button', { name: 'Same week last year' }));
    expect(onSelect).toHaveBeenCalledWith('2025-09-01');
  });

  it('labels a week by the Monday it starts, and steps week by week', () => {
    const onSelect = vi.fn();
    render(<PeriodPicker period="week" starts={['2026-08-31', '2026-08-24']} selected="2026-08-31" onSelect={onSelect} />);
    expect(screen.getByRole('button', { name: /^Week of / })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(onSelect).toHaveBeenCalledWith('2026-08-24');
  });

  it('opens a calendar on the year being read — a month with a report can be chosen, one without says so — and choosing closes it (RM-103)', () => {
    const onSelect = vi.fn();
    render(<PeriodPicker period="month" starts={[...MONTHS, '2025-12-01']} selected="2026-08-01" onSelect={onSelect} />);
    const current = screen.getByRole('button', { name: 'August 2026' });
    expect(current).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(current);
    expect(current).toHaveAttribute('aria-expanded', 'true');
    const dialog = screen.getByRole('dialog', { name: 'Choose a report month' });
    const year = within(dialog).getByRole('group', { name: '2026' });
    expect(within(year).getAllByRole('button')).toHaveLength(12);
    // Short on the cell, full for a screen reader — the same pair the week cells use.
    expect(within(year).getByRole('button', { name: 'June 2026' })).toHaveTextContent('Jun');
    const march = within(year).getByRole('button', { name: 'March 2026' });
    expect(march).toBeDisabled();
    expect(march).toHaveAttribute('title', 'No report for March 2026');

    fireEvent.click(within(year).getByRole('button', { name: 'June 2026' }));
    expect(onSelect).toHaveBeenCalledWith('2026-06-01');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('steps the calendar through the years that have reports, and no further', () => {
    render(<PeriodPicker period="month" starts={[...MONTHS, '2025-12-01']} selected="2026-08-01" onSelect={() => {}} />);
    openCalendar('August 2026');
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Next year' })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Previous year' }));
    expect(within(dialog).getByRole('group', { name: '2025' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Previous year' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'December 2025' })).toBeEnabled();
  });

  it('marks the report being read in the calendar', () => {
    render(<PeriodPicker period="month" starts={MONTHS} selected="2026-07-01" onSelect={() => {}} />);
    openCalendar('July 2026');
    const dialog = screen.getByRole('dialog', { name: 'Choose a report month' });
    expect(within(dialog).getByRole('button', { name: 'July 2026' })).toHaveAttribute('aria-current', 'true');
    expect(within(dialog).getByRole('button', { name: 'June 2026' })).not.toHaveAttribute('aria-current');
  });

  it('lays weeks out as a row of start days under each month, named in full for a screen reader', () => {
    const onSelect = vi.fn();
    render(<PeriodPicker period="week" starts={['2026-08-31', '2026-08-24']} selected="2026-08-31" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /^Week of / }));
    const dialog = screen.getByRole('dialog', { name: 'Choose a report week' });
    const august = within(dialog).getByRole('group', { name: 'Aug' });
    const cells = within(august).getAllByRole('button');
    expect(cells.map((c) => c.textContent)).toEqual(['3', '10', '17', '24', '31']);
    expect(cells[0]).toBeDisabled();
    expect(cells[3]).toBeEnabled();
    expect(cells[3]).toHaveAccessibleName(/^Week of .*24.*2026/); // the reader's locale orders the date
    fireEvent.click(cells[3]);
    expect(onSelect).toHaveBeenCalledWith('2026-08-24');
  });
});
