import { NOT_SAID_TITLE, PLAIN_COMPARISON_LIMITS, PLAIN_COMPARISON_TITLE } from '@shared/reportProse.mjs';
import type { DemandSummary } from '@/lib/reportSeries';
import { normaliseSections, REPORT_SECTIONS, type ReportDetail, type ReportSectionId } from '@/lib/reportSections';

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
 *
 * THE READER CHOOSES THE SECTIONS — RM-083 — and the choice cannot break either rule above.
 * `normaliseSections` puts coverage and the closing refusals back whatever was asked for, and the
 * builder emits sections in one fixed order, so coverage precedes every figure and the refusals
 * close the document for any selection a reader can make. A section with no data behind it is
 * skipped rather than printed empty.
 *
 * SIMPLE OR DETAILED — RM-099. A Simple document says how much was recorded in one line and draws its
 * charts without the number tables under them; a Detailed one keeps every table. Both keep the two rules:
 * recording first, limits last. And both say, on the cover, which part of the building they are about.
 */

export interface PdfChart {
  /** The section this chart belongs to. An untagged chart is always included. */
  section?: ReportSectionId;
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
  /** What the report says about this figure — RM-090's "not possible" or "corrected". */
  note?: string | null;
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
  /** The sections the reader chose. Omitted means every section. Coverage and the closing refusals
   *  are included whatever this says. */
  sections?: readonly ReportSectionId[];
  /** No minute of the period carried a real reading, so no energy figure may be stated — RM-081. */
  notObserved?: boolean;
  /** Formatted figures shown beside the energy: peak demand, voltage, commands, anomalies. */
  keyFigures?: readonly { label: string; value: string }[];
  baseline?: { gate: readonly string[] | null; rows: readonly (readonly [string, string])[]; caveat: string } | null;
  circuits?: { branches: readonly PdfDeviceRow[]; devices: readonly PdfDeviceRow[]; untracked: string | null } | null;
  comparison?: { heading: string; lines: readonly string[] } | null;
  /** Charts the reader chose whose data could not be loaded when the document was made — RM-081b. */
  omitted?: readonly string[];
  /** RM-099. Absent means Detailed. */
  detail?: ReportDetail;
  /** The category or circuit the document is narrowed to; absent or null for the whole building. */
  scopeLabel?: string | null;
  /** Figures the document corrected or refused, one sentence each — RM-090. */
  corrections?: readonly string[];
  /** Loads nobody metered, as the estimates they are — RM-130. Every figure already carries its ≈. */
  apportioned?: readonly {
    label: string;
    branchLabel: string;
    share: string;
    basis: string;
    estimated: string;
    remainder: string;
    branch: string;
    note: string;
  }[];
}

/** A4 minus 40pt margins each side. Charts are generated at exactly this width. */
export const CONTENT_WIDTH = 515;

const EM_DASH = '—';
const n = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined || !Number.isFinite(v) ? EM_DASH : v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });

const RESOLUTION_NOTE: Record<string, string> = {
  minute: 'Made from minute-by-minute readings.',
  mixed: 'Older days are hourly averages, which can hide short peaks.',
  hour: 'Made from hourly averages, which can hide short peaks.',
};

const deviceTable = (rows: readonly PdfDeviceRow[]) => ({
  table: {
    headerRows: 1,
    widths: ['*', 'auto', 'auto', 'auto', 'auto'],
    body: [
      ['Device', 'Energy (kWh)', 'Highest (W)', 'Average (W)', 'Recorded'].map((h) => ({ text: h, style: 'th' })),
      ...rows.map((d) => [d.name, d.energyKwh ?? EM_DASH, d.peakW ?? EM_DASH, d.avgW ?? EM_DASH, d.coverage]),
    ],
  },
  layout: 'lightHorizontalLines',
  margin: [0, 4, 0, 10],
});

/** The table, then a line for every figure the report qualifies — RM-090. A flagged figure never
 *  travels without the reason it was left out or corrected. */
const deviceTableWithNotes = (rows: readonly PdfDeviceRow[]) => [
  deviceTable(rows),
  ...rows.filter((d) => d.note).map((d) => ({ text: `${d.name}: ${d.note}`, style: 'note' })),
];

export function buildDocDefinition(r: PdfReport) {
  const detail: ReportDetail = r.detail ?? 'detailed';
  const chosen = new Set(normaliseSections(r.sections ?? REPORT_SECTIONS.map((s) => s.id), detail));
  const has = (id: ReportSectionId) => chosen.has(id);
  const content: unknown[] = [];

  // --- cover ------------------------------------------------------------------------------
  content.push(
    { text: r.title, style: 'coverTitle' },
    { text: r.siteName, style: 'coverSite' },
    { text: r.periodLabel, style: 'coverPeriod' },
    // Which part of the building this document is about, before anything else is.
    { text: r.scopeLabel ? `${r.scopeLabel} — the circuit sections are narrowed to it` : 'The whole building', style: 'coverMeta' },
    { text: detail === 'simple' ? 'Simple report' : 'Detailed report', style: 'coverMeta' },
    {
      // The frame, said once and early. A PDF is read somewhere else, and a timestamp with no
      // frame is read in the reader's own — which for a building on the other side of the
      // world is a different day.
      text: `Generated ${r.generatedAt} (${r.timezone}). All times and dates in this document are the building's own, not the reader's.`,
      style: 'coverMeta',
    },
    r.buildId ? { text: `Software build ${r.buildId.replace(/^index-/, '').replace(/\.js$/, '')}`, style: 'coverMeta' } : { text: '' },
    { text: '', pageBreak: 'after' }
  );

  // --- coverage, before anything it qualifies — always ------------------------------------------
  content.push({ text: 'How much was recorded', style: 'h2' }, { text: 'Every figure in this report comes from these minutes.', style: 'note' });

  if (r.summary && detail === 'simple') {
    const s = r.summary;
    const share = s.expected_minutes > 0 ? `${Math.round((s.usable_minutes / s.expected_minutes) * 100)}%` : EM_DASH;
    const gap = s.longest_gap_minutes === null ? `${EM_DASH} (not measurable)` : `${n(s.longest_gap_minutes)} min`;
    content.push({
      text: `Recorded ${share} of the period (${n(s.usable_minutes)} of ${n(s.expected_minutes)} minutes) · ${r.observedDays} days recorded, ${r.completeDays} in full · longest gap ${gap}`,
      style: 'figureLine',
    });
    if (s.resolution && RESOLUTION_NOTE[s.resolution]) content.push({ text: RESOLUTION_NOTE[s.resolution], style: 'note' });
  } else if (r.summary) {
    const s = r.summary;
    const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : EM_DASH);
    content.push({
      table: {
        headerRows: 1,
        widths: ['*', 120],
        body: [
          [{ text: 'Measure', style: 'th' }, { text: 'Value', style: 'th' }],
          ['Minutes recorded', `${n(s.usable_minutes)} of ${n(s.expected_minutes)}  (${pct(s.usable_minutes, s.expected_minutes)})`],
          // Both figures, named. The gap between them is meters writing rows while observing
          // nothing — 9,415 of August 2026's. One number alone either overstates the coverage
          // or disagrees with the stored report.
          ['Minutes the meters sent, including empty ones', `${n(s.observed_minutes)}  (${pct(s.observed_minutes, s.expected_minutes)})`],
          [
            'Longest gap',
            // Never 0: once the raw rows are pruned the gap is unmeasurable rather than absent,
            // and zero is the most reassuring possible way to report an outage.
            s.longest_gap_minutes === null ? `${EM_DASH} (not measurable)` : `${n(s.longest_gap_minutes)} min`,
          ],
          ['Days recorded', `${r.observedDays} (${r.completeDays} in full)`],
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
      text: 'How much was recorded could not be worked out for this period, so nothing below can be qualified by it.',
      style: 'note',
    });
  }

  // --- corrected figures, before any figure they touch ------------------------------------------
  if (r.corrections && r.corrections.length > 0) {
    content.push({ text: 'Corrected figures', style: 'h3' }, { ul: [...r.corrections], style: 'note' });
  }

  // --- headline ------------------------------------------------------------------------------
  if (has('keyFigures')) {
    content.push({ text: 'Energy', style: 'h2' });
    content.push(
      r.notObserved
        ? // A stored zero from rows that held no reading says the building used nothing. It did not
          // say that; nobody was watching.
          { text: 'Not recorded — not one minute of this period carried a real reading, so no energy figure is stated.', style: 'note' }
        : r.energyKwh === null
          ? { text: 'No energy figure has been generated for this period.', style: 'note' }
          : { text: `${r.energyKwh.toFixed(2)} kWh`, style: 'figure' }
    );
    if (r.keyFigures && r.keyFigures.length > 0) {
      content.push({
        table: {
          headerRows: 1,
          widths: ['*', 'auto'],
          body: [[{ text: 'Figure', style: 'th' }, { text: 'Value', style: 'th' }], ...r.keyFigures.map((k) => [k.label, k.value])],
        },
        layout: 'lightHorizontalLines',
        margin: [0, 6, 0, 4],
      });
    }
  }

  /**
   * Cost and emissions, and never a zero for either. An unset tariff prints the sentence, not
   * 0.00 — a zero cost is a claim that electricity was free, and in a document that leaves the
   * building it is the most damaging number on the page.
   *
   * The provenance is not a footnote at the back. It sits under the figure it belongs to,
   * because a peso figure a reader cannot trace to a bill is exactly what a funder cannot check.
   */
  if (has('costCarbon')) {
    content.push({
      table: {
        headerRows: 1,
        widths: ['*', 'auto'],
        body: [
          [{ text: 'Cost and emissions', style: 'th' }, { text: 'Value', style: 'th' }],
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
  }

  // --- charts, each with the numbers behind it ----------------------------------------------
  if (r.omitted && r.omitted.length > 0) {
    // Said before the charts, where a reader would look for the missing one.
    content.push({
      text: `Not included, because their data could not be loaded when this document was made: ${r.omitted.join(', ')}.`,
      style: 'note',
    });
  }
  // RM-130: an estimate's chart is drawn inside its own section below, beside its figures.
  const drawn = r.charts.filter((chart) => (chart.section === undefined || has(chart.section)) && chart.section !== 'apportioned');
  for (const chart of drawn) {
    if (detail === 'simple') {
      // Simple: the picture and what it shows, and no number table under it.
      content.push({ text: chart.title, style: 'h2' }, { svg: chart.svg, width: CONTENT_WIDTH }, { text: chart.desc, style: 'note' });
      continue;
    }
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

  if (detail === 'simple' && drawn.length > 0) {
    content.push({ text: 'The numbers behind each chart are in the Detailed PDF and the CSV exports.', style: 'note' });
  }

  // --- per device ------------------------------------------------------------------------------
  if (has('devices') && r.deviceRows.length > 0) {
    content.push({ text: 'By device', style: 'h2' }, ...deviceTableWithNotes(r.deviceRows));
  }

  // --- estimated loads — RM-130 ----------------------------------------------------------------
  if (has('apportioned') && r.apportioned && r.apportioned.length > 0) {
    content.push(
      { text: 'Estimated, not metered', style: 'h2' },
      {
        text: 'These loads share a branch meter with something else. Each figure is the branch’s measured energy split by a share the operator declared — an estimate, not a measurement.',
        style: 'note',
      }
    );
    for (const a of r.apportioned) {
      content.push(
        {
          table: {
            headerRows: 1,
            widths: ['*', 'auto'],
            body: [
              [{ text: 'Figure', style: 'th' }, { text: 'Value', style: 'th' }],
              [`${a.label} — ${a.share} of ${a.branchLabel} (${a.basis})`, a.estimated],
              [`${a.branchLabel}, the rest`, a.remainder],
              [`${a.branchLabel}, measured`, a.branch],
            ],
          },
          layout: 'lightHorizontalLines',
          margin: [0, 4, 0, 4],
        },
        { text: a.note, style: 'note' }
      );
      for (const chart of r.charts.filter((c) => c.section === 'apportioned' && c.title.startsWith(`${a.label}, per`))) {
        content.push({ text: chart.title, style: 'h3' }, { svg: chart.svg, width: CONTENT_WIDTH }, { text: chart.desc, style: 'note' });
      }
    }
  }

  // --- baseline demand ---------------------------------------------------------------------------
  if (has('baseline') && r.baseline) {
    content.push({ text: 'Usual and high demand', style: 'h2' });
    // The "not a baseline yet" gate precedes the numbers it qualifies, as it does on the page.
    for (const line of r.baseline.gate ?? []) content.push({ text: line, style: 'note' });
    content.push(
      {
        table: {
          headerRows: 1,
          widths: ['*', 'auto'],
          body: [[{ text: 'Figure', style: 'th' }, { text: 'Value', style: 'th' }], ...r.baseline.rows.map(([label, value]) => [label, value])],
        },
        layout: 'lightHorizontalLines',
        margin: [0, 4, 0, 4],
      },
      { text: r.baseline.caveat, style: 'note' }
    );
  }

  // --- circuits ------------------------------------------------------------------------------
  if (has('circuits') && r.circuits) {
    content.push({ text: 'By circuit', style: 'h2' });
    content.push({
      text: 'Devices sit inside their circuit — adding the two tables together would count the same energy twice.',
      style: 'note',
    });
    if (r.circuits.untracked) content.push({ text: r.circuits.untracked, style: 'note' });
    if (r.circuits.branches.length > 0) content.push({ text: 'Branch circuits', style: 'h3' }, ...deviceTableWithNotes(r.circuits.branches));
    if (r.circuits.devices.length > 0) content.push({ text: 'Devices on these circuits', style: 'h3' }, ...deviceTableWithNotes(r.circuits.devices));
  }

  // --- comparison, never without what it was not adjusted for -------------------------------------
  if (has('comparison') && r.comparison) {
    content.push({
      stack: [
        { text: r.comparison.heading, style: 'h2' },
        ...r.comparison.lines.map((line) => ({ text: line, style: 'note' })),
        { text: PLAIN_COMPARISON_TITLE, style: 'h3' },
        { ul: PLAIN_COMPARISON_LIMITS.map((c) => ({ text: [{ text: c.lead, bold: true }, ' ', c.body] })), style: 'note' },
      ],
      unbreakable: true,
    });
  }

  // --- the closing refusals, last — always -------------------------------------------------------
  content.push({
    stack: [
      { text: NOT_SAID_TITLE, style: 'h2' },
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
      h3: { fontSize: 10.5, bold: true, margin: [0, 8, 0, 2] as [number, number, number, number] },
      figure: { fontSize: 20, bold: true, margin: [0, 2, 0, 4] as [number, number, number, number] },
      figureLine: { fontSize: 11, bold: true, margin: [0, 2, 0, 4] as [number, number, number, number] },
      note: { fontSize: 9, color: '#475569', margin: [0, 2, 0, 4] as [number, number, number, number] },
      th: { bold: true, fontSize: 9 },
      footer: { fontSize: 8, color: '#475569' },
    },
    defaultStyle: { font: 'Roboto', fontSize: 9.5 },
  };
}
