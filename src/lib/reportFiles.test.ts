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

  it('gives the per-device-per-day and every-reading files their own names — RM-098', () => {
    expect(reportFilename('week', '2026-09-07', 'devices-daily', 'csv')).toBe('ibems-week-report-2026-09-07-devices-daily.csv');
    expect(reportFilename('month', '2026-09-01', 'readings', 'csv', 'Lighting')).toBe('ibems-month-report-2026-09-readings-lighting.csv');
  });

  it('names a per-device CSV narrowed to one branch for that branch — RM-082c', () => {
    // So a branch's export cannot overwrite the whole building's in the same downloads folder.
    expect(reportFilename('month', '2026-08-01', 'devices', 'csv', 'East Wing Sockets')).toBe('ibems-month-report-2026-08-east-wing-sockets.csv');
  });

  it('spells a branch name so it cannot break the filename, and drops one with nothing sayable in it', () => {
    // A circuit name is operator-edited text.
    expect(reportFilename('week', '2026-07-06', 'devices', 'csv', '../East / Main,  West')).toBe('ibems-week-report-2026-07-06-east-main-west.csv');
    expect(reportFilename('month', '2026-08-01', 'devices', 'csv', ' ./ ')).toBe('ibems-month-report-2026-08.csv');
    expect(reportFilename('month', '2026-08-01', 'devices', 'csv', null)).toBe('ibems-month-report-2026-08.csv');
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

describe('reportFilename for a day — RM-124', () => {
  it('stamps a day with its full date, like a week', () => {
    expect(reportFilename('day', '2026-09-19', 'report', 'pdf')).toBe('ibems-day-report-2026-09-19.pdf');
  });
});
