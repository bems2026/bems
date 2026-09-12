import { COVERAGE_LEDE } from '@shared/reportProse.mjs';
import type { DemandSummary } from '@/lib/reportSeries';

/**
 * The report as a pdfmake document definition.
 *
 * THIS MODULE DOES NOT IMPORT PDFMAKE, and that is deliberate. The definition is a plain object,
 * so everything worth asserting about the document — that coverage precedes the figures it
 * qualifies, that every table repeats its header, that no currency appears while no tariff layer
 * exists — is checkable as a value, without rendering a byte and without pulling two megabytes
 * into a test run. `download.ts` is the only file that knows pdfmake exists.
 *
 * WHY A PDF IS HELD TO A HIGHER BAR THAN THE PAGE. The page can be re-read with a different
 * period selected, and its reader can hover a chart. A PDF leaves the building: it is attached
 * to an email, printed, and quoted in a report to the university months later. It is the one
 * rendering nobody can ask a follow-up question of, so every figure has to carry its
 * qualification with it rather than nearby.
 */

export interface PdfChart {
  title: string;
  /** Serialized against `PRINT_PALETTE` — paper is white whatever the kiosk's theme is. */
  svg: string;
  desc: string;
  table: { headers: readonly string[]; rows: readonly (readonly (string | null)[])[] };
}

export interface PdfDeviceRow {
  name: string;
  energyKwh: string | null;
  peakW: string | null;
  avgW: string | null;
  coverage: string;
}

export interface PdfReport {
  title: string;
  siteName: string;
  timezone: string;
  /** Already formatted in the building's own time by the caller — see `src/lib/siteTime.ts`. */
  generatedAt: string;
  periodLabel: string;
  /** The entry bundle's hashed filename, so a figure can be traced to the build that made it. */
  buildId: string | null;
  summary: DemandSummary | null;
  observedDays: number;
  completeDays: number;
  energyKwh: number | null;
  /** Already formatted by the caller, or null when no rate is entered. Never "0.00". */
  cost: { text: string; qualified: boolean } | null;
  carbon: { text: string; qualified: boolean } | null;
  /** One sentence per rate or factor used: the figure, the dates, the source, who entered it. */
  provenance: readonly string[];
  charts: readonly PdfChart[];
  deviceRows: readonly PdfDeviceRow[];
  caveats: readonly { lead: string; body: string }[];
}

/** A4 minus 40pt margins each side. Charts are generated at exactly this width. */
export const CONTENT_WIDTH = 515;

const EM_DASH = '—';
const n = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined || !Number.isFinite(v) ? EM_DASH : v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });

const RESOLUTION_NOTE: Record<string, string> = {
  minute: 'These figures are computed from minute-by-minute samples.',
  mixed:
    'These figures are computed partly from minute-by-minute samples and partly from hourly averages, because the raw rows for the older part of this period have been rolled up.',
  hour: 'These figures are computed from hourly averages only. The minute-by-minute rows behind this period have been rolled up, and an average cannot reach the peaks the samples had.',
};

export function buildDocDefinition(r: PdfReport) {
  const content: unknown[] = [];

  // --- cover ------------------------------------------------------------------------------
  content.push(
    { text: r.title, style: 'coverTitle' },
    { text: r.siteName, style: 'coverSite' },
    { text: r.periodLabel, style: 'coverPeriod' },
    {
      // The frame, said once and early. A PDF is read somewhere else, and a timestamp with no
      // frame is read in the reader's own — which for a building on the other side of the
      // world is a different day.
      text: `Generated ${r.generatedAt} (${r.timezone}). All times and dates in this document are the building's own, not the reader's.`,
      style: 'coverMeta',
    },
    r.buildId ? { text: `Built from ${r.buildId}`, style: 'coverMeta' } : { text: '' },
    { text: '', pageBreak: 'after' }
  );

  // --- coverage, before anything it qualifies ----------------------------------------------
  content.push({ text: 'Coverage', style: 'h2' }, { text: COVERAGE_LEDE, style: 'note' });

  if (r.summary) {
    const s = r.summary;
    const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : EM_DASH);
    content.push({
      table: {
        headerRows: 1,
        widths: ['*', 120],
        body: [
          [{ text: 'Measure', style: 'th' }, { text: 'Value', style: 'th' }],
          ['Minutes with a real reading', `${n(s.usable_minutes)} of ${n(s.expected_minutes)}  (${pct(s.usable_minutes, s.expected_minutes)})`],
          // Both figures, named. The gap between them is meters writing rows while observing
          // nothing — 9,415 of August 2026's. One number alone either overstates the coverage
          // or disagrees with the stored report.
          ['Minutes with a row of any kind', `${n(s.observed_minutes)}  (${pct(s.observed_minutes, s.expected_minutes)})`],
          [
            'Longest single gap',
            // Never 0: once the raw rows are pruned the gap is unmeasurable rather than absent,
            // and zero is the most reassuring possible way to report an outage.
            s.longest_gap_minutes === null ? `${EM_DASH} (not measurable)` : `${n(s.longest_gap_minutes)} min`,
          ],
          ['Days observed', `${r.observedDays} (${r.completeDays} of them complete)`],
        ],
      },
      layout: 'lightHorizontalLines',
      margin: [0, 6, 0, 6],
    });
    if (s.resolution && RESOLUTION_NOTE[s.resolution]) {
      content.push({ text: RESOLUTION_NOTE[s.resolution], style: 'note' });
    }
  } else {
    content.push({
      text: 'No coverage figures have been generated for this period, so nothing below can be qualified by them.',
      style: 'note',
    });
  }

  // --- headline ------------------------------------------------------------------------------
  content.push({ text: 'Energy', style: 'h2' });
  content.push(
    r.energyKwh === null
      ? { text: 'No energy figure has been generated for this period.', style: 'note' }
      : { text: `${r.energyKwh.toFixed(2)} kWh`, style: 'figure' }
  );

  /**
   * Cost and emissions, and never a zero for either. An unset tariff prints the sentence, not
   * 0.00 — a zero cost is a claim that electricity was free, and in a document that leaves the
   * building it is the most damaging number on the page.
   *
   * The provenance is not a footnote at the back. It sits under the figure it belongs to,
   * because a peso figure a reader cannot trace to a bill is exactly what a funder cannot check.
   */
  content.push({
    table: {
      headerRows: 1,
      widths: ['*', 'auto'],
      body: [
        [{ text: 'Derived figure', style: 'th' }, { text: 'Value', style: 'th' }],
        ['Cost', r.cost ? `${r.cost.text}${r.cost.qualified ? ' (partial period)' : ''}` : `${EM_DASH} no rate has been entered`],
        ['Emissions', r.carbon ? `${r.carbon.text}${r.carbon.qualified ? ' (partial period)' : ''}` : `${EM_DASH} no emission factor has been entered`],
      ],
    },
    layout: 'lightHorizontalLines',
    margin: [0, 6, 0, 4],
  });

  if (r.provenance.length > 0) {
    content.push({ ul: r.provenance.map((line) => line), style: 'note' });
  }

  // --- charts, each with the numbers behind it ----------------------------------------------
  for (const chart of r.charts) {
    content.push(
      { text: chart.title, style: 'h2' },
      { svg: chart.svg, width: CONTENT_WIDTH },
      { text: chart.desc, style: 'note' },
      {
        // The numbers travel with the picture. A printed chart cannot be hovered, and a reader
        // who wants an exact figure off a bar has nowhere else to get it.
        table: {
          headerRows: 1,
          dontBreakRows: true,
          widths: chart.table.headers.map((_, i) => (i === 0 ? '*' : 'auto')),
          body: [
            chart.table.headers.map((h) => ({ text: h, style: 'th' })),
            ...chart.table.rows.map((row) => row.map((cell) => cell ?? EM_DASH)),
          ],
        },
        layout: 'lightHorizontalLines',
        margin: [0, 4, 0, 10],
      }
    );
  }

  // --- per device ------------------------------------------------------------------------------
  if (r.deviceRows.length > 0) {
    content.push(
      { text: 'By device', style: 'h2' },
      {
        table: {
          headerRows: 1,
          widths: ['*', 'auto', 'auto', 'auto', 'auto'],
          body: [
            ['Device', 'Energy (kWh)', 'Peak (W)', 'Average (W)', 'Coverage'].map((h) => ({ text: h, style: 'th' })),
            ...r.deviceRows.map((d) => [d.name, d.energyKwh ?? EM_DASH, d.peakW ?? EM_DASH, d.avgW ?? EM_DASH, d.coverage]),
          ],
        },
        layout: 'lightHorizontalLines',
        margin: [0, 4, 0, 10],
      }
    );
  }

  // --- the closing refusals, last -------------------------------------------------------------
  content.push({
    stack: [
      { text: 'What this report does not say', style: 'h2' },
      {
        ul: r.caveats.map((c) => ({ text: [{ text: c.lead, bold: true }, ' ', c.body] })),
        style: 'note',
      },
    ],
    // Never orphaned onto its own page away from the figures it qualifies, and never split.
    unbreakable: true,
  });

  return {
    pageSize: 'A4',
    pageMargins: [40, 44, 40, 48] as [number, number, number, number],
    info: { title: `${r.title} — ${r.siteName} — ${r.periodLabel}`, author: r.siteName, creator: 'iBEMS' },
    content,
    /** Pages get separated. Each one has to say which building and which period it is about. */
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        { text: `${r.siteName} · ${r.periodLabel}`, style: 'footer' },
        { text: `${currentPage} of ${pageCount}`, alignment: 'right', style: 'footer' },
      ],
      margin: [40, 14, 40, 0] as [number, number, number, number],
    }),
    styles: {
      coverTitle: { fontSize: 24, bold: true, margin: [0, 120, 0, 4] as [number, number, number, number] },
      coverSite: { fontSize: 15, margin: [0, 0, 0, 2] as [number, number, number, number] },
      coverPeriod: { fontSize: 13, color: '#475569', margin: [0, 0, 0, 18] as [number, number, number, number] },
      coverMeta: { fontSize: 9, color: '#475569', margin: [0, 0, 0, 4] as [number, number, number, number] },
      h2: { fontSize: 13, bold: true, margin: [0, 14, 0, 4] as [number, number, number, number] },
      figure: { fontSize: 20, bold: true, margin: [0, 2, 0, 4] as [number, number, number, number] },
      note: { fontSize: 9, color: '#475569', margin: [0, 2, 0, 4] as [number, number, number, number] },
      th: { bold: true, fontSize: 9 },
      footer: { fontSize: 8, color: '#475569' },
    },
    defaultStyle: { font: 'Roboto', fontSize: 9.5 },
  };
}
