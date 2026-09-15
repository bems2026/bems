import { useId, type ReactNode } from 'react';
import { Tabs, type TabDef } from '@/components/ui/Tabs';
import type { ReportPeriod } from '@/lib/supabaseReports';
import type { BranchOption } from '@/lib/circuitBreakdown';
import { PeriodPicker } from './PeriodPicker';

/**
 * Every control that decides what the report shows, in one row that stays in reach — RM-082b.
 *
 * They were in three places: the report tabs and both exports in the page header, the
 * Monthly/Weekly buttons on a row of their own, and the period pills on another. So the first
 * thing a reader met was three rows of chrome before a single figure, and the export buttons sat
 * a screen away from what they exported. One bar now, left to right in the order a reader decides:
 * what kind of period, which one, which part of the building, which reading of it, and what to take
 * away.
 *
 * STICKY WHERE THERE IS ROOM, because the report is long — five charts and a table — and changing
 * the period from the bottom of it should not mean scrolling back to the top. It sits under the nav,
 * measured rather than assumed (`--nav-h-live`), and only on screens wider than 640px and at least
 * 720px tall (RM-082d). Measured on the kiosk's 1024x600 it was 117px under a 73px nav — a third of
 * the screen covered for the whole report — and on a phone it wraps onto several lines.
 */

interface Props {
  period: ReportPeriod;
  onPeriodChange: (period: ReportPeriod) => void;
  /** Stored period starts, newest first. */
  starts: readonly string[];
  selected: string | null;
  onSelect: (start: string) => void;
  /**
   * RM-082c: the branch circuits the per-device figures can be narrowed to, the one chosen (`null`
   * for the whole building), and how to change it. Offered only when there are two or more — a
   * building on one branch has nothing to narrow.
   */
  branches?: readonly BranchOption[];
  scope?: string | null;
  onScopeChange?: (id: string | null) => void;
  tabs: TabDef[];
  tab: string;
  onTabChange: (id: string) => void;
  actions?: ReactNode;
}

export function ReportControlBar({
  period,
  onPeriodChange,
  starts,
  selected,
  onSelect,
  branches = [],
  scope = null,
  onScopeChange,
  tabs,
  tab,
  onTabChange,
  actions,
}: Props) {
  const scopeId = useId();

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

      {/* A select rather than buttons: one per branch is a row that grows with the panel, and a second
          site's panel is not this one's. The same control, and so the same touch floor, as the period
          select it sits beside. */}
      {branches.length > 1 && onScopeChange ? (
        <div className="reports-picker">
          <label className="reports-picker__label" htmlFor={scopeId}>
            Circuit
          </label>
          <select
            id={scopeId}
            className="reports-picker__select"
            value={scope ?? ''}
            onChange={(e) => onScopeChange(e.target.value === '' ? null : e.target.value)}
          >
            <option value="">All circuits</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <Tabs tabs={tabs} activeId={tab} onChange={onTabChange} label="Report type" className="reports-tabs" />

      {actions ? <div className="report-controls__actions">{actions}</div> : null}
    </div>
  );
}
