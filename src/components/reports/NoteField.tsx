import { useState } from 'react';
import { noteKey, useReportNotesStore } from '@/stores/reportNotesStore';
import type { NoteKind } from '@/lib/supabaseReportNotes';

interface Props {
  kind: NoteKind;
  start: string;
  /** The field's accessible name: "Note for 2026-09-23". */
  label: string;
  placeholder?: string;
  multiline?: boolean;
  readOnly?: boolean;
}

/**
 * One note on the Reports page — RM-164. Typed in place, saved when the field is left (or on Enter, for a
 * one-line note), and says beside itself whether it saved. A failed save keeps the text and offers to try
 * again, so a slow link loses nothing.
 */
export function NoteField({ kind, start, label, placeholder, multiline = false, readOnly = false }: Props) {
  const key = noteKey(kind, start);
  const stored = useReportNotesStore((s) => s.notes[key] ?? '');
  const state = useReportNotesStore((s) => s.saveState[key]);
  const save = useReportNotesStore((s) => s.save);
  // What is being typed, or null when nobody is typing: then the field shows the stored note, so a note loaded
  // or saved elsewhere appears, and a failed save still shows the text it kept.
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? stored;

  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    void save(kind, start, draft);
  };

  const common = {
    className: `report-note-field__input${multiline ? ' report-note-field__input--multi' : ''}`,
    'aria-label': label,
    value: text,
    placeholder: readOnly ? '' : placeholder,
    readOnly,
    maxLength: 2000,
    onFocus: () => setDraft(stored),
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: commit,
  };

  return (
    <span className="report-note-field">
      {multiline ? (
        <textarea {...common} rows={3} />
      ) : (
        <input
          {...common}
          type="text"
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      )}
      {state === 'saving' ? <span className="report-note-field__state" role="status">Saving…</span> : null}
      {state === 'saved' ? <span className="report-note-field__state" role="status">Saved</span> : null}
      {state === 'failed' ? (
        <span className="report-note-field__state report-note-field__state--failed" role="alert">
          Not saved.{' '}
          <button type="button" className="report-retry-btn" onClick={() => void save(kind, start, text)}>
            Try again
          </button>
        </span>
      ) : null}
    </span>
  );
}
