import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { ScopePicker } from './ScopePicker';
import type { ScopeOption } from '@/lib/circuitBreakdown';

/**
 * RM-102. Narrowing a report was a labelled `<select>` in the control bar and, a tab later, a row of
 * chips on the Circuits tab — two controls for one state. It is one button now, reading what the
 * report is narrowed to, and behind it the two questions in the order the operator asks them: what
 * the energy was FOR (pills, because there are at most three uses and a whole building), and which
 * ONE circuit (a list, because a panel can have any number of branches).
 */

afterEach(cleanup);

const SCOPES: ScopeOption[] = [
  { value: 'all', label: 'All circuits', group: null },
  { value: 'load:lighting', label: 'Lighting', group: 'use' },
  { value: 'load:aircon', label: 'Aircon', group: 'use' },
  { value: 'circuit:red', label: 'L.O Red', group: 'circuit' },
  { value: 'circuit:yellow', label: 'L.O Yellow', group: 'circuit' },
];

const trigger = () => screen.getByRole('button', { name: /^circuit /i });

describe('ScopePicker', () => {
  it('reads what the report is narrowed to, and opens a dialog with a pill per use and an item per circuit', () => {
    render(<ScopePicker scopes={SCOPES} scope="all" onChange={() => {}} />);
    expect(trigger()).toHaveAccessibleName('Circuit All circuits');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger());
    const dialog = screen.getByRole('dialog', { name: /narrow the report/i });
    const uses = within(dialog).getByRole('group', { name: /by use/i });
    expect(within(uses).getAllByRole('button').map((b) => b.textContent)).toEqual(['All', 'Lighting', 'Aircon']);
    expect(within(uses).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    const circuits = within(dialog).getByRole('group', { name: /one circuit/i });
    expect(within(circuits).getAllByRole('button').map((b) => b.textContent)).toEqual(['L.O Red', 'L.O Yellow']);
  });

  it('a use pill narrows the report and closes the dialog', () => {
    const onChange = vi.fn();
    render(<ScopePicker scopes={SCOPES} scope="all" onChange={onChange} />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('button', { name: 'Lighting' }));
    expect(onChange).toHaveBeenCalledWith('load:lighting');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a circuit item narrows the report, and the button then reads that circuit', () => {
    const onChange = vi.fn();
    const { rerender } = render(<ScopePicker scopes={SCOPES} scope="all" onChange={onChange} />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('button', { name: 'L.O Yellow' }));
    expect(onChange).toHaveBeenCalledWith('circuit:yellow');
    rerender(<ScopePicker scopes={SCOPES} scope="circuit:yellow" onChange={onChange} />);
    expect(trigger()).toHaveAccessibleName('Circuit L.O Yellow');
    fireEvent.click(trigger());
    expect(screen.getByRole('button', { name: 'L.O Yellow' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('offers no "By use" group when the branches carry only one kind of load', () => {
    render(<ScopePicker scopes={SCOPES.filter((s) => s.group !== 'use')} scope="all" onChange={() => {}} />);
    fireEvent.click(trigger());
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByRole('group', { name: /by use/i })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'All circuits' })).toHaveAttribute('aria-current', 'true');
  });

  it('returns focus to the button when a choice closes the dialog', () => {
    render(<ScopePicker scopes={SCOPES} scope="all" onChange={() => {}} />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('button', { name: 'L.O Red' }));
    expect(trigger()).toHaveFocus();
  });
});
