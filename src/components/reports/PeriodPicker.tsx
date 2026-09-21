import { useCallback, useEffect, useId, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAnchoredPopover } from '@/components/ui/useAnchoredPopover';
import { formatPeriod, type ReportPeriod } from '@/lib/supabaseReports';
import { sameStartLastYear } from '@/lib/reportPeriods';
import { dayCells, monthCells, monthName, monthsOf, weekCells, yearsOf, type CalendarCell } from '@/lib/periodCalendar';

/**
 * Choosing which week or month to read — a stepper since RM-082b, with a calendar behind its label
 * since RM-103.
 *
 * RM-041 shipped a row of pill buttons, right for the two months that existed then, and RM-072m
 * added a select for when the row would run past two lines — `getReportPeriods` fetches up to 240
 * months or 520 weeks. RM-082b made it this stepper, with every stored report in a list behind the
 * label. That list was a column of names: three the day it shipped, a scroll of two hundred and
 * forty in twenty years. The calendar behind the label now reads the same list at a glance —
 * twelve cells a year, or a row of week-starts under each month — and the two jumps a reader
 * actually makes, back to the latest report and to the same period a year earlier, sit under it
 * rather than in the control bar, which on the kiosk could not carry them and stay one line.
 *
 * IT STEPS THROUGH STORED REPORTS, NOT THE CALENDAR. The list can have holes, and "previous"
 * landing on a period with no report would render an empty page that looks like a period with no
 * consumption. Previous is the previous REPORT — and in the calendar a period with no report is a
 * cell that cannot be chosen and says so, not a month that is silently not there.
 *
 * AN UNAVAILABLE JUMP SAYS WHY, in words a screen reader reads — "No report for August 2025" — rather
 * than being a disabled button nobody can ask about.
 */

interface Props {
  period: ReportPeriod;
  /** Period start dates, newest first — the order `getReportPeriods` returns. */
  starts: readonly string[];
  selected: string | null;
  onSelect: (start: string) => void;
}

export function PeriodPicker({ period, starts, selected, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const dismiss = useCallback(() => setOpen(false), []);
  const { anchorRef, popRef, style, placement } = useAnchoredPopover({
    open,
    onDismiss: dismiss,
    preferredWidth: 320,
    fallbackHeight: 320,
    preferredMaxHeight: 420,
  });
  const reasonId = useId();

  const label = period === 'day' ? 'Report day' : period === 'week' ? 'Report week' : 'Report month';
  const index = selected === null ? -1 : starts.indexOf(selected);
  const newer = index > 0 ? starts[index - 1] : null;
  const older = index >= 0 && index < starts.length - 1 ? starts[index + 1] : null;
  const latest = starts[0] ?? null;
  const lastYear = selected === null ? null : sameStartLastYear(period, selected);
  const lastYearAvailable = lastYear !== null && starts.includes(lastYear);
  const lastYearReason = lastYear !== null && !lastYearAvailable ? `No report for ${formatPeriod(period, lastYear)}` : null;

  // The calendar opens on the page being read, and steps only through pages that have a report:
  // a year of months or weeks, or — RM-124 — a month of days, since 365 cells do not fit a popover.
  const pages = period === 'day' ? monthsOf(starts) : yearsOf(starts);
  const [pageIndex, setPageIndex] = useState(0);
  const page = pages[pageIndex] ?? pages[0];
  const pageLabel = page === undefined ? '' : period === 'day' ? monthName(page) : page;

  const toggle = () => {
    if (!open) {
      const i = pages.indexOf((selected ?? '').slice(0, period === 'day' ? 7 : 4));
      setPageIndex(i >= 0 ? i : 0);
    }
    setOpen((o) => !o);
  };

  // A choice closes the dialog and hands focus back to the button that opened it — in an effect,
  // because the ref is read after the render that removed the dialog, not during one.
  const [chosen, setChosen] = useState(0);
  useEffect(() => {
    if (chosen > 0) anchorRef.current?.focus();
  }, [chosen, anchorRef]);

  // Twelve rows of weeks are taller than the popover; it opens with the week being read in view —
  // before paint, so the reader never sees January slide away.
  const placed = open && placement !== null;
  useLayoutEffect(() => {
    // Only once the hook has sized the panel: before that it has no height to scroll within.
    if (!placed) return;
    const current = popRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
    if (current && typeof current.scrollIntoView === 'function') current.scrollIntoView({ block: 'center' });
  }, [placed, popRef]);

  const choose = (start: string) => {
    onSelect(start);
    setOpen(false);
    setChosen((n) => n + 1);
  };

  const cell = (c: CalendarCell) => (
    <button
      key={c.date}
      type="button"
      className={`report-calendar__cell${c.start === selected ? ' report-calendar__cell--current' : ''}`}
      aria-label={c.name}
      aria-current={c.start !== null && c.start === selected ? 'true' : undefined}
      disabled={c.start === null}
      title={c.start === null ? `No report for ${c.name}` : undefined}
      onClick={() => c.start !== null && choose(c.start)}
    >
      {c.label}
    </button>
  );

  return (
    <div className="report-stepper" role="group" aria-label={label}>
      <button
        type="button"
        className="report-stepper__step"
        aria-label={`Previous ${period}`}
        disabled={older === null}
        onClick={() => older !== null && onSelect(older)}
      >
        <ChevronLeft size={16} aria-hidden="true" />
      </button>
      <button
        ref={anchorRef as React.RefObject<HTMLButtonElement>}
        type="button"
        className="report-stepper__current"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={selected === null}
        onClick={toggle}
      >
        {selected === null ? '—' : formatPeriod(period, selected)}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="report-stepper__step"
        aria-label={`Next ${period}`}
        disabled={newer === null}
        onClick={() => newer !== null && onSelect(newer)}
      >
        <ChevronRight size={16} aria-hidden="true" />
      </button>

      {open &&
        page !== undefined &&
        createPortal(
          <div
            ref={popRef as React.RefObject<HTMLDivElement>}
            className="report-calendar"
            role="dialog"
            aria-label={`Choose a ${label.toLowerCase()}`}
            style={style}
          >
            <div className="report-calendar__years">
              <button
                type="button"
                className="report-stepper__step"
                aria-label={period === 'day' ? 'Previous month' : 'Previous year'}
                disabled={pageIndex >= pages.length - 1}
                onClick={() => setPageIndex((i) => Math.min(i + 1, pages.length - 1))}
              >
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
              <p className="report-calendar__year" aria-hidden="true">
                {pageLabel}
              </p>
              <button
                type="button"
                className="report-stepper__step"
                aria-label={period === 'day' ? 'Next month' : 'Next year'}
                disabled={pageIndex <= 0}
                onClick={() => setPageIndex((i) => Math.max(i - 1, 0))}
              >
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>

            {period === 'day' ? (
              // A month of days, Monday to Sunday — the weekday row is the only legend it needs.
              <div role="group" aria-label={pageLabel} className="report-calendar__daygrid">
                {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => (
                  <span key={d} className="report-calendar__weekday" aria-hidden="true">
                    {d}
                  </span>
                ))}
                {Array.from({ length: dayCells(page, starts).leading }, (_, i) => (
                  <span key={`lead-${i}`} aria-hidden="true" />
                ))}
                {dayCells(page, starts).cells.map(cell)}
              </div>
            ) : period === 'month' ? (
              <div role="group" aria-label={page} className="report-calendar__grid">
                {monthCells(page, starts).map(cell)}
              </div>
            ) : (
              <div role="group" aria-label={page} className="report-calendar__weeks">
                {weekCells(page, starts).map((row) => (
                  <div key={row.month} role="group" aria-label={row.month} className="report-calendar__row">
                    <p className="report-calendar__month" aria-hidden="true">
                      {row.month}
                    </p>
                    <div className="report-calendar__days">{row.cells.map(cell)}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="report-calendar__jumps">
              <button
                type="button"
                className="report-stepper__preset"
                disabled={latest === null || latest === selected}
                onClick={() => latest !== null && choose(latest)}
              >
                Latest
              </button>
              <button
                type="button"
                className="report-stepper__preset"
                disabled={!lastYearAvailable}
                aria-describedby={lastYearReason ? reasonId : undefined}
                title={lastYearReason ?? undefined}
                onClick={() => lastYearAvailable && lastYear !== null && choose(lastYear)}
              >
                Same {period} last year
              </button>
              {lastYearReason ? (
                <span id={reasonId} className="sr-only">
                  {lastYearReason}
                </span>
              ) : null}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
