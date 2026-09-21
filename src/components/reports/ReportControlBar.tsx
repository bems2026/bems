import type { ReactNode } from 'react';
import { PERIOD_ADJECTIVE, type ReportPeriod } from '@/lib/supabaseReports';
import type { ScopeOption } from '@/lib/circuitBreakdown';
import { PeriodPicker } from './PeriodPicker';
import { ScopePicker } from './ScopePicker';

/**
 * Every control that decides WHAT the report shows, in one row that stays in reach — RM-082b, cut
 * to one line by RM-101.
 *
 * They were in three places: the report tabs and both exports in the page header, the
 * Monthly/Weekly buttons on a row of their own, and the period pills on another. So the first
 * thing a reader met was three rows of chrome before a single figure, and the export buttons sat
 * a screen away from what they exported. One bar now, left to right in the order a reader decides:
 * what kind of period, which one, which part of the building, and what to take away.
 *
 * THE TABS ARE NOT HERE. RM-082b put them in this bar with a labelled select and two preset jumps,
 * and on the kiosk — which is 800x480, not the 1024x600 RM-082d measured against — that bar wrapped
 * to three lines and could not be sticky. The tabs decide the READING of a report, not the report;
 * they sit in a strip of their own beneath this bar. The presets moved into the period picker and the
 * select became one button (`ScopePicker`), so at 800px the bar is one line.
 *
 * STICKY WHERE THERE IS ROOM, because the report is long — five charts and a table — and changing
 * the period from the bottom of it should not mean scrolling back to the top. It sits under the nav,
 * measured rather than assumed (`--nav-h-live`), on screens wider than 640px and at least 720px tall
 * (RM-082d). Re-measured for RM-101: one line, 58px at 800px wide — with the 73px nav that is still
 * 27% of the kiosk's 480px, so the threshold stays and the kiosk scrolls to the bar.
 */

interface Props {
  period: ReportPeriod;
  onPeriodChange: (period: ReportPeriod) => void;
  /** Stored period starts, newest first. */
  starts: readonly string[];
  selected: string | null;
  onSelect: (start: string) => void;
  /**
   * What the report can be narrowed to — RM-082c for one branch, RM-093 for a category of load — the
   * encoded value chosen (`all` for the whole building), and how to change it. Offered only when there
   * are two or more branches: a building on one branch has nothing to narrow.
   */
  scopes?: readonly ScopeOption[];
  scope?: string;
  onScopeChange?: (value: string) => void;
  actions?: ReactNode;
}

export function ReportControlBar({
  period,
  onPeriodChange,
  starts,
  selected,
  onSelect,
  scopes = [],
  scope = 'all',
  onScopeChange,
  actions,
}: Props) {
  return (
    <div className="report-controls">
      {/* Day, week or month — RM-041, RM-124. Buttons rather than a select: there are exactly three,
          and a select would hide two of them behind a click. Shortest period first, as a calendar reads. */}
      <div className="reports-periods" role="group" aria-label="Report period">
        {(['day', 'week', 'month'] as const).map((p) => (
          <button
            key={p}
            type="button"
            className={`analytics-scope-btn${period === p ? ' analytics-scope-btn--active' : ''}`}
            aria-pressed={period === p}
            onClick={() => onPeriodChange(p)}
          >
            {PERIOD_ADJECTIVE[p]}
          </button>
        ))}
      </div>

      {starts.length > 0 ? <PeriodPicker period={period} starts={starts} selected={selected} onSelect={onSelect} /> : null}

      {/* RM-102: one button, and behind it the uses as pills and the branches as a list. Offered only
          when there are two or more branches: a building on one branch has nothing to narrow. */}
      {scopes.filter((s) => s.group === 'circuit').length > 1 && onScopeChange ? (
        <ScopePicker scopes={scopes} scope={scope} onChange={onScopeChange} />
      ) : null}

      {actions ? <div className="report-controls__actions">{actions}</div> : null}
    </div>
  );
}
