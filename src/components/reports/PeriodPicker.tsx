import { formatPeriod, type ReportPeriod } from '@/lib/supabaseReports';

/**
 * Choosing which week or month to read.
 *
 * RM-041 shipped a row of pill buttons, and for the two months that existed then it was the
 * right affordance — everything visible, one tap, no menu to open. It does not survive its own
 * query: `getReportPeriods` fetches up to 240 months or **520 weeks**, and a row of 520 buttons
 * is not a picker.
 *
 * So the buttons stay while they work and a select takes over when they would stop. The
 * threshold is not a guess about screen width — it is the point past which the row wraps to a
 * third line on the kiosk, which is the same measurement RM-071 made when the Devices toolbar
 * needed 1123px on one line.
 */

/** Above this many periods the row wraps past two lines on the kiosk and a menu is kinder. */
export const MAX_PILLS = 14;

interface Props {
  period: ReportPeriod;
  /** Period start dates, newest first — the order `getReportPeriods` returns. */
  starts: readonly string[];
  selected: string | null;
  onSelect: (start: string) => void;
}

export function PeriodPicker({ period, starts, selected, onSelect }: Props) {
  const label = period === 'week' ? 'Report week' : 'Report month';

  if (starts.length <= MAX_PILLS) {
    return (
      <div className="reports-months" role="group" aria-label={label}>
        {starts.map((start) => (
          <button
            key={start}
            type="button"
            className={`analytics-scope-btn${selected === start ? ' analytics-scope-btn--active' : ''}`}
            aria-pressed={selected === start}
            onClick={() => onSelect(start)}
          >
            {formatPeriod(period, start)}
          </button>
        ))}
      </div>
    );
  }

  // Grouped by year, because "which week was that" is a question people answer year-first, and
  // an ungrouped list of 520 dates makes the reader do the grouping.
  const byYear = new Map<string, string[]>();
  for (const start of starts) {
    const year = start.slice(0, 4);
    byYear.set(year, [...(byYear.get(year) ?? []), start]);
  }

  return (
    <div className="reports-months">
      <label className="reports-picker">
        <span className="reports-picker__label">{label}</span>
        <select
          className="reports-picker__select"
          value={selected ?? ''}
          onChange={(e) => onSelect(e.target.value)}
        >
          {[...byYear.entries()].map(([year, group]) => (
            <optgroup key={year} label={year}>
              {group.map((start) => (
                <option key={start} value={start}>
                  {formatPeriod(period, start)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
    </div>
  );
}
