import { useMemo } from 'react';
import { ReportTable, type ReportColumn } from './ReportTable';
import { NoteField } from './NoteField';
import { unusualDays, type DayFlag } from '@/lib/unusualDays';
import { useReportNotesStore } from '@/stores/reportNotesStore';

interface Day {
  local_day: string;
  energy_kwh: number | null;
  peak_power_w: number | null;
  usable_sample_count: number;
}

interface Props {
  days: readonly Day[];
  /** "September 2026". */
  label: string;
  /** No account to save under (a local sign-in), or no notes table: the notes show, and cannot be typed. */
  readOnly: boolean;
}

/** `local_day` can arrive as a timestamp; a note is keyed by the date. */
const dayOf = (d: Day) => d.local_day.slice(0, 10);

const FLAG_WORDS: Record<DayFlag, string> = { high: 'High', low: 'Low' };

/**
 * Energy per day, with a note for each day — RM-164. The operator asked (2026-10-27) for a place to write why
 * a day was low, high or unusual, so the report explains itself. Days well off the period's usual are marked
 * and their empty note asks why. The notes go into the exported document's day table too.
 */
export function DayNotesTable({ days, label, readOnly }: Props) {
  const flags = useMemo(() => unusualDays(days), [days]);
  const unavailable = useReportNotesStore((s) => s.unavailable);
  const locked = readOnly || unavailable !== null;

  const columns: ReportColumn<Day>[] = [
    { id: 'day', header: 'Day', cell: (d) => dayOf(d) },
    { id: 'kwh', header: 'Energy', unit: 'kWh', numeric: true, cell: (d) => (d.usable_sample_count > 0 && d.energy_kwh !== null ? d.energy_kwh.toFixed(2) : null) },
    { id: 'peak', header: 'Highest', unit: 'W', numeric: true, cell: (d) => (d.peak_power_w === null ? null : Math.round(d.peak_power_w).toString()) },
    {
      id: 'flag',
      header: 'Unusual',
      cell: (d) => (flags[dayOf(d)] ? <span className={`badge badge--${flags[dayOf(d)] === 'high' ? 'warn' : 'accent'}`}>{FLAG_WORDS[flags[dayOf(d)]]}</span> : ''),
    },
    {
      id: 'note',
      header: 'Notes',
      cell: (d) => (
        <NoteField
          kind="day"
          start={dayOf(d)}
          label={`Note for ${dayOf(d)}`}
          readOnly={locked}
          placeholder={flags[dayOf(d)] ? `Why was this day ${flags[dayOf(d)]}?` : 'Add a note'}
        />
      ),
    },
  ];

  return (
    <section className="report-day-notes" aria-label={`Notes for each day, ${label}`}>
      <h3 className="report-day-notes__title">Notes for each day</h3>
      <p className="reports-note">
        Write what happened on a day — an event, a holiday, a fault, the weather — so the report explains its highs and lows.
        Days well off the usual are marked. Notes are saved as you leave the field and appear in the exported document.
      </p>
      {unavailable ? <p className="reports-note" role="note">{unavailable}</p> : null}
      {readOnly && !unavailable ? <p className="reports-note" role="note">Sign in with an account to write notes.</p> : null}
      <ReportTable label={`Energy and notes per day, ${label}`} columns={columns} rows={days} rowKey={(d) => dayOf(d)} />
    </section>
  );
}
