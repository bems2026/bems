/**
 * The sentences a report says about its own limits — in one place, because three things say them.
 *
 * `npm run baseline:report` writes Markdown to a file for the university deliverable. The Reports
 * page renders the same claims as HTML. The PDF will render them again as paged text. Three
 * renderings of one set of caveats, and the failure mode if they diverge is not a typo: it is a
 * document that qualifies a figure the screen quotes bare, or a screen that drops a qualification
 * the document carries. RM-062 is the same shape of defect on a different page — the Automation
 * page understating its own reach — and it was live for weeks.
 *
 * CONTENT HERE, FORMATTING AT THE CONSUMER. These are plain sentences and structured bullets, not
 * Markdown: the CLI wraps them in table syntax, the page wraps them in elements, the PDF wraps
 * them in pdfmake nodes. Storing pre-formatted Markdown would make the page strip it back out,
 * which is how the two would start to drift.
 */

/**
 * The floor below which a window is a sample rather than a benchmark.
 *
 * A weekday and a weekend are most of the distance between a building's peak and its floor, and
 * a window that has not seen both cannot separate them. These are deliberately not tuned to what
 * this deployment happens to have collected.
 */
export const BASELINE_MIN_SAMPLES = 1000;
export const BASELINE_MIN_DAYS = 3;

/** Why coverage comes before any figure it qualifies, rather than after them as a footnote. */
export const COVERAGE_LEDE =
  'Stated first because every figure after it is a claim about the hours in this table, not ' +
  'about the hours in the window.';

/** Shown when the window is under the floor above. `observed` readings across `days` days. */
export function notABaselineYet(observed, days) {
  return [
    `It covers ${observed} reading(s) across ${days} building-day(s). A benchmark needs at least ` +
      `${BASELINE_MIN_SAMPLES} readings across ${BASELINE_MIN_DAYS} days before it can separate a weekday from a ` +
      'weekend, and the weekend is most of the distance between a building’s peak and its floor.',
    'The figures below are real, and they are a sample. Cite them as one.',
  ];
}

export const NOT_A_BASELINE_TITLE = 'This is not a baseline yet';

/** Percentiles describe what was watched. They are not a limit, and the difference matters. */
export const DEMAND_CAVEAT =
  'These describe what the building drew while it was being watched. They are not a limit — a ' +
  'DSM ceiling is deliberately set above the observed peak rather than at a percentile of it.';

/** Why the daily figures come from a counter rather than from integrating power. */
export const DAILY_ENERGY_NOTE =
  'From the meters’ own running daily counter, not integrated from power samples: integrating ' +
  'across a gap would invent the energy used during an outage.';

/** Why an unobserved hour is an em dash. */
export const UNOBSERVED_HOUR_NOTE =
  'An hour with no readings shows an em dash. It does not show zero, because the building did ' +
  'not draw nothing at that hour — nobody was watching at that hour.';

/** Why an empty window is a measurement problem rather than a quiet building. */
export const NO_READINGS_NOTE =
  'There are no recorded building totals in this window, so there is nothing to benchmark. ' +
  'Totals read null whenever the meters are offline — by design, so that an outage cannot be ' +
  'mistaken for a quiet building — which means an empty window is a measurement problem, not a ' +
  'building that used nothing.';

export const NOT_SAID_TITLE = 'What this report does not say';

/**
 * The closing section. Each bullet leads with the claim it refuses, because a reader skimming
 * the bolded openings should come away with the limits even if they read nothing else.
 *
 * The floor-area one is the one to keep: a kWh/m² figure computed from an assumed area would be
 * the most quotable number in the document and the least true.
 */
export const NOT_SAID = [
  {
    lead: 'It does not cover the hours it did not observe.',
    body:
      'Coverage is above; an outage removes its own hours from every figure here, and those ' +
      'hours are not average ones.',
  },
  {
    lead: 'It is not normalised by floor area or occupancy.',
    body:
      'Neither is recorded, and a kWh/m² figure computed from an assumed area would be the most ' +
      'quotable number in the document and the least true.',
  },
  {
    lead: 'It does not attribute consumption to causes.',
    body:
      'Per-circuit and per-space totals exist in the dashboard; this is the building-level ' +
      'baseline the two are compared against.',
  },
  { lead: 'It is not a forecast.', body: 'It is what happened.' },
];

/**
 * The extra refusals a period-against-period comparison has to make, on top of `NOT_SAID`.
 *
 * IPMVP Option C is a whole-facility method and it requires routine adjustment for the
 * independent variables. **This system records none of them.** Saying so is not boilerplate: a
 * difference between two periods presented without this list reads as a saving, and the reader
 * has no way to know it is a difference between two months' weather.
 */
export const COMPARISON_NOT_ADJUSTED = [
  {
    lead: 'It is not weather-adjusted.',
    body:
      'No degree-day normalisation is applied. An outdoor temperature sensor exists on this site ' +
      'and its readings are not retained per period, so this is computable in principle and ' +
      'simply is not stored — which is a different statement from unavailable.',
  },
  {
    lead: 'It is not adjusted for occupancy or operating hours.',
    body: 'Neither is recorded. A quiet fortnight and an efficient one are the same figure here.',
  },
  {
    lead: 'It does not know what changed between the two periods.',
    body:
      'Equipment added, removed or repaired mid-period moves the figure, and nothing in this ' +
      'system observes that it happened.',
  },
  {
    lead: 'It is a difference, not a saving.',
    body:
      'A saving is a claim about cause. This is the arithmetic; attributing it is the reader’s ' +
      'to do, with what they know about the building that the meters do not.',
  },
];
