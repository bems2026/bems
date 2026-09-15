import { useCallback, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAnchoredPopover } from '@/components/ui/useAnchoredPopover';
import { formatPeriod, type ReportPeriod } from '@/lib/supabaseReports';
import { sameStartLastYear } from '@/lib/reportPeriods';

/**
 * Choosing which week or month to read — a stepper since RM-082b.
 *
 * RM-041 shipped a row of pill buttons, right for the two months that existed then, and RM-072m
 * added a select for when the row would run past two lines — `getReportPeriods` fetches up to 240
 * months or 520 weeks. Both sat on a line of their own below two other rows of controls. This is
 * the period being read with the report before and after it, the full list one click behind the
 * label, and the two jumps a reader actually makes: back to the latest report, and to the same
 * period a year earlier.
 *
 * IT STEPS THROUGH STORED REPORTS, NOT THE CALENDAR. The list can have holes, and "previous"
 * landing on a period with no report would render an empty page that looks like a period with no
 * consumption. Previous is the previous REPORT.
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
  const { anchorRef, popRef, style } = useAnchoredPopover({
    open,
    onDismiss: dismiss,
    preferredWidth: 280,
    fallbackHeight: 320,
    preferredMaxHeight: 360,
  });
  const reasonId = useId();

  const label = period === 'week' ? 'Report week' : 'Report month';
  const index = selected === null ? -1 : starts.indexOf(selected);
  const newer = index > 0 ? starts[index - 1] : null;
  const older = index >= 0 && index < starts.length - 1 ? starts[index + 1] : null;
  const latest = starts[0] ?? null;
  const lastYear = selected === null ? null : sameStartLastYear(period, selected);
  const lastYearAvailable = lastYear !== null && starts.includes(lastYear);
  const lastYearReason = lastYear !== null && !lastYearAvailable ? `No report for ${formatPeriod(period, lastYear)}` : null;

  // Grouped by year, because "which week was that" is a question people answer year-first, and an
  // ungrouped list of 520 dates makes the reader do the grouping.
  const byYear = new Map<string, string[]>();
  for (const start of starts) {
    const year = start.slice(0, 4);
    byYear.set(year, [...(byYear.get(year) ?? []), start]);
  }

  const choose = (start: string) => {
    onSelect(start);
    setOpen(false);
  };

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
        onClick={() => setOpen((o) => !o)}
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

      <button
        type="button"
        className="report-stepper__preset"
        disabled={latest === null || latest === selected}
        onClick={() => latest !== null && onSelect(latest)}
      >
        Latest
      </button>
      <button
        type="button"
        className="report-stepper__preset"
        disabled={!lastYearAvailable}
        aria-describedby={lastYearReason ? reasonId : undefined}
        title={lastYearReason ?? undefined}
        onClick={() => lastYearAvailable && lastYear !== null && onSelect(lastYear)}
      >
        Same {period} last year
      </button>
      {lastYearReason ? (
        <span id={reasonId} className="sr-only">
          {lastYearReason}
        </span>
      ) : null}

      {open &&
        createPortal(
          <div
            ref={popRef as React.RefObject<HTMLDivElement>}
            className="report-period-list"
            role="dialog"
            aria-label={`Choose a ${label.toLowerCase()}`}
            style={style}
          >
            {[...byYear.entries()].map(([year, group]) => (
              <div key={year} role="group" aria-label={year} className="report-period-list__year">
                <p className="report-period-list__heading" aria-hidden="true">
                  {year}
                </p>
                {group.map((start) => (
                  <button
                    key={start}
                    type="button"
                    className={`report-period-list__item${start === selected ? ' report-period-list__item--current' : ''}`}
                    aria-current={start === selected ? 'true' : undefined}
                    onClick={() => choose(start)}
                  >
                    {formatPeriod(period, start)}
                  </button>
                ))}
              </div>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
