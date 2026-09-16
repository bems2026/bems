import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReportFigure } from './ReportFigure';

/**
 * RM-090 — a stored figure the circuit could not have drawn is refused on the page, and a corrected
 * one says what was taken out of it. Neither is ever silent.
 */

describe('ReportFigure flags', () => {
  it('refuses an impossible figure: a dash and the reason, never the number', () => {
    const { container } = render(<ReportFigure value={81.406} unit="" digits={2} period="week" flag={{ kind: 'impossible' }} />);
    expect(container.textContent).not.toContain('81');
    expect(container.textContent).toContain('—');
    const badge = screen.getByText('Not possible');
    expect(badge.getAttribute('title')).toMatch(/more than this circuit’s highest draw could deliver/);
  });

  it('prints a corrected figure with what was removed from it', () => {
    const { container } = render(
      <ReportFigure value={4.617} unit="" digits={2} period="week" flag={{ kind: 'corrected', removedKwh: 76.789, restatedAt: null }} />
    );
    expect(container.textContent).toContain('4.62');
    expect(screen.getByText('Corrected').getAttribute('title')).toMatch(/76\.79 kWh jump in the meter’s counter is not counted/);
  });

  it('adds nothing to an unflagged figure', () => {
    const { container } = render(<ReportFigure value={24.188} unit="" digits={2} period="week" />);
    expect(container.textContent).toBe('24.19');
  });
});
