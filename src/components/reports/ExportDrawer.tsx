import { useCallback, useId, useState } from 'react';
import { OverlayPanel } from '@/components/ui/OverlayPanel';
import { REPORT_SECTIONS, normaliseSections, type ReportSectionId } from '@/lib/reportSections';
import { useExportAction } from '@/lib/useExportAction';

/**
 * Choosing what to take away from a report — RM-083b.
 *
 * A format, and for the PDF the sections. Two sections are shown ticked and cannot be unticked —
 * coverage, and what the report does not say — each with the reason beside it (operator decision,
 * 2026-09-15): a document leaves the building, and those are the qualifiers every other figure in it
 * leans on. A CSV has no sections to choose; it holds one table, and the drawer says which.
 *
 * THE OUTCOME IS SAID HERE, beside the button that caused it, not in the page header where the old
 * PDF button put its error. The press is guarded against a second one by `useExportAction`.
 *
 * The last choice is remembered for this viewer in `localStorage`, under try/catch like every other
 * use of it in this app: a private window or a locked-down kiosk throws on access, and a convenience
 * must never be the reason an export cannot be made.
 */

export type ExportFormat = 'pdf' | 'daily-csv' | 'device-csv';

const STORAGE_KEY = 'ibems.reportExport.v1';

const FORMATS: readonly { id: ExportFormat; label: string; hint: string }[] = [
  { id: 'pdf', label: 'PDF document', hint: 'The report as a paged document, with the sections chosen below.' },
  {
    id: 'daily-csv',
    label: 'Simple CSV',
    hint: 'One row per day: energy, peak demand, readings coverage and whether the day was complete — with cost and emissions once a rate or factor has been entered.',
  },
  {
    id: 'device-csv',
    label: 'Per-device CSV',
    hint: 'One row per device: its branch, energy, share of the building, peak and average power, and coverage.',
  },
];

interface Choice {
  format: ExportFormat;
  sections: ReportSectionId[];
}

const ALL_SECTIONS = REPORT_SECTIONS.map((s) => s.id);

function loadChoice(): Choice {
  const fallback: Choice = { format: 'pdf', sections: ALL_SECTIONS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as { format?: unknown; sections?: unknown };
    const format = FORMATS.find((f) => f.id === parsed.format)?.id ?? 'pdf';
    // A remembered choice from an older build may name sections this one does not have.
    const sections = Array.isArray(parsed.sections)
      ? normaliseSections(parsed.sections.filter((s): s is string => typeof s === 'string'))
      : ALL_SECTIONS;
    return { format, sections };
  } catch {
    return fallback;
  }
}

function saveChoice(choice: Choice) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
  } catch {
    // A per-viewer convenience. Losing it costs one re-tick next time, and nothing else.
  }
}

interface Props {
  periodLabel: string;
  onClose: () => void;
  /** Performs the export and resolves with what was saved, in words. */
  onExport: (format: ExportFormat, sections: ReportSectionId[]) => Promise<string>;
  /** Formats that cannot run for this period, each with the reason. */
  unavailable?: Partial<Record<ExportFormat, string>>;
}

export function ExportDrawer({ periodLabel, onClose, onExport, unavailable = {} }: Props) {
  const [choice, setChoice] = useState<Choice>(loadChoice);
  const baseId = useId();

  const update = (next: Choice) => {
    setChoice(next);
    saveChoice(next);
  };

  // A remembered format that cannot run for this period gives way to the first one that can.
  const format: ExportFormat = unavailable[choice.format] ? (FORMATS.find((f) => !unavailable[f.id])?.id ?? choice.format) : choice.format;
  const chosen = new Set<ReportSectionId>(choice.sections);
  const blockedReason = unavailable[format];

  const run = useCallback(() => onExport(format, normaliseSections(choice.sections)), [onExport, format, choice.sections]);
  const { state, start } = useExportAction(run);
  const working = state.status === 'working';

  const toggle = (id: ReportSectionId) =>
    update({
      ...choice,
      sections: chosen.has(id) ? choice.sections.filter((s) => s !== id) : normaliseSections([...choice.sections, id]),
    });

  const hint = FORMATS.find((f) => f.id === format)?.hint;

  return (
    <OverlayPanel title={`Export ${periodLabel}`} onClose={onClose} className="report-export-panel">
      <fieldset className="report-export__group">
        <legend className="report-export__legend">Format</legend>
        {FORMATS.map((f) => {
          const reason = unavailable[f.id];
          const labelId = `${baseId}-${f.id}-label`;
          const reasonId = `${baseId}-${f.id}-reason`;
          return (
            <div key={f.id} className="report-export__item">
              <label className="report-export__option">
                <input
                  type="radio"
                  name={`${baseId}-format`}
                  value={f.id}
                  checked={format === f.id}
                  disabled={reason !== undefined || working}
                  aria-labelledby={labelId}
                  aria-describedby={reason ? reasonId : undefined}
                  onChange={() => update({ ...choice, format: f.id })}
                />
                <span id={labelId}>{f.label}</span>
              </label>
              {reason ? (
                <span id={reasonId} className="report-export__reason">
                  {reason}
                </span>
              ) : null}
            </div>
          );
        })}
      </fieldset>

      {hint ? <p className="report-export__hint">{hint}</p> : null}

      {format === 'pdf' ? (
        <fieldset className="report-export__group">
          <legend className="report-export__legend">Sections</legend>
          <ul className="report-export__sections">
            {REPORT_SECTIONS.map((s) => {
              const lockedId = `${baseId}-${s.id}-locked`;
              return (
                <li key={s.id} className="report-export__item">
                  <label className="report-export__option">
                    <input
                      type="checkbox"
                      checked={s.locked !== undefined || chosen.has(s.id)}
                      disabled={s.locked !== undefined || working}
                      aria-describedby={s.locked ? lockedId : undefined}
                      onChange={() => toggle(s.id)}
                    />
                    <span>{s.label}</span>
                  </label>
                  {s.locked ? (
                    <span id={lockedId} className="report-export__reason">
                      {s.locked}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </fieldset>
      ) : null}

      <div className="report-export__actions">
        <p className="report-export__summary">
          {periodLabel} ·{' '}
          {format === 'pdf' ? `${normaliseSections(choice.sections).length} sections · PDF` : FORMATS.find((f) => f.id === format)?.label}
        </p>
        <button
          type="button"
          className="devices-add-btn"
          onClick={start}
          disabled={working || blockedReason !== undefined}
          aria-busy={working || undefined}
        >
          {working ? 'Preparing…' : format === 'pdf' ? 'Generate PDF' : 'Download CSV'}
        </button>
      </div>

      {state.status === 'done' ? (
        <p className="reports-note" role="status">
          {state.message}
        </p>
      ) : null}
      {state.status === 'error' ? (
        <p className="reports-note reports-note--error" role="alert">
          The export could not be completed: {state.message}
        </p>
      ) : null}
    </OverlayPanel>
  );
}
