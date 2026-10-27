import { NoteField } from './NoteField';
import { useReportNotesStore } from '@/stores/reportNotesStore';
import type { NoteKind } from '@/lib/supabaseReportNotes';

interface Props {
  kind: NoteKind;
  start: string;
  label: string;
  readOnly: boolean;
}

/**
 * The report's own remarks — RM-164: a summary, what happened, what was done. Saved with the period and
 * printed near the top of the exported document, under "Notes for this report".
 */
export function ReportNotesBox({ kind, start, label, readOnly }: Props) {
  const unavailable = useReportNotesStore((s) => s.unavailable);
  return (
    <section className="report-notes-box" aria-label={`Notes for this report, ${label}`}>
      <h3 className="report-day-notes__title">Notes for this report</h3>
      <NoteField
        kind={kind}
        start={start}
        label={`Notes for this report, ${label}`}
        multiline
        readOnly={readOnly || unavailable !== null}
        placeholder="A summary, events this period, actions taken — printed near the top of the document."
      />
    </section>
  );
}
