import type { ReportPeriod } from './supabaseReports';

/**
 * What an exported report file is called — RM-083.
 *
 * The PDF used to take its name from the on-screen label, which is spelled by the reader's locale:
 * `week-of-jul-6,-2026` in en-US, a comma in a filename, and a different name for the same week on
 * a machine set to another language. The CSV used ISO dates. Now every export is named from the
 * period's own date, which sorts correctly in a downloads folder and cannot vary by who exported it.
 *
 * A MONTH IS ITS YEAR AND MONTH; A WEEK IS ITS WHOLE MONDAY, because several weeks share a month
 * and would overwrite each other. The per-device CSV keeps the name it has always had, so last
 * month's export files beside this month's; the daily CSV is suffixed so the two cannot collide.
 */

export type ReportFileKind = 'report' | 'daily' | 'devices';

export function reportFilename(period: ReportPeriod, start: string, kind: ReportFileKind, ext: 'pdf' | 'csv'): string {
  // Digits and hyphens only: whatever else reached here is not part of a date.
  const day = start.slice(0, 10).replace(/[^0-9-]/g, '');
  const stamp = period === 'week' ? day : day.slice(0, 7);
  const suffix = kind === 'daily' ? '-daily' : '';
  return `ibems-${period}-report-${stamp}${suffix}.${ext}`;
}
