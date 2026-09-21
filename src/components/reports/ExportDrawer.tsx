import { Check } from 'lucide-react';
import { useCallback, useId, useState } from 'react';
import { OverlayPanel } from '@/components/ui/OverlayPanel';
import { REPORT_SECTIONS, normaliseSections, sectionsFor, type ReportDetail, type ReportSectionId } from '@/lib/reportSections';
import type { ReportPeriod } from '@/lib/supabaseReports';
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
 *
 * A NARROWED PAGE NARROWS ONE EXPORT — RM-082c. The per-device CSV follows the circuit scope; the PDF
 * and the simple CSV are the building's series and cannot. Both are said here, before anything is
 * generated, so nobody files a whole-building PDF believing it is one branch's.
 */

export type ExportFormat = 'pdf' | 'daily-csv' | 'device-csv' | 'device-daily-csv' | 'readings-csv';

/** Which formats follow the part of the building the page is narrowed to. */
const FOLLOWS_SCOPE: readonly ExportFormat[] = ['device-csv', 'device-daily-csv', 'readings-csv'];

const STORAGE_KEY = 'ibems.reportExport.v1';

const FORMATS: readonly { id: ExportFormat; label: string; hint: string }[] = [
  { id: 'pdf', label: 'PDF document', hint: 'The report as a document, with the sections chosen below.' },
  {
    id: 'daily-csv',
    label: 'Building by day (CSV)',
    hint: 'One row per day for the whole building: energy, highest demand, how much was recorded — with cost and emissions once a rate or factor has been entered.',
  },
  {
    id: 'device-csv',
    label: 'Devices, whole period (CSV)',
    hint: 'One row per device: its circuit, energy, share of the building, highest and average power, and how much was recorded.',
  },
  {
    id: 'device-daily-csv',
    label: 'Devices by day (CSV)',
    hint: 'One row per device per day: energy, highest and average power, and minutes recorded — with any counter jump that was not counted.',
  },
  {
    id: 'readings-csv',
    label: 'Every reading (CSV)',
    hint: 'Every reading each device took: time, voltage, current, power and its energy counter. Older hours are hourly averages. A month is a large file and takes a while.',
  },
];

interface Choice {
  format: ExportFormat;
  sections: ReportSectionId[];
  /** RM-099: a Simple PDF (figures and charts) or a Detailed one (every table too). */
  detail: ReportDetail;
}

const ALL_SECTIONS = REPORT_SECTIONS.map((s) => s.id);

function loadChoice(): Choice {
  // A first export is the Simple one: the operator asked for a report most people can read at a glance.
  const fallback: Choice = { format: 'pdf', sections: ALL_SECTIONS, detail: 'simple' };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as { format?: unknown; sections?: unknown; detail?: unknown };
    const format = FORMATS.find((f) => f.id === parsed.format)?.id ?? 'pdf';
    // A remembered choice from an older build may name sections this one does not have.
    const sections = Array.isArray(parsed.sections)
      ? normaliseSections(parsed.sections.filter((s): s is string => typeof s === 'string'))
      : ALL_SECTIONS;
    // A choice remembered from before RM-099 made the full document, which is what Detailed is.
    const detail: ReportDetail = parsed.detail === 'simple' || parsed.detail === 'detailed' ? parsed.detail : 'detailed';
    return { format, sections, detail };
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
  /** RM-124: which sections a document of this kind of period can hold. A month when absent. */
  period?: ReportPeriod;
  onClose: () => void;
  /** Performs the export and resolves with what was saved, in words. */
  onExport: (
    format: ExportFormat,
    sections: ReportSectionId[],
    report: (progress: string) => void,
    signal: AbortSignal,
    detail: ReportDetail
  ) => Promise<string>;
  /** Formats that cannot run for this period, each with the reason. */
  unavailable?: Partial<Record<ExportFormat, string>>;
  /** A word under a section, such as a chart whose data could not be loaded and will be left out. */
  sectionNotes?: Partial<Record<ReportSectionId, string>>;
  /** The branch circuit the page is narrowed to, when it is — RM-082c. */
  scopeLabel?: string | null;
}

export function ExportDrawer({ periodLabel, period = 'month', onClose, onExport, unavailable = {}, sectionNotes = {}, scopeLabel = null }: Props) {
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

  const run = useCallback(
    (report: (progress: string) => void, signal: AbortSignal) =>
      onExport(format, normaliseSections(choice.sections, choice.detail, period), report, signal, choice.detail),
    [onExport, format, choice.sections, choice.detail, period]
  );
  const { state, start, cancel } = useExportAction(run);
  const working = state.status === 'working';

  const toggle = (id: ReportSectionId) =>
    update({
      ...choice,
      // Kept across both depths, so a section ticked for Detailed is still ticked when a reader comes back to it.
      sections: chosen.has(id) ? choice.sections.filter((s) => s !== id) : [...new Set([...choice.sections, id])],
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
      {scopeLabel ? (
        <p className="report-export__hint">
          {format === 'device-csv'
            ? `Only ${scopeLabel}; each share is still of the whole building.`
            : FOLLOWS_SCOPE.includes(format)
              ? `Only ${scopeLabel}.`
              : format === 'pdf'
                ? `The circuit sections follow ${scopeLabel}; the building’s own charts stay the whole building, and say so.`
                : `The whole building — the ${scopeLabel} choice applies to the device CSVs only.`}
        </p>
      ) : null}

      {format === 'pdf' ? (
        <div className="report-export__group" role="group" aria-label="How much detail">
          <span className="report-export__legend">How much detail</span>
          <div className="report-chips">
            {(['simple', 'detailed'] as const).map((d) => (
              <button
                key={d}
                type="button"
                className={`analytics-scope-btn${choice.detail === d ? ' analytics-scope-btn--active' : ''}`}
                aria-pressed={choice.detail === d}
                disabled={working}
                onClick={() => update({ ...choice, detail: d })}
              >
                {d === 'simple' ? 'Simple' : 'Detailed'}
              </button>
            ))}
          </div>
          <p className="report-export__hint">
            {choice.detail === 'simple'
              ? 'Key figures and charts, without the tables of numbers.'
              : 'Every chart with its numbers, every table, and the comparison.'}
          </p>
        </div>
      ) : null}

      {format === 'pdf' ? (
        <fieldset className="report-export__group">
          <legend className="report-export__legend">Sections</legend>
          <ul className="report-export__sections">
            {sectionsFor(choice.detail, period).map((s) => {
              // Why a section is locked, or what will happen to it — read to a screen reader with it.
              const note = s.locked ?? sectionNotes[s.id];
              const noteId = `${baseId}-${s.id}-note`;
              return (
                <li key={s.id} className="report-export__item">
                  <label className="report-export__option">
                    <input
                      type="checkbox"
                      checked={s.locked !== undefined || chosen.has(s.id)}
                      disabled={s.locked !== undefined || working}
                      aria-describedby={note ? noteId : undefined}
                      onChange={() => toggle(s.id)}
                    />
                    <span>{s.label}</span>
                  </label>
                  {note ? (
                    <span id={noteId} className="report-export__reason">
                      {note}
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
          {format === 'pdf'
            ? `${normaliseSections(choice.sections, choice.detail, period).length} sections · ${choice.detail === 'simple' ? 'Simple' : 'Detailed'} PDF`
            : FORMATS.find((f) => f.id === format)?.label}
          {FOLLOWS_SCOPE.includes(format) && scopeLabel ? ` · ${scopeLabel}` : ''}
        </p>
        <button
          type="button"
          className="report-primary-btn"
          onClick={start}
          disabled={working || blockedReason !== undefined}
          aria-busy={working || undefined}
        >
          {working ? 'Preparing…' : format === 'pdf' ? 'Generate PDF' : 'Download CSV'}
        </button>
      </div>

      {state.status === 'working' && state.progress ? (
        <p className="reports-note report-export__progress" role="status">
          {state.progress}{' '}
          <button type="button" className="report-retry-btn" onClick={cancel}>
            Cancel
          </button>
        </p>
      ) : null}
      {state.status === 'done' ? (
        <p className="reports-note report-export__done" role="status">
          <Check size={16} aria-hidden="true" />
          <span>{state.message}</span>
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
