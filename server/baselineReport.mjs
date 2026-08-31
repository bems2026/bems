/**
 * The baseline energy dataset and benchmarking summary — Milestone 1.
 *
 * Pure. The fetching and the file writing live in `baseline-report.mjs`, so every figure in a
 * document that goes to the university can be reproduced from a fixture without a database.
 *
 * WHY THIS EXISTS AT ALL. `npm run demand:profile` has computed these numbers since Phase 8, and
 * prints them to a terminal that nobody keeps. Milestone 1 asks for an artifact — something with
 * a date on it that can be cited, compared against next quarter, and handed to someone who was
 * not in the room. That is a different deliverable from a statistic.
 *
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE. A benchmark is a claim about a building, and the
 * strongest thing it can do is overstate what was measured. So coverage is stated *before* any
 * figure it qualifies; an hour nobody observed reads `—`, never `0`; a day the meters missed
 * half of is marked partial rather than averaged in; and a window too thin to benchmark says so
 * in its own heading instead of quietly producing a table that looks like the real thing.
 * This is `RM-024` / `EX-107` applied to a document rather than to a dashboard.
 */

import { summarize } from './demandProfile.mjs';

/**
 * Below these, the document calls itself a sample rather than a baseline.
 *
 * Three days because two cannot tell a weekday from a weekend, and a building's weekend is most
 * of the difference between its peak and its floor. 1000 samples because that is a little under
 * a full day of minute readings — a figure computed from a handful of them is, in this project's
 * own phrase, a guess wearing a decimal point.
 */
export const BASELINE_MIN_SAMPLES = 1000;
export const BASELINE_MIN_DAYS = 3;

const MIN = 60_000;

/**
 * The building's own calendar, not the runtime's.
 *
 * Shifting the epoch and then reading UTC getters is the only way to do this without a timezone
 * database, and it is deliberate here: a report about a building that buckets a 17:00Z reading
 * into "17:00" says the office peaked at one in the morning. That fault has already been paid
 * for once in this project, on the forecast parse.
 */
export function siteParts(ms, offsetMinutes) {
  const d = new Date(ms + offsetMinutes * MIN);
  const iso = d.toISOString();
  return { date: iso.slice(0, 10), hour: d.getUTCHours(), local: iso.slice(0, 16) };
}

const powerOf = (r) => (typeof r?.total_power_w === 'number' && Number.isFinite(r.total_power_w) ? r.total_power_w : null);
const energyOf = (r) => (typeof r?.energy_kwh_today === 'number' && Number.isFinite(r.energy_kwh_today) ? r.energy_kwh_today : null);

/**
 * What fraction of the window was actually observed, and how long the worst gap was.
 *
 * `observed / expected` alone hides the shape of a loss: 80% coverage is a healthy month with a
 * few restarts, or three weeks up and a week dark. The longest gap separates them, and it is the
 * one an outage shows up in.
 */
export function coverage(rows, { fromMs, toMs, intervalS = 60 } = {}) {
  const span = Number.isFinite(fromMs) && Number.isFinite(toMs) ? toMs - fromMs : 0;
  const expected = span > 0 ? Math.round(span / (intervalS * 1000)) : 0;
  const observed = rows.length;

  let longestGapMinutes = null;
  const stamps = rows.map((r) => Date.parse(r.ts)).filter(Number.isFinite).sort((a, b) => a - b);
  for (let i = 1; i < stamps.length; i++) {
    const gap = (stamps[i] - stamps[i - 1]) / MIN;
    if (longestGapMinutes == null || gap > longestGapMinutes) longestGapMinutes = gap;
  }

  return {
    observed,
    expected,
    // Not `observed / 0`. A window with no duration was not 0% covered; it was not a window.
    pct: expected > 0 ? observed / expected : null,
    longestGapMinutes,
    fromMs: stamps.length ? stamps[0] : null,
    toMs: stamps.length ? stamps[stamps.length - 1] : null,
  };
}

/**
 * Demand by hour of the building's day — the shape a benchmark is actually read for.
 *
 * All 24 hours are returned whether or not they hold anything, because the gaps are the finding.
 * An hour with nothing in it carries `n: 0` and nulls: the building did not draw zero at 03:00,
 * nobody was watching at 03:00.
 */
export function hourProfile(rows, offsetMinutes) {
  const buckets = Array.from({ length: 24 }, () => []);
  for (const r of rows) {
    const w = powerOf(r);
    const ms = Date.parse(r?.ts);
    if (w == null || !Number.isFinite(ms)) continue;
    buckets[siteParts(ms, offsetMinutes).hour].push(w);
  }
  return buckets.map((vals, hour) => {
    const s = summarize(vals);
    return {
      hour,
      n: s ? s.n : 0,
      p50: s ? s.p50 : null,
      p95: s ? s.p95 : null,
      max: s ? s.max : null,
      mean: s ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
    };
  });
}

/**
 * Energy per building-day, from the meters' own running daily counter.
 *
 * The counter is read rather than integrated from power on purpose. Integrating minute samples
 * across a gap invents the energy used during the gap, and the gaps here are outages — exactly
 * the hours least like the ones either side of them. The counter's daily maximum is what the
 * hardware itself totalled, and where the day is incompletely observed that maximum is a floor,
 * which `partial` says out loud.
 */
export function dailyEnergy(rows, offsetMinutes) {
  const byDate = new Map();
  for (const r of rows) {
    const ms = Date.parse(r?.ts);
    if (!Number.isFinite(ms)) continue;
    const { date, local } = siteParts(ms, offsetMinutes);
    if (!byDate.has(date)) byDate.set(date, { date, samples: 0, kwh: null, first: local, last: local, power: [] });
    const day = byDate.get(date);
    day.samples++;
    if (local < day.first) day.first = local;
    if (local > day.last) day.last = local;
    const w = powerOf(r);
    if (w != null) day.power.push(w);
    const kwh = energyOf(r);
    // Max, not last: the rows arrive sorted but a counter that has already reset would make the
    // final row of a day read as the day's total.
    if (kwh != null && (day.kwh == null || kwh > day.kwh)) day.kwh = kwh;
  }

  return [...byDate.values()]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((day) => {
      const startsLate = day.first.slice(11) > '00:30';
      const endsEarly = day.last.slice(11) < '23:30';
      const partial = startsLate || endsEarly;
      const s = summarize(day.power);
      return {
        date: day.date,
        kwh: day.kwh,
        samples: day.samples,
        firstSeen: day.first.slice(11),
        lastSeen: day.last.slice(11),
        partial,
        peakW: s ? s.max : null,
        note: partial
          ? `partial — observed ${day.first.slice(11)}–${day.last.slice(11)}, so this is a floor, not the day's total`
          : 'full day observed',
      };
    });
}

const f = (v, digits = 1) => (v == null ? '—' : Number(v).toFixed(digits));
const pctOf = (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);

/**
 * The dataset half of the deliverable: the readings themselves, so the summary can be checked.
 *
 * A benchmarking summary whose underlying numbers cannot be re-read is an assertion. Both site
 * date and site hour are materialised as columns rather than left to be recomputed, because the
 * recomputation is where the timezone gets lost.
 */
export function renderDataset(rows, offsetMinutes) {
  const out = ['ts_utc,ts_site,site_date,site_hour,total_power_w,energy_kwh_today'];
  for (const r of rows) {
    const ms = Date.parse(r?.ts);
    if (!Number.isFinite(ms)) continue;
    const { date, hour, local } = siteParts(ms, offsetMinutes);
    const w = powerOf(r);
    const kwh = energyOf(r);
    // An empty cell, never a zero. A spreadsheet will average a column of zeros without comment.
    out.push([new Date(ms).toISOString().slice(0, 19) + 'Z', local, date, hour, w ?? '', kwh ?? ''].join(','));
  }
  return out.join('\n') + '\n';
}

/**
 * The summary half: a dated Markdown document meant to be read by someone who was not here.
 */
export function renderReport({ rows = [], offsetMinutes = 0, siteName = 'this site', timezone = 'UTC', generatedMs = Date.now(), windowLabel = 'all recorded data' } = {}) {
  const stampedAt = siteParts(generatedMs, offsetMinutes).local.replace('T', ' ');
  const head = [
    `# Baseline energy report — ${siteName}`,
    '',
    `**Generated:** ${stampedAt} (${timezone}) · **Window:** ${windowLabel}`,
    '',
    `All times and dates in this document are the building's own (${timezone}), not the reader's.`,
    '',
  ];

  if (!rows.length) {
    return [
      ...head,
      '## No readings',
      '',
      'There are no recorded building totals in this window, so there is nothing to benchmark.',
      'Totals read null whenever the meters are offline — by design, so that an outage cannot be',
      'mistaken for a quiet building — which means an empty window is a measurement problem, not',
      'a building that used nothing.',
      '',
    ].join('\n');
  }

  const stamps = rows.map((r) => Date.parse(r.ts)).filter(Number.isFinite).sort((a, b) => a - b);
  const cov = coverage(rows, { fromMs: stamps[0], toMs: stamps[stamps.length - 1] });
  const days = dailyEnergy(rows, offsetMinutes);
  const hours = hourProfile(rows, offsetMinutes);
  const power = summarize(rows.map(powerOf));
  const fullDays = days.filter((d) => !d.partial);
  const thin = cov.observed < BASELINE_MIN_SAMPLES || days.length < BASELINE_MIN_DAYS;

  const out = [...head];

  if (thin) {
    out.push(
      '## This is not a baseline yet',
      '',
      `It covers ${cov.observed} reading(s) across ${days.length} building-day(s). A benchmark needs at`,
      `least ${BASELINE_MIN_SAMPLES} readings across ${BASELINE_MIN_DAYS} days before it can separate a weekday from a`,
      'weekend, and the weekend is most of the distance between a building’s peak and its floor.',
      'The figures below are real, and they are a sample. Cite them as one.',
      '',
    );
  }

  out.push(
    '## Coverage',
    '',
    'Stated first because every figure after it is a claim about the hours in this table, not',
    'about the hours in the window.',
    '',
    '| | |',
    '|---|---|',
    `| Readings with a real total | ${cov.observed} |`,
    `| Readings a gapless window would hold | ${cov.expected} |`,
    `| Coverage | ${pctOf(cov.pct)} |`,
    `| Longest single gap | ${cov.longestGapMinutes == null ? '—' : `${f(cov.longestGapMinutes, 0)} min`} |`,
    `| Building-days observed | ${days.length} (${fullDays.length} of them complete) |`,
    '',
    '## Demand',
    '',
    '| Statistic | Total power |',
    '|---|---|',
    `| Median (p50) | ${f(power?.p50)} W |`,
    `| p95 | ${f(power?.p95)} W |`,
    `| p99 | ${f(power?.p99)} W |`,
    `| Observed peak | ${f(power?.max)} W |`,
    '',
    'These describe what the building drew while it was being watched. They are not a limit —',
    'see `npm run demand:profile` for a DSM ceiling, which is deliberately set above the peak',
    'rather than at a percentile of it.',
    '',
    '## Energy by day',
    '',
    'From the meters’ own running daily counter, not integrated from power samples: integrating',
    'across a gap would invent the energy used during an outage.',
    '',
    '| Date | kWh | Peak W | Samples | Observed | Note |',
    '|---|---|---|---|---|---|',
    ...days.map((d) => `| ${d.date} | ${d.kwh == null ? '—' : f(d.kwh, 2)} | ${f(d.peakW, 0)} | ${d.samples} | ${d.firstSeen}–${d.lastSeen} | ${d.note} |`),
    '',
    '## Demand by hour of the building’s day',
    '',
    'An hour with no readings shows `—`. It does not show zero, because the building did not draw',
    'nothing at that hour — nobody was watching at that hour.',
    '',
    '| Hour | n | Median W | p95 W | Peak W |',
    '|---|---|---|---|---|',
    ...hours.map((h) => `| ${String(h.hour).padStart(2, '0')}:00 | ${h.n} | ${f(h.p50, 0)} | ${f(h.p95, 0)} | ${f(h.max, 0)} |`),
    '',
    '## What this report does not say',
    '',
    '- **It does not cover the hours it did not observe.** Coverage is above; an outage removes',
    '  its own hours from every figure here, and those hours are not average ones.',
    '- **It is not normalised by floor area or occupancy.** Neither is recorded, and a kWh/m²',
    '  figure computed from an assumed area would be the most quotable number in the document and',
    '  the least true.',
    '- **It does not attribute consumption to causes.** Per-circuit and per-space totals exist in',
    '  the dashboard; this is the building-level baseline the two are compared against.',
    '- **It is not a forecast.** It is what happened.',
    '',
  );

  return out.join('\n');
}
