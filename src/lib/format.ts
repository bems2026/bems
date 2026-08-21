/**
 * Number formatting, with this app's one non-negotiable rule encoded in a single place:
 * a missing value renders `—`, never `0`.
 *
 * "No data" and "zero watts" are different facts about a building, and conflating them is
 * how a dead sensor reads as an idle one. `MetricValue` has enforced that for the values it
 * renders as a component since Stage L4 — but every place that needs a *string* rather than
 * a component (table cells, chart tooltips, inline prose) retyped the same ternary instead:
 *
 *     typeof reading?.voltage === 'number' ? `${reading.voltage.toFixed(1)}V` : '—'
 *
 * ~20 hand-written copies across DevicesView, SourceCard, AnalyticsPage,
 * IrCommandCenterCard and chartParams, with the null check spelled three different ways
 * (`typeof x === 'number'`, `x != null`, and an enclosing `x !== null &&`). They all agree
 * today. Nothing made them agree, and nothing would have caught the first one that drifted.
 *
 * `shared/buildLatest.mjs` and `shared/dsmMath.mjs` hold the same line on the server side —
 * this is the frontend's copy of that discipline, not a new idea.
 */

/** What a missing value looks like everywhere in this app. An em dash, not a hyphen. */
export const MISSING = '—';

/**
 * The one null check. Exported because several callers need to branch on it before
 * building something more complicated than a formatted number.
 */
export function isPresent(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** A number to `digits` decimal places, or `—`. The base every other formatter builds on. */
export function formatNumber(value: number | null | undefined, digits = 1): string {
  return isPresent(value) ? value.toFixed(digits) : MISSING;
}

/**
 * A number with its unit appended, or a bare `—`.
 *
 * The unit is deliberately dropped when the value is missing: "—V" reads as a volt reading
 * of unknown size, when what is true is that there is no reading at all.
 */
export function formatWithUnit(value: number | null | undefined, unit: string, digits = 1): string {
  return isPresent(value) ? `${value.toFixed(digits)}${unit}` : MISSING;
}

/** Volts, to one decimal — the resolution the Tuya meters actually report. */
export function formatVolts(value: number | null | undefined): string {
  return formatWithUnit(value, 'V', 1);
}

/** Amps, to two decimals — branch currents here are often under 1 A. */
export function formatAmps(value: number | null | undefined): string {
  return formatWithUnit(value, 'A', 2);
}

/** Watts, whole numbers — a tenth of a watt is noise at this scale. */
export function formatWatts(value: number | null | undefined): string {
  return formatWithUnit(value, ' W', 0);
}

/** Kilowatts from a value already in kW. */
export function formatKw(value: number | null | undefined, digits = 2): string {
  return formatWithUnit(value, ' kW', digits);
}

/** Kilowatts from a value in WATTS — the conversion, done once. */
export function formatWattsAsKw(watts: number | null | undefined, digits = 2): string {
  return isPresent(watts) ? `${(watts / 1000).toFixed(digits)} kW` : MISSING;
}

/** Kilowatt-hours. */
export function formatKwh(value: number | null | undefined, digits = 2): string {
  return formatWithUnit(value, ' kWh', digits);
}

/**
 * A share of a total, as a percentage.
 *
 * A zero or missing total yields 0, not a division by zero or an `Infinity` that would
 * render as a bar wider than its track. Three separate copies of this clause existed —
 * EnergyBreakdownCard, EnergySection and overviewMath — each written slightly differently.
 */
export function shareOfTotal(part: number | null | undefined, total: number | null | undefined): number {
  if (!isPresent(part) || !isPresent(total) || total <= 0) return 0;
  return Math.min(100, (part / total) * 100);
}
