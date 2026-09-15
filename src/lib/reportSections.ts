/**
 * The parts of a report a reader can choose to export — RM-083.
 *
 * In the order the document reads, which is not a presentation choice: coverage comes first because
 * every figure after it is a claim about the minutes it counts, and the refusals come last because
 * they are the limits of everything above them.
 *
 * TWO ARE LOCKED (operator decision, 2026-09-15). A PDF leaves the building — attached to an email,
 * printed, quoted months later — and it is the one rendering nobody can ask a follow-up question of.
 * A document with its coverage unticked would print totals with nothing saying how much of the
 * period they cover. Each locked section says why, in words the export drawer shows.
 */

export type ReportSectionId =
  | 'coverage'
  | 'keyFigures'
  | 'costCarbon'
  | 'dailyEnergy'
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
}

export const REPORT_SECTIONS: readonly ReportSection[] = [
  {
    id: 'coverage',
    label: 'Coverage',
    locked: 'Always included: every figure in the report is a claim about the minutes this section counts.',
  },
  { id: 'keyFigures', label: 'Key figures' },
  { id: 'costCarbon', label: 'Cost and emissions, with their sources' },
  { id: 'dailyEnergy', label: 'Energy per day' },
  { id: 'hourProfile', label: 'Demand by hour of the day' },
  { id: 'breakdown', label: 'Where the energy went' },
  { id: 'heatmap', label: 'Demand by day and hour' },
  { id: 'durationCurve', label: 'Load duration' },
  { id: 'devices', label: 'By device' },
  { id: 'baseline', label: 'Baseline demand statistics' },
  { id: 'circuits', label: 'By circuit' },
  { id: 'comparison', label: 'Comparison with the previous period' },
  {
    id: 'notSaid',
    label: 'What this report does not say',
    locked: 'Always included: a document that leaves the building has to carry the limits of its own figures.',
  },
];

/**
 * The sections to export: the reader's choice plus the locked ones, each once, in document order.
 * An id this build does not know — a choice remembered from an older one — is dropped.
 */
export function normaliseSections(chosen: Iterable<string>): ReportSectionId[] {
  const wanted = new Set(chosen);
  return REPORT_SECTIONS.filter((s) => s.locked !== undefined || wanted.has(s.id)).map((s) => s.id);
}
