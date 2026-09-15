import type { Section } from './useReportData';

/**
 * A part of the report that has not arrived, said where that part would be — RM-081.
 *
 * Loading is a `status` (polite: it is not news that a page is loading). A failure is an `alert`
 * that names what failed, says why in the database's own words, and offers Retry — because the
 * alternative, one error string at the top of the page that nothing ever cleared, left a kiosk
 * showing a failure from a period nobody was looking at any more.
 *
 * `quietWhileLoading` is for parts too small to announce, such as the demand ceiling: its absence
 * for half a second is not worth a line of text, and its failure still is.
 */
interface Props {
  section: Pick<Section<unknown>, 'status' | 'error' | 'retry'>;
  /** What this part is, in lower case: "the hourly charts". */
  what: string;
  quietWhileLoading?: boolean;
}

export function ReportSectionNote({ section, what, quietWhileLoading = false }: Props) {
  if (section.status === 'loading') {
    return quietWhileLoading ? null : (
      <p className="reports-note" role="status">
        Loading {what}…
      </p>
    );
  }

  if (section.status === 'error') {
    return (
      <div className="reports-note reports-note--error report-section-error" role="alert">
        <span>
          <strong>
            {what.charAt(0).toUpperCase()}
            {what.slice(1)} could not be loaded.
          </strong>{' '}
          {section.error}
        </span>
        <button type="button" className="report-retry-btn" onClick={section.retry}>
          Retry
        </button>
      </div>
    );
  }

  return null;
}
