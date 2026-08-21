/**
 * CSV serialization for the report downloads — RFC 4180, no dependency.
 *
 * A dozen lines of `fetch`-era JavaScript rather than a library, matching the reasoning
 * `server/supabaseRest.mjs` records for hand-rolling its Supabase client: this does one
 * thing, the standard is short, and the failure modes below are ones a general-purpose
 * library would not necessarily handle the way this project needs them handled.
 */

export interface CsvColumn<T> {
  key: keyof T & string;
  header: string;
}

/**
 * A spreadsheet evaluates any cell whose text begins with `=`, `+`, `-` or `@` as a formula.
 * Report rows carry operator-editable device names (`src/lib/deviceConfig.ts`), so a display
 * name of `=HYPERLINK(...)` would execute on open. Prefixing an apostrophe is the standard
 * neutralisation and is invisible in the rendered cell.
 *
 * Data from our own database is still not trusted input — a person typed it.
 */
function neutralise(text: string): string {
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function escapeCell(value: unknown): string {
  // Missing renders as empty, never as 0 — the same rule `src/lib/format.ts` holds for the
  // UI. A spreadsheet showing 0 kWh for a month nobody measured is a lie that then sums.
  if (value === null || value === undefined) return '';
  const text = neutralise(String(value));
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Pure. Serializes `rows` as CSV with a header row, CRLF-separated per RFC 4180 (which is
 * also what Excel expects). Returns just the header row when `rows` is empty. */
export function toCsv<T extends object>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines = [columns.map((c) => escapeCell(c.header)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => escapeCell(row[c.key])).join(','));
  }
  return lines.join('\r\n');
}

/**
 * Hands the CSV to the browser as a download.
 *
 * The BOM is deliberate: without it Excel decodes UTF-8 as the system codepage, and every
 * non-ASCII character in a device name arrives mangled.
 *
 * Not pure and not unit-tested — it is three DOM calls with no branching. `toCsv` holds
 * everything worth asserting on.
 */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
