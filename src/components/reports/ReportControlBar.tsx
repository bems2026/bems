import type { ReactNode } from 'react';
import { Tabs, type TabDef } from '@/components/ui/Tabs';
import type { ReportPeriod } from '@/lib/supabaseReports';
import { PeriodPicker } from './PeriodPicker';

/**
 * Every control that decides what the report shows, in one row that stays in reach — RM-082b.
 *
 * They were in three places: the report tabs and both exports in the page header, the
 * Monthly/Weekly buttons on a row of their own, and the period pills on another. So the first
 * thing a reader met was three rows of chrome before a single figure, and the export buttons sat
 * a screen away from what they exported. One bar now, left to right in the order a reader decides:
 * what kind of period, which one, which reading of it, and what to take away.
 *
 * STICKY, because the report is long — five charts and a table — and changing the period from the
 * bottom of it should not mean scrolling back to the top. It sits under the nav, measured rather
 * than assumed (`--nav-h-live`). Below 640px it stops being sticky: wrapped onto several lines it
 * would cover a third of a phone's screen for the whole report.
 */

interface Props {
  period: ReportPeriod;
  onPeriodChange: (period: ReportPeriod) => void;
  /** Stored period starts, newest first. */
  starts: readonly string[];
  selected: string | null;
  onSelect: (start: string) => void;
  tabs: TabDef[];
  tab: string;
  onTabChange: (id: string) => void;
  actions?: ReactNode;
}

export function ReportControlBar({ period, onPeriodChange, starts, selected, onSelect, tabs, tab, onTabChange, actions }: Props) {
  return (
    <div className="report-controls">
      {/* Week or month — RM-041. Two buttons rather than a select: there are exactly two, and a
          select would hide one of them behind a click. */}
      <div className="reports-periods" role="group" aria-label="Report period">
        {(['month', 'week'] as const).map((p) => (
          <button
            key={p}
            type="button"
            className={`analytics-scope-btn${period === p ? ' analytics-scope-btn--active' : ''}`}
            aria-pressed={period === p}
            onClick={() => onPeriodChange(p)}
          >
            {p === 'month' ? 'Monthly' : 'Weekly'}
          </button>
        ))}
      </div>

      {starts.length > 0 ? <PeriodPicker period={period} starts={starts} selected={selected} onSelect={onSelect} /> : null}

      <Tabs tabs={tabs} activeId={tab} onChange={onTabChange} label="Report type" className="reports-tabs" />

      {actions ? <div className="report-controls__actions">{actions}</div> : null}
    </div>
  );
}
