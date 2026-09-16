/**
 * The parts of a report a reader can choose to export — RM-083, in two depths since RM-099.
 *
 * In the order the document reads, which is not a presentation choice: how much was recorded comes first
 * because every figure after it is a claim about those minutes, and the limits come last because they are
 * the limits of everything above them.
 *
 * TWO ARE LOCKED (operator decision, 2026-09-15). A PDF leaves the building — attached to an email,
 * printed, quoted months later — and it is the one rendering nobody can ask a follow-up question of.
 * A document with its recording figures unticked would print totals with nothing saying how much of the
 * period they cover. Each locked section says why, in words the export drawer shows.
 *
 * SIMPLE OR DETAILED — RM-099. The operator asked for a PDF that is either mostly pictures or the full
 * story. A Simple document is the key figures and the charts that answer "how much", "what for" and "which
 * circuit"; a Detailed one adds the "when" charts, every table, and the comparison. Both keep the two
 * locked sections, because those are what a figure leans on whichever document it is in.
 */

export type ReportDetail = 'simple' | 'detailed';

export type ReportSectionId =
  | 'coverage'
  | 'keyFigures'
  | 'costCarbon'
  | 'dailyEnergy'
  | 'useShare'
  | 'circuitEnergy'
  | 'circuitTrend'
  | 'hourProfile'
  | 'breakdown'
  | 'heatmap'
  | 'durationCurve'
  | 'devices'
  | 'baseline'
  | 'circuits'
  | 'comparison'
  | 'notSaid';

export interface ReportSection {
  id: ReportSectionId;
  label: string;
  /** Why this section cannot be left out. Present only on locked sections. */
  locked?: string;
  /** `both` is in the Simple and the Detailed document; `detailed` only in the Detailed one. */
  detail: 'both' | 'detailed';
}

export const REPORT_SECTIONS: readonly ReportSection[] = [
  {
    id: 'coverage',
    label: 'How much was recorded',
    locked: 'Always included: every figure in the report comes from the minutes this counts.',
    detail: 'both',
  },
  { id: 'keyFigures', label: 'Key figures', detail: 'both' },
  { id: 'costCarbon', label: 'Cost and emissions, with their sources', detail: 'both' },
  { id: 'dailyEnergy', label: 'Energy per day', detail: 'both' },
  { id: 'useShare', label: 'Energy by use', detail: 'both' },
  { id: 'circuitEnergy', label: 'Energy per day, by circuit', detail: 'both' },
  { id: 'circuitTrend', label: 'Power through the period, by circuit', detail: 'both' },
  { id: 'hourProfile', label: 'A typical day, hour by hour', detail: 'detailed' },
  { id: 'breakdown', label: 'Each circuit’s share', detail: 'detailed' },
  { id: 'heatmap', label: 'Busy hours', detail: 'detailed' },
  { id: 'durationCurve', label: 'Time at each demand level', detail: 'detailed' },
  { id: 'devices', label: 'By device', detail: 'detailed' },
  { id: 'baseline', label: 'Usual and high demand', detail: 'detailed' },
  { id: 'circuits', label: 'By circuit', detail: 'detailed' },
  { id: 'comparison', label: 'Compared with the previous period', detail: 'detailed' },
  {
    id: 'notSaid',
    label: 'What this report does not say',
    locked: 'Always included: a document that leaves the building carries the limits of its own figures.',
    detail: 'both',
  },
];

/** The sections a document of this depth can hold, in document order. */
export function sectionsFor(detail: ReportDetail): ReportSection[] {
  return REPORT_SECTIONS.filter((s) => detail === 'detailed' || s.detail === 'both');
}

/**
 * The sections to export: the reader's choice plus the locked ones, each once, in document order, and only
 * those this depth holds. An id this build does not know — a choice remembered from an older one — is dropped.
 */
export function normaliseSections(chosen: Iterable<string>, detail: ReportDetail = 'detailed'): ReportSectionId[] {
  const wanted = new Set(chosen);
  return sectionsFor(detail)
    .filter((s) => s.locked !== undefined || wanted.has(s.id))
    .map((s) => s.id);
}
