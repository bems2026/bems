import { describe, it, expect } from 'vitest';
import { reportFilename } from './reportFiles';

/**
 * RM-083. The PDF was named from the on-screen label — `week-of-jul-6,-2026` in en-US, a comma in a
 * filename and a date spelled by the reader's locale — while the CSV used ISO dates. One report,
 * two naming schemes, and neither sortable against the other in a downloads folder.
 */

describe('reportFilename', () => {
  it('names a month by its year and month', () => {
    expect(reportFilename('month', '2026-08-01', 'report', 'pdf')).toBe('ibems-month-report-2026-08.pdf');
  });

  it('names a week by its whole Monday, because several weeks share a month', () => {
    expect(reportFilename('week', '2026-08-31', 'report', 'pdf')).toBe('ibems-week-report-2026-08-31.pdf');
  });

  it('keeps the per-device CSV on the name it has always had', () => {
    // Anyone who filed last month's export by name should find this month's beside it.
    expect(reportFilename('week', '2026-07-06', 'devices', 'csv')).toBe('ibems-week-report-2026-07-06.csv');
  });

  it('suffixes the daily CSV, so it cannot overwrite the per-device one', () => {
    expect(reportFilename('month', '2026-08-01', 'daily', 'csv')).toBe('ibems-month-report-2026-08-daily.csv');
  });

  it('never carries a space, a comma, or a date spelled by the reader’s locale', () => {
    const names = [
      reportFilename('week', '2026-07-06', 'report', 'pdf'),
      reportFilename('month', '2026-12-01', 'daily', 'csv'),
      reportFilename('month', '2026-12-01T00:00:00+00:00', 'devices', 'csv'),
    ];
    for (const name of names) expect(name).toMatch(/^[a-z0-9.-]+$/);
  });
});
